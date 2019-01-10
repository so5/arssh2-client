const path = require("path");
const { promisify } = require("util");
const fs = require("fs-extra");
const minimatch = require("minimatch");
const debug = require("debug")("arssh2:sftpUtil");
const { isDirLocal, isFileLocal, S_ISREG, S_ISDIR, returnSize, getFileMode } = require("./utils");
const { walk } = require("./utils");

function _replacePathsep(oldPath) {
  if (path.sep === path.win32.sep) {
    const newPath = oldPath.replace(new RegExp(`\\${path.win32.sep}`, "g"), path.posix.sep);
    return newPath;
  }
  return oldPath;

}

async function _remoteStatAdaptor(sftp, target, parser) {
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

async function _promisify(fn, ...orgArgs) {
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
 * get absolute path on server
 * @param {stiring} target - target directory path on remote server
 */
async function realpath(sftp, target) {
  if (target.endsWith("/") || target.endsWith("\\")) {
    target = target.slice(0, -1);
  }

  return _promisify(sftp.realpath.bind(sftp), target);
}

/**
 * make directory recursively
 * @param {stiring} target - target directory path on remote server
 */
async function mkdir_p(sftp, target) {
  //push absent dirs to stack
  const stack = [];

  while (!await isDir(sftp, target)) {
    //sftp.mkdir() just throw "Failure" if attempt to make directory on existing file
    //so, we check if the file exists or not before call mkdir
    if (await isExist(sftp, target)) {
      const e = new Error("attemt to create directory on existing path");
      e.path = target;
      e.code = "EEXIST";
      return Promise.reject(e);
    }
    stack.push(target);
    target = path.posix.dirname(target);
  }

  //mkdir absent parent dirs one by one
  while (stack.length > 0) {
    const dir = stack.pop();

    try {
      await mkdir(sftp, dir);
    } catch (err) {
      if (err.message === "No such file" || err.code === "ENOENT" || err.code === "ENOTDIR" || err.code === "EEXIST") {
        //TODO retry
      } else {
        return Promise.reject(err);
      }
    }
  }
}

/**
 * check if specified path is exist or not
 * @param {string} target - path which will be tested
 * @returns {boolean} - true if specified path is exist, false if not exist
 */
async function isExist(sftp, target) {
  return _remoteStatAdaptor(sftp, target, ()=>{
    return true;
  });
}


/**
 * check if specified path is directory or not
 * @param {string} target - path which will be tested
 * @returns {boolean} - true if specified directory is exist, false if not exist or it is not directory
 */
async function isDir(sftp, target) {
  return _remoteStatAdaptor(sftp, target, S_ISDIR);
}

/**
 * check if specified path is fie or not
 * @param {string} target - path which will be tested
 * @returns {boolean} - true if specified file is exist, false if not exist or it is not file
 */
async function isFile(sftp, target) {
  return _remoteStatAdaptor(sftp, target, S_ISREG);
}

/**
 * get file size
 * @param {string} target - directory or filename which you want to see
 * @returns {number} - file size in Byte
 */
//eslint-disable-next-line no-unused-vars
async function getSize(sftp, target) {
  return _remoteStatAdaptor(sftp, target, returnSize);
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
 * - if src is file src will be transferd into dst (src -> dst/src)
 * - if src is directory src's contents will be transferd into dst (src/* -> dst/*)
 */

/**
 * put single file to server to server to server to server to server
 * @param {string} src     - filename which will be transferd
 * @param {string} dst     - destination path
 * @param {Object} options - option object to ssh2's fastget
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

  try {
    await mkdir_p(sftp, path.posix.dirname(dstFile));
  } catch (e) {
    if (e.code !== "EISDIR") {
      return Promise.reject();
    }
  }
  return fastPut(sftp, src, dstFile, opt).catch((e)=>{
    e.src = src;
    e.dst = dst;
    e.only = only;
    e.exclude = exclude;
    e.opt = opt;
    return Promise.reject(e);
  });
}

/**
 * put file or directories recursively
 * @param {string} src     - file or directory name which should be transferd
 * @param {string} dst     - destination path
 * @param {Object} options - option object to ssh2's fastget
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

  //make directries on dst side
  await srcDirs.reduce((p, e)=>{
    const target = path.posix.join(dst, path.relative(src, e));
    return p.then(mkdir_p.bind(null, sftp, target));
  }, Promise.resolve());

  //transfer files
  const pFile = srcFiles.map(async(srcFile)=>{
    const dstFile = path.posix.join(dst, _replacePathsep(path.relative(src, srcFile)));

    if (typeof only === "string" && !minimatch(srcFile, only)) {
      debug("rput:", srcFile, "canceled because  it does not match only filter");
      return Promise.resolve();
    }

    if (typeof exclude === "string" && minimatch(srcFile, exclude)) {
      debug("rput:", srcFile, "canceled because it match exclude filter");
      return Promise.resolve();
    }
    const opt2 = Object.assign({}, opt);

    if (process.platform !== "win32") {
      const stats = await promisify(fs.stat)(srcFile);
      opt2.mode = getFileMode(stats.mode);
    }
    debug("rput: from", srcFile, "to", dstFile);
    return fastPut(sftp, srcFile, dstFile, opt2).catch((e)=>{
      e.src = src;
      e.dst = dst;
      e.opt = opt;
      return Promise.reject(e);
    });
  });
  return Promise.all(pFile);
}

/**
 * get single file from server
 * @param {string} src     - filename which will be transferd
 * @param {string} dst     - destination path
 * @param {Object} options - option object to ssh2's fastget
 */
async function get(sftp, src, dst, only, exclude, opt = {}) {
  debug("get", src, "to", dst, "with options\n", JSON.stringify({ only, exclude, opt }, null, 2));

  //velify src
  if (await isDir(sftp, src)) {
    debug("delegate to rget");
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
  fs.ensureDir(path.dirname(dstFile));
  return fastGet(sftp, src, dstFile, opt).catch((e)=>{
    e.src = src;
    e.dst = dst;
    e.opt = opt;
    return Promise.reject(e);
  });
}

/**
 * get file or directories recursively
 * @param {string} src     - file or directory name which should be transferd
 * @param {string} dst     - destination path
 * @param {Object} options - option object to ssh2's fastget
 */
async function rget(sftp, src, dst, only, exclude, opt = {}) {
  if (await isFileLocal(dst)) {
    return Promise.reject(new Error("destination path must not be existing file"));
  }
  await fs.ensureDir(dst);

  //pick up all files and directries on src side
  const srcFiles = [];
  const srcDirs = [];
  await walk(src, readdir.bind(null, sftp), stat.bind(null, sftp), path.posix.join, srcDirs, srcFiles);

  //make directries on dst side
  await srcDirs.reduce((p, e)=>{
    return p.then(()=>{
      fs.ensureDir(path.join(dst, path.posix.relative(src, e)));
    });
  }, Promise.resolve());

  //transfer files
  const pFile = srcFiles.map((srcFile)=>{
    const dstFile = path.join(dst, _replacePathsep(path.posix.relative(src, srcFile)));

    if (typeof only === "string" && !minimatch(srcFile, only)) {
      debug("rget:", srcFile, "canceled because  it does not match only filter");
      return Promise.resolve();
    }

    if (typeof exclude === "string" && minimatch(srcFile, exclude)) {
      debug("rget:", srcFile, "canceled because it match exclude filter");
      return Promise.resolve();
    }
    debug("rget: from", srcFile, "to", dstFile);
    return fastGet(sftp, srcFile, dstFile, opt).catch((e)=>{
      e.src = src;
      e.dst = dst;
      e.opt = opt;
      return Promise.reject(e);
    });
  });
  return Promise.all(pFile);
}

/**
 * get filenames from server
 * @param {string} target - directory or filename which you want to see
 * @returns {string[]} - return array of filenames if there is only one file
 */
async function ls(sftp, argTarget) {
  const target = _replacePathsep(argTarget);

  if (await isDir(sftp, target)) {
    debug("ls dir", target);
    return readdir(sftp, target);
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
  return [path.posix.basename(target)];

}

//eslint-disable-next-line no-unused-vars
async function rm_rf(sftp, target) {}

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
  const files = await _readdir(sftp, target);
  return files.map((e)=>{
    return e.filename;
  });
}

async function _readdir(sftp, ...orgArgs) {
  return _promisify(sftp.readdir.bind(sftp), ...orgArgs);
}

async function rename(sftp, ...orgArgs) {
  return _promisify(sftp.rename.bind(sftp), ...orgArgs);
}

async function mkdir(sftp, ...orgArgs) {
  return _promisify(sftp.mkdir.bind(sftp), ...orgArgs);
}

async function stat(sftp, ...orgArgs) {
  return _promisify(sftp.stat.bind(sftp), ...orgArgs);
}

//eslint-disable-next-line no-unused-vars
async function lstat(sftp, ...orgArgs) {
  return _promisify(sftp.lstat.bind(sftp), ...orgArgs);
}

async function chown(sftp, ...orgArgs) {
  return _promisify(sftp.chown.bind(sftp), ...orgArgs);
}

async function chmod(sftp, ...orgArgs) {
  return _promisify(sftp.chmod.bind(sftp), ...orgArgs);
}

async function symlink(sftp, ...orgArgs) {
  return _promisify(sftp.symlink.bind(sftp), ...orgArgs);
}

//to be used in rm_rf
//eslint-disable-next-line no-unused-vars
async function unlink(sftp, ...orgArgs) {
  return _promisify(sftp.unlink.bind(sftp), ...orgArgs);
}

//eslint-disable-next-line no-unused-vars
async function rmdir(sftp, ...orgArgs) {
  return _promisify(sftp.rmdir.bind(sftp), ...orgArgs);
}

//remove if fastGet can get files via symlink
//eslint-disable-next-line no-unused-vars
async function readlink(sftp, ...orgArgs) {
  return _promisify(sftp.readlink.bind(sftp), ...orgArgs);
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
  symlink
};
