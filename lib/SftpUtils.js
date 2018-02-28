const { promisify } = require("util");
const path = require("path");
const fs = require("fs");

const minimatch = require("minimatch");
const debug = require("debug")("arssh2:sftpUtil");

const { checkStatWrapper, isDirLocal, isFileLocal } = require("./utils");
const { S_ISREG, S_ISDIR, returnSize, getFileMode } = require("./utils");
const { mkdirIfNotExist, mkdir_p, mkdir_pLocal, walk } = require("./utils");

function replacePathsep(oldPath) {
  if (path.sep === path.win32.sep) {
    let newPath = oldPath.replace(
      new RegExp("\\" + path.win32.sep, "g"),
      path.posix.sep
    );
    return newPath;
  } else {
    return oldPath;
  }
}

// utility functions along with sssh2's SFTPStream
//
// this class provide some of promisified SFTPStream client method
// and following extended functions:
// - isDir
// - isFile
// - mkdir_p
// - ls
// - getSize
// - put
// - get
//
// https://github.com/mscdex/ssh2-streams/blob/master/SFTPStream.md#sftpstream-methods
class SftpUtil {
  constructor(sftp) {
    this.sftp = sftp;

    //define just promisified version
    this.readdir = promisify(this.sftp.readdir.bind(this.sftp));
    this.chmod = promisify(this.sftp.chmod.bind(this.sftp));
    this.stat = promisify(this.sftp.stat.bind(this.sftp));
    this.lstat = promisify(this.sftp.lstat.bind(this.sftp));
    this.unlink = promisify(this.sftp.unlink.bind(this.sftp));
    this.mkdir = promisify(this.sftp.mkdir.bind(this.sftp));
    this.rmdir = promisify(this.sftp.rmdir.bind(this.sftp));
    this.fastGet = promisify(this.sftp.fastGet.bind(this.sftp));
    this.fastPut = promisify(this.sftp.fastPut.bind(this.sftp));
  }

  async optSetter(opt, stat, file) {
    if (process.platform === "win32") return opt;
    let newOpt = Object.assign({}, opt);
    let stats = await stat(file);
    newOpt.mode = getFileMode(stats.mode);
    return newOpt;
  }

  async readdirAdoptor(target) {
    let files = await this.readdir(target);
    return files.map(e => {
      return e.filename;
    });
  }

  /**
   * make directory recursively
   * @param {stiring} target - target directory path on remote server
   */
  async mkdir_p(target) {
    return mkdir_p(
      this.mkdir.bind(this),
      this.realpath.bind(this),
      this.isDir.bind(this),
      target
    );
  }

  /**
   * get filename from remote server
   * @param {string} target - directory or filename which you want to see
   * @returns {string[]} - return array of filenames if there is only one file
   */
  async ls(argTarget) {
    const target = replacePathsep(argTarget);
    if (await this.isDir(target)) {
      debug("ls dir", target);
      let attrs = await this.readdir(target);
      let rt = attrs.map(e => {
        return e.filename;
      });
      return rt;
    } else {
      debug("ls file", target);
      try {
        await this.stat(target);
      } catch (err) {
        if (err.message === "No such file") {
          return [];
        }
        return Promise.reject(err);
      }
      return [path.posix.basename(target)];
    }
  }

  async realpath(target) {
    if (target.endsWith("/")) target = target.slice(0, -1);
    if (target.endsWith("\\")) target = target.slice(0, -1);
    return promisify(this.sftp.realpath.bind(this.sftp))(target);
  }

  /**
   * check if specified path is directory or not
   * @param {string} target - path which will be tested
   * @returns {boolean} - true if specified directory is exist, false if not exist or it is not directory
   */
  async isDir(target) {
    return checkStatWrapper.bind(this, this.stat.bind(this), S_ISDIR)(target);
  }

  /**
   * check if specified path is fie or not
   * @param {string} target - path which will be tested
   * @returns {boolean} - true if specified file is exist, false if not exist or it is not file
   */
  async isFile(target) {
    return checkStatWrapper.bind(this, this.stat.bind(this), S_ISREG)(target);
  }

  /**
   * get file size
   * @param {string} target - directory or filename which you want to see
   * @returns {number} - file size in Byte
   */
  async getSize(target) {
    return checkStatWrapper.bind(this, this.stat.bind(this), returnSize)(
      target
    );
  }

  /*
   * difference between put/get and its _R version
   * put/get
   * - if src does not exist or is directory, it will be rejected
   * - if dst is existing file, it will be overwriten by src.
   * - if dst does not exist and it ends with path separator ('/' or '\'), dst directory will be created.
   *   and src file will be transferd into the directory.
   *   if parent directory also does not exist, it will be created recursively. (like mkdir -p)
   * - if dst does not exist, src will be transferd and renamed to dst
   *
   * _R version
   * - if dst is existing file, it will be rejected with Error('dstination path must not be existing file')
   * - if dst does not exit, dst directory will be created.
   * - if src is file src will be transferd into dst (src -> dst/src)
   * - if src is directory src's contents will be transferd into dst (src/* -> dst/*)
   */

  /**
   * put file or directories recursively
   * @param {string} src     - file or directory name which should be transferd
   * @param {string} dst     - destination path
   * @param {Object} options - option object to ssh2's fastget
   */
  async put_R(src, dst, only, exclude, opt) {
    debug("recursive put from ", src, "to", dst);
    return this._putget_R(
      this.fastPut.bind(this),
      this.isDir.bind(this),
      this.isFile.bind(this),
      this.mkdir_p.bind(this),
      this.mkdir.bind(this),
      promisify(fs.readdir),
      promisify(fs.stat),
      path.posix,
      path,
      this.optSetter.bind(this),
      src,
      dst,
      only,
      exclude,
      opt
    );
  }
  /**
   * get file or directories recursively
   * @param {string} src     - file or directory name which should be transferd
   * @param {string} dst     - destination path
   * @param {Object} options - option object to ssh2's fastget
   */
  async get_R(src, dst, only, exclude, opt) {
    debug("recursive get from ", src, "to", dst);
    return this._putget_R(
      this.fastGet.bind(this),
      isDirLocal,
      isFileLocal,
      mkdir_pLocal,
      promisify(fs.mkdir),
      this.readdirAdoptor.bind(this),
      this.stat.bind(this),
      path,
      path.posix,
      null,
      src,
      dst,
      only,
      exclude,
      opt
    );
  }
  /**
   * put single file to server to server to server to server to server
   * @param {string} src     - filename which will be transferd
   * @param {string} dst     - destination path
   * @param {Object} options - option object to ssh2's fastget
   */
  async put(src, dst, only, exclude, opt) {
    debug("put from ", src, "to", dst);
    return this._putget(
      this.fastPut.bind(this),
      this.isDir.bind(this),
      isFileLocal,
      this.mkdir_p.bind(this),
      promisify(fs.stat),
      path.posix,
      path,
      this.optSetter,
      src,
      dst,
      only,
      exclude,
      opt
    );
  }
  /**
   * get single file from server
   * @param {string} src     - filename which will be transferd
   * @param {string} dst     - destination path
   * @param {Object} options - option object to ssh2's fastget
   */
  async get(src, dst, only, exclude, opt) {
    debug("get from ", src, "to", dst);
    return this._putget(
      this.fastGet.bind(this),
      isDirLocal,
      this.isFile.bind(this),
      mkdir_pLocal,
      this.stat.bind(this),
      path,
      path.posix,
      null,
      src,
      dst,
      only,
      exclude,
      opt
    );
  }

  /**
   * single file transfer
   * @param { string } src - filename which will be transferd
   * @param { string } dst - destination path
   * @param { Object } opt - option object of func
   */
  async _putget(
    func,
    isDirDst,
    isFileSrc,
    mkdir_p,
    stat,
    pathDst,
    pathSrc,
    optSetter,
    src,
    dst,
    only,
    exclude,
    opt = {}
  ) {
    // velify src and dst
    if (typeof src !== "string")
      return Promise.reject(new Error("src must be string"));
    let srcIsFile = await isFileSrc(src);
    if (!srcIsFile) return Promise.reject(new Error("src must be file"));

    let dstIsDir = await isDirDst(dst);

    if (!dstIsDir) {
      if (dst.endsWith("/") || dst.endsWith("\\")) {
        // destination path is non existing directory
        await mkdir_p(dst);
        dstIsDir = true;
      } else {
        let dstParent = pathDst.dirname(dst);
        if (!await isDirDst(dstParent)) {
          // destination path is file in non existing directory
          await mkdir_p(dstParent);
        }
      }
    }
    if (dstIsDir) {
      dst = pathDst.join(dst, pathSrc.basename(src));
    }
    let opt2 = opt;
    if (optSetter) {
      opt2 = await optSetter(opt, stat, src);
    }
    if (only !== null && !minimatch(src, only)) return Promise.resolve();
    if (exclude !== null && minimatch(src, exclude)) return Promise.resolve();
    debug("_putget: from", src, "to", dst);
    return func(src, dst, opt2).catch(e => {
      e.func = func;
      e.src = src;
      e.dst = dst;
      e.opt = opt;
      return Promise.reject(e);
    });
  }

  /**
   * recursive file transfer
   * @param { string } src - file or directory name which will be transferd
   * @param { string } dst - destination directory path
   * @param { Object } opt - option object of func
   */
  async _putget_R(
    func,
    isDirDst,
    isFileDst,
    mkdir_p,
    mkdir,
    readdir,
    stat,
    pathDst,
    pathSrc,
    optSetter,
    src,
    dst,
    only,
    exclude,
    opt = {}
  ) {
    if (await isFileDst(dst)) {
      return Promise.reject(
        new Error("dstination path must not be existing file")
      );
    }
    await mkdir_p(dst);

    // pick up all files and directries on src side
    let srcFiles = [];
    let srcDirs = [];
    await walk(src, readdir, stat, pathSrc.join, srcDirs, srcFiles);

    // make directries on dst side
    await srcDirs.reduce((p, e) => {
      return p.then(
        mkdirIfNotExist.bind(
          this,
          isDirDst,
          mkdir,
          pathDst.join(dst, pathSrc.relative(src, e))
        )
      );
    }, Promise.resolve());

    // make opts
    let pOpts = srcFiles.map(async srcFile => {
      if (optSetter) {
        return optSetter(opt, stat, srcFile);
      } else {
        return opt;
      }
    });
    let opts = await Promise.all(pOpts);

    // transfer files
    let pFile = srcFiles.map((srcFile, i) => {
      let dstFile = pathDst.join(
        dst,
        replacePathsep(pathSrc.relative(src, srcFile))
      );
      if (only !== null && !minimatch(srcFile, only)) return Promise.resolve();
      if (exclude !== null && minimatch(srcFile, exclude))
        return Promise.resolve();
      debug("_putget_R: from", srcFile, "to", dstFile);
      return func(srcFile, dstFile, opts[i]).catch(e => {
        e.func = func;
        e.src = src;
        e.dst = dst;
        e.opt = opt;
        return Promise.reject(e);
      });
    });

    return Promise.all(pFile);
  }
}

module.exports = SftpUtil;
