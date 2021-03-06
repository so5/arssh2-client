"use strict";
const path = require("path");
const { promisify } = require("util");
const fs = require("fs-extra");
const glob = require("glob");
const minimatch = require("minimatch");
const minimatch2 = require("minimatch").Minimatch;
const debug = require("debug")("arssh2:sftpUtil");
const { isDirLocal, isFileLocal, S_ISREG, S_ISDIR, returnSize, getFileMode } = require("./utils");
const { walk } = require("./utils");

async function mkdirAndGet(sftp, src, dst, opt) {
  await fs.ensureDir(path.dirname(dst));
  return fastGet(sftp, src, dst, opt)
    .catch((e)=>{
      e.src = src;
      e.dst = dst;
      e.opt = opt;
      return Promise.reject(e);
    });
}

async function mkdirAndPut(sftp, src, dst, opt) {
  try {
    await mkdir_p(sftp, path.posix.dirname(dst));
  } catch (e) {
    if (e.code !== "EISDIR") {
      return Promise.reject(e);
    }
  }
  return fastPut(sftp, src, dst, opt).catch((e)=>{
    e.src = src;
    e.dst = dst;
    e.opt = opt;
    return Promise.reject(e);
  });
}

function replacePathsep(oldPath) {
  if (path.sep === path.win32.sep) {
    const newPath = oldPath.replace(new RegExp(`\\${path.win32.sep}`, "g"), path.posix.sep);
    return newPath;
  }
  return oldPath;
}

async function remoteStatAdaptor(sftp, target, parser) {
  try {
    const stats = await stat(sftp, target);
    return parser(stats);
  } catch (err) {
    if (err.message === "No such file" || err.code === "ENOENT" || err.code === "ENOTDIR") {
      return false;
    }
    return Promise.reject(err);
  }
}

async function promisify2(fn, ...orgArgs) {
  return new Promise((resolve, reject)=>{
    const rt = fn(...orgArgs, (err, result)=>{
      if (err) {
        reject(err);
      }
      resolve(result);
    });

    if (!rt) {
      reject(new Error("wait for continue"));
    }
  });
}

/**
 * Get absolute path on server.
 * @param {Object} sftp - Sftp stream object.
 * @param {string} argTarget - Target directory path on remote server.
 */
async function realpath(sftp, argTarget) {
  const target = (argTarget.endsWith("/") || argTarget.endsWith("\\")) ? argTarget.slice(0, -1) : argTarget;
  return promisify2(sftp.realpath.bind(sftp), target);
}

/**
 * Make directory recursively.
 * @param {Object} sftp - Sftp stream object.
 * @param {string} target - Target directory path on remote server.
 */
async function mkdir_p(sftp, target) { //eslint-disable-line camelcase
  debug(`mkdir_p called with ${target}`);

  //sftp.mkdir() just throw "Failure" if attempt to make directory on existing file
  //so, we check if the file exists or not before call mkdir
  if (await isFile(sftp, target)) {
    const e = new Error("attempt to create directory on existing path");
    e.path = target;
    e.code = "EEXIST";
    throw (e);
  }

  //push absent dirs to stack
  const stack = [];

  let current = target;
  while (!await isDir(sftp, current)) {
    debug(`${current} does not exist`);
    stack.push(current);
    current = path.posix.dirname(current);
  }

  //mkdir absent parent dirs one by one
  while (stack.length > 0) {
    const dir = stack.pop();

    try {
      debug(`mkdir ${dir}`);
      await mkdir(sftp, dir);
    } catch (err) {
      if (err.message !== "No such file" && err.code !== "ENOENT" && err.code !== "ENOTDIR" && err.code !== "EEXIST") {
        throw (err);
      }
    }
  }
}

/**
 * Check if specified path is exist or not.
 * @param {Object} sftp - Sftp stream object.
 * @param {string} target - Path which will be tested.
 * @returns {boolean} - True if specified path is exist, false if not exist.
 */
async function isExist(sftp, target) {
  return remoteStatAdaptor(sftp, target, ()=>{
    return true;
  });
}


/**
 * Check if specified path is directory or not.
 * @param {Object} sftp - Sftp stream object.
 * @param {string} target - Path which will be tested.
 * @returns {boolean} - True if specified directory is exist, false if not exist or it is not directory.
 */
async function isDir(sftp, target) {
  return remoteStatAdaptor(sftp, target, S_ISDIR);
}

/**
 * Check if specified path is fie or not.
 * @param {Object} sftp - Sftp stream object.
 * @param {string} target - Path which will be tested.
 * @returns {boolean} - True if specified file is exist, false if not exist or it is not file.
 */
async function isFile(sftp, target) {
  return remoteStatAdaptor(sftp, target, S_ISREG);
}

/**
 * Get file size.
 * @param {Object} sftp - Sftp stream object.
 * @param {string} target - Directory or filename which you want to see.
 * @returns {number} - File size in Byte.
 */
//eslint-disable-next-line no-unused-vars
async function getSize(sftp, target) {
  return remoteStatAdaptor(sftp, target, returnSize);
}

/*
 * difference between put/get and its r version
 * put/get
 * - if src does not exist or is directory, it will be rejected
 * - if dst is existing file, it will be overwriten by src.
 * - if dst does not exist and it ends with path separator ('/' or '\'), dst directory will be created.
 *   and src file will be transferd into the directory.
 *   if parent directory also does not exist, it will be created recursively. (like mkdir -p)
 * - if dst does not exist, src will be transferd and renamed to dst
 *
 * rput/rget
 * - if dst is existing file, it will be rejected with Error('destination path must not be existing file')
 * - if dst does not exit, dst directory will be created.
 * - src will be transferd into dst (src -> dst/src) both file and directory
 */

/**
 * Put single file to server to server to server to server to server.
 * @param {Object} sftp - Sftp stream object.
 * @param {string} src - Filename which will be transferd.
 * @param {string} dst - Destination path.
 * @param {string} only - Glob pattern for files to send.
 * @param {string} exclude - Glob pattern for files not to send.
 * @param {Object} opt - Option object to ssh2's fastget.
 */
async function put(sftp, src, dst, only, exclude, opt = {}) {
  let dstFile = dst;

  if (dst.endsWith("/") || dst.endsWith("\\") || (await isDir(sftp, dst))) {
    //src will be send under dst directory
    dstFile = path.posix.join(dst, path.basename(src));
  }

  if (typeof only === "string" && !minimatch(src, only)) {
    debug("put:", src, "canceled because it does not match only filter");
    return Promise.resolve();
  }

  if (typeof exclude === "string" && minimatch(src, exclude)) {
    debug("put:", src, "canceled because it match exclude filter");
    return Promise.resolve();
  }

  if (process.platform !== "win32") {
    const stats = await promisify(fs.stat)(src);
    opt.mode = getFileMode(stats.mode);
    debug(`put: ${src} will be set ${opt.mode}`);
  }
  debug("put: from", src, "to", dstFile);
  return mkdirAndPut(sftp, src, dstFile, opt);
}

/**
 * create writable stream
 * @param {Object} sftp - Sftp stream object.
 * @param {string} dst - file path
 * @param {Object} opt - option object
 */
async function createWriteStream(sftp, dst, opt) {
  debug("create writeStream of ", dst);

  if (await isDir(sftp, dst)) {
    return Promise.reject(new Error("does not support stream for directory"));
  }
  return sftp.createWriteStream(dst, opt);
}

/**
 * Put file or directories recursively.
 * @param {Object} sftp - Sftp stream object.
 * @param {string} src -      File or directory name which should be transferd.
 * @param {string} dst -      Destination path.
 * @param {string} only - Glob pattern for files to send.
 * @param {string} exclude - Glob pattern for files not to send.
 * @param {Object} opt - Option object to ssh2's fastget.
 */
async function rput(sftp, src, dst, only, exclude, opt = {}) {
  if (await isFile(sftp, dst)) {
    return Promise.reject(new Error("destination path must not be existing file"));
  }

  await mkdir_p(sftp, dst);

  //pick up all files and directries on src side
  const srcFiles = [];
  const srcDirs = [];
  await walk(src, promisify(fs.readdir), promisify(fs.stat), path.join, srcDirs, srcFiles);

  //transfer files 1 by 1
  for (const srcFile of srcFiles) {
    const dstFile = path.posix.join(dst, replacePathsep(path.relative(path.dirname(src), srcFile)));

    if (typeof only === "string" && !minimatch(srcFile, only)) {
      debug("rput:", srcFile, "skipped because it does not match only filter");
      continue;
    }

    if (typeof exclude === "string" && minimatch(srcFile, exclude)) {
      debug("rput:", srcFile, "skipped because it match exclude filter");
      continue;
    }

    const opt2 = Object.assign({}, opt);
    if (process.platform !== "win32") {
      const stats = await promisify(fs.stat)(srcFile);
      opt2.mode = getFileMode(stats.mode);
    }
    debug("rput: from", srcFile, "to", dstFile);
    await mkdirAndPut(sftp, srcFile, dstFile, opt2);
  }
  return true;
}

/**
 * Get single file from server.
 * @param {Object} sftp - Sftp stream object.
 * @param {string} src - Filename which will be transferd.
 * @param {string} dst - Destination path.
 * @param {string} only - Glob pattern for files to recieve.
 * @param {string} exclude - Glob pattern for files not to recieve.
 * @param {Object} opt - Option object to ssh2's fastget.
 */
async function get(sftp, src, dst, only, exclude, opt = {}) {
  debug("get", src, "to", dst, "with options\n", JSON.stringify({ only, exclude, opt }, null, 2));

  if (glob.hasMagic(src)) {
    debug("expand glob and recursive call");
    const filesToGet = await ls(sftp, src);
    return Promise.all(filesToGet.map((file)=>{
      return get(sftp, file, dst, only, exclude, opt);
    }));
  }

  //velify src
  if (await isDir(sftp, src)) {
    debug("delegate to rget", src);

    //delegate to recursive version
    return rget(sftp, src, dst, only, exclude, opt);
  }

  if (!await isFile(sftp, src)) {
    return Promise.reject(new Error("src must be existing file or directory"));
  }

  let dstFile = dst;

  if (dst.endsWith("/") || dst.endsWith("\\") || (await isDirLocal(dst))) {
    dstFile = path.join(dst, path.posix.basename(src));
  }

  if (typeof only === "string" && !minimatch(src, only)) {
    debug("get:", src, "canceled because it does not match only filter");
    return Promise.resolve();
  }

  if (typeof exclude === "string" && minimatch(src, exclude)) {
    debug("get:", src, "canceled because it match exclude filter");
    return Promise.resolve();
  }
  debug("get: from", src, "to", dstFile);
  return mkdirAndGet(sftp, src, dstFile, opt);
}

/**
 * create readable stream
 * @param {Object} sftp - Sftp stream object.
 * @param {string} src - file path
 * @param {Object} opt - option object
 */
async function createReadStream(sftp, src, opt) {
  debug("create readStream of ", src);

  if (await isDir(sftp, src)) {
    return Promise.reject(new Error("does not support stream for directory"));
  }
  if (!await isFile(sftp, src)) {
    return Promise.reject(new Error("src must be existing file"));
  }
  return sftp.createReadStream(src, opt);
}

/**
 * Get file or directories recursively.
 * @param {Object} sftp - Sftp stream object.
 * @param {string} src - Filename which will be transferd.
 * @param {string} dst - Destination path.
 * @param {string} only - Glob pattern for files to recieve.
 * @param {string} exclude - Glob pattern for files not to recieve.
 * @param {Object} opt - Option object to ssh2's fastget.
 */
async function rget(sftp, src, dst, only, exclude, opt = {}) {
  if (await isFileLocal(dst)) {
    return Promise.reject(new Error("destination path must not be existing file"));
  }
  await fs.ensureDir(dst);
  const srcRoot = replacePathsep(path.posix.dirname(src));

  //pick up all files and directries on src side
  const srcFiles = [];
  const srcDirs = [];
  await walk(src, readdir.bind(null, sftp), stat.bind(null, sftp), path.posix.join, srcDirs, srcFiles);

  //transfer files
  for (const srcFile of srcFiles) {
    const dstFile = path.join(dst, (path.posix.relative(srcRoot, srcFile)));

    if (typeof only === "string" && !minimatch(srcFile, only)) {
      debug("rget:", srcFile, "canceled because  it does not match only filter");
      continue;
    }

    if (typeof exclude === "string" && minimatch(srcFile, exclude)) {
      debug("rget:", srcFile, "canceled because it match exclude filter");
      continue;
    }
    debug("rget: from", srcFile, "to", dstFile);
    await mkdirAndGet(sftp, srcFile, dstFile, opt);
  }
  return true;
}

/**
 * Get filenames from server.
 * @param {Object} sftp - Sftp stream object.
 * @param {string} argTarget - Directory or filename which you want to see.
 * @returns {string[]} - Return array of filenames if there is only one file.
 */
async function ls(sftp, argTarget) {
  const target = replacePathsep(argTarget);
  if (glob.hasMagic(target)) {
    debug("ls with glob", target);
    const rt = [];
    const mm = minimatch2(target);
    for (const separatedPath of mm.set) {
      if (separatedPath[0] === "") {
        separatedPath[0] = path.posix.sep;
      }
      let memo = [];
      while (separatedPath.length !== 0) {
        const current = separatedPath.shift();

        if (typeof current !== "string") {
          const updatedList = [];
          while (memo.length > 0) {
            const parentDir = memo.shift();
            if (await isFile(sftp, parentDir)) {
              continue;
            }
            const candidate = await readdir(sftp, parentDir);
            const matched = candidate.filter((e)=>{
              return current.test(e);
            });
            if (matched.length > 0) {
              updatedList.push(...matched.map((e)=>{
                return path.posix.join(parentDir, e);
              }));
            }
          }
          memo = updatedList;
        } else {
          if (memo.length === 0) {
            memo.push(current);
          } else {
            memo = memo.map((e)=>{
              return path.posix.join(e, current);
            });
          }
        }
      }
      rt.push(...memo);
    }
    return rt;
  }

  if (await isDir(sftp, target)) {
    debug("ls dir", target);
    const contents = await readdir(sftp, target);
    return contents.map((e)=>{
      return path.posix.join(target, e);
    });
  }

  debug("ls file", target);

  try {
    await stat(sftp, target);
  } catch (err) {
    if (err.message === "No such file") {
      return [];
    }
    return Promise.reject(err);
  }

  return [target];
}

/**
 * Remove single file on server.
 * @param {Object} sftp - Sftp stream object.
 * @param {string} argTarget - Directory or filename which you want to see.
 */
async function rm(sftp, argTarget) {
  const target = replacePathsep(argTarget);

  if (await isDir(sftp, target)) {
    debug("rm dir", target);
    return rmdir(sftp, target);
  }
  debug("rm file", target);
  return unlink(sftp, target);
}

//eslint-disable-next-line no-unused-vars
async function rm_rf(sftp, target) {} //eslint-disable-line camelcase

//following functions are bridge to SFTPStream's client method
//https://github.com/mscdex/ssh2-streams/blob/master/SFTPStream.md#sftpstream-methods

async function fastGet(sftp, ...orgArgs) {
  return new Promise((resolve, reject)=>{
    sftp.fastGet(...orgArgs, (err)=>{
      if (err) {
        reject(err);
      }
      resolve();
    });
  });
}

async function fastPut(sftp, ...orgArgs) {
  return new Promise((resolve, reject)=>{
    sftp.fastPut(...orgArgs, (err)=>{
      if (err) {
        reject(err);
      }
      resolve();
    });
  });
}

async function readdir(sftp, target) {
  const files = await promisify2(sftp.readdir.bind(sftp), target);
  return files.map((e)=>{
    return e.filename;
  });
}

async function rename(sftp, ...orgArgs) {
  return promisify2(sftp.rename.bind(sftp), ...orgArgs);
}

async function mkdir(sftp, ...orgArgs) {
  return promisify2(sftp.mkdir.bind(sftp), ...orgArgs);
}

async function stat(sftp, ...orgArgs) {
  return promisify2(sftp.stat.bind(sftp), ...orgArgs);
}

//eslint-disable-next-line no-unused-vars
async function lstat(sftp, ...orgArgs) {
  return promisify2(sftp.lstat.bind(sftp), ...orgArgs);
}

async function chown(sftp, ...orgArgs) {
  return promisify2(sftp.chown.bind(sftp), ...orgArgs);
}

async function chmod(sftp, ...orgArgs) {
  return promisify2(sftp.chmod.bind(sftp), ...orgArgs);
}

async function symlink(sftp, ...orgArgs) {
  return promisify2(sftp.symlink.bind(sftp), ...orgArgs);
}

async function unlink(sftp, ...orgArgs) {
  return promisify2(sftp.unlink.bind(sftp), ...orgArgs);
}

async function rmdir(sftp, ...orgArgs) {
  return promisify2(sftp.rmdir.bind(sftp), ...orgArgs);
}

module.exports = {
  put,
  rput,
  get,
  mkdir_p,
  rm_rf,
  realpath,
  ls,
  chmod,
  chown,
  rename,
  symlink,
  rm,
  createReadStream,
  createWriteStream,
  getSize,
  isExist
};
