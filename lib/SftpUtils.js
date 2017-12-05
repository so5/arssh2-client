const {promisify} = require('util');
const path = require('path');
const fs = require('fs');

const debug = require('debug')('arssh2: sftpUtil');

const {checkStatWrapper, isDirLocal, isFileLocal, S_ISREG, S_ISDIR, returnSize} = require('./utils');
const {mkdirIfNotExist, mkdir_p, mkdir_pLocal, walk, retry} = require('./utils');

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
class SftpUtil{
  constructor(sftp){
    this.sftp=sftp;

    //define just promisified version
    this.readdir=promisify(this.sftp.readdir.bind(this.sftp));
    this.stat=promisify(this.sftp.stat.bind(this.sftp));
    this.lstat=promisify(this.sftp.lstat.bind(this.sftp));
    this.unlink=promisify(this.sftp.unlink.bind(this.sftp));
    this.mkdir=promisify(this.sftp.mkdir.bind(this.sftp));
    this.rmdir=promisify(this.sftp.rmdir.bind(this.sftp));
    this.fastGet=promisify(this.sftp.fastGet.bind(this.sftp));
    this.fastPut=promisify(this.sftp.fastPut.bind(this.sftp));

    this.functions = {
      func      : { put: this.fastPut.bind(this), get: this.fastGet.bind(this) },
      isDirDst  : { put: this.isDir.bind(this),   get: isDirLocal },
      isFileSrc : { put: isFileLocal,             get: this.isFile.bind(this) },
      isFileDst : { put: this.isFile.bind(this),  get: isFileLocal },
      mkdir_p   : { put: this.mkdir_p.bind(this), get: mkdir_pLocal },
      mkdir     : { put: this.mkdir.bind(this),   get: promisify(fs.mkdir) },
      readdir   : { put: promisify(fs.readdir),   get: this.readdir.bind(this) },
      stat      : { put: promisify(fs.stat),      get: this.stat.bind(this) }
    }
  }
  /**
   * make directory recursively
   * @param {stiring} target - target directory path on remote server
   */
  async mkdir_p(target){
    return mkdir_p(this.mkdir.bind(this), this.realpath.bind(this), this.isDir.bind(this), target);
  }

  /*
   * difference between put/get and its _R version
   * put/get
   * - if dst is existing file, it will be overwriten by src.
   * - if dst end with path separator ('/' or '\'), dst directory will be created
   *   and src file will be transferd into the directory
   * - if dst is not exist, src will be transferd and renamed to dst
   * - if dst and its parent is not exist parent directory will be created
   *   and src file will be transferd into the directory
   *
   * _R version
   * - if dst is existing file, it will be rejected with Error('dstination path must not be existing file')
   * - if dst is existing directory, src directry will be transferd into dst (src -> dst/src/)
   * - if src is file and dst is not exist, dst directory will be created and src will be transferd into dst (src -> dst/src)
   * - if src is directory and dst is not exist, dst directory will be created and src's contents will be transferd into dst (src -> dst)
   */

  /**
   * put file or directories recursively
   * @param {string} src     - file or directory name which should be transferd
   * @param {string} dst     - destination path
   * @param {Object} options - option object to ssh2's fastget
   */
  async put_R(src, dst, opt){
    return this._putget_R('put', src, dst, opt);
  }
  /**
   * get file or directories recursively
   * @param {string} src     - file or directory name which should be transferd
   * @param {string} dst     - destination path
   * @param {Object} options - option object to ssh2's fastget
   */
  async get_R(src, dst, opt){
    return this._putget_R('get', src, dst, opt);
  }
  /**
   * put single file to server to server to server to server to server
   * @param {string} src     - filename which will be transferd
   * @param {string} dst     - destination path
   * @param {Object} options - option object to ssh2's fastget
   */
  async put(src, dst, opt){
    return  this._putget('put', src, dst, opt);
  }
  /**
   * get single file from server
   * @param {string} src     - filename which will be transferd
   * @param {string} dst     - destination path
   * @param {Object} options - option object to ssh2's fastget
   */
  async get(src, dst, opt){
    return  this._putget('get', src, dst, opt);
  }

  /**
   * get filename from remote server
   * @param {string} target - directory or filename which you want to see
   * @returns {string[]} - return array of filenames if there is only one file
   */
  async ls(target){
    if(await this.isDir(target)){
      let attrs = await this.readdir(target);
      let rt = attrs.map((e)=>{
        return e.filename
      });
      return rt;
    }else{
      try{
        await this.stat(target)
      }catch(err){
        if(err.message === 'No such file'){
          return [];
        }
        return Promise.reject(err);
      }
  //TODO path.basename should be changed path.posix or path.win32 according to remote or local server OS
      return [path.basename(target)]
    }
  }

  async realpath(target){
    //TODO need get pathsep on remote side
    if(target.endsWith('/')) target = target.slice(0, -1);
    if(target.endsWith('\\')) target = target.slice(0, -1);
    return promisify(this.sftp.realpath.bind(this.sftp))(target);
  }

  /**
   * check if specified path is directory or not
   * @param {string} target - path which will be tested
   * @returns {boolean} - true if specified directory is exist, false if not exist or it is not directory
   */
  async isDir(target){
    return  checkStatWrapper.bind(this, this.stat.bind(this), S_ISDIR)(target);
  }

  /**
   * check if specified path is fie or not
   * @param {string} target - path which will be tested
   * @returns {boolean} - true if specified file is exist, false if not exist or it is not file
   */
  async isFile(target){
    return  checkStatWrapper.bind(this, this.stat.bind(this), S_ISREG)(target);
  }

  /**
   * get file size
   * @param {string} target - directory or filename which you want to see
   * @returns {number} - file size in Byte
   */
  async getSize(target){
    return  checkStatWrapper.bind(this, this.stat.bind(this), returnSize)(target);
  }

  /**
   * file/dir transfer
   * @param { string } mode - put or get
   * @param { string } src - filename which will be transferd
   * @param { string } dst - destination path
   * @param { Object } opt - option object of func
   */
  async _putget(mode, src, dst, opt={}){
    if(mode !== 'put' && mode !== 'get'){
      return Promise.reject(new Error('mode must be put or get'));
    }
    let func      = this.functions.func[ mode ];
    let isDirDst  = this.functions.isDirDst[ mode ];
    let isFileSrc = this.functions.isFileSrc[ mode ];
    let isFileDst = this.functions.isFileDst[ mode ];
    let mkdir_p   = this.functions.mkdir_p[ mode ];

    // velify src and dst
    if(typeof src !== 'string') return Promise.reject(new Error('src must be string'));
    let srcIsFile = await isFileSrc(src)
    if(! srcIsFile) return Promise.reject(new Error('src must be file'));

    let dstIsFile = await isFileDst(dst);
    let dstIsDir = await isDirDst(dst)

    if(! dstIsDir){
      if (dst.endsWith('/') || dst.endsWith('\\')){
        // destination path is non existing directory
        await mkdir_p(dst);
        dstIsDir=true;
      }else{
        let dstParent = path.dirname(dst)
        if(!await isDirDst(dstParent)){
          // destination path is file in non existing directory
          await mkdir_p(dstParent);
        }
      }
    }

    if(dstIsDir){
  //TODO path.basename should be changed path.posix or path.win32 according to remote or local server OS
      dst = path.join(dst, path.basename(src));
    }

    return func(src, dst, opt)
      .catch((e)=>{
        e.func=func
        e.src=src;
        e.dst=dst;
        e.opt=opt;
        return Promise.reject(e);
      });
  }

  /**
   * recursive file transfer
   * @param { string } mode - put or get
   * @param { string } src - file or directory name which will be transferd
   * @param { string } dst - destination directory path
   * @param { Object } opt - option object of func
   */
  async _putget_R(mode, src, dst, opt){
    if(mode !== 'put' && mode !== 'get'){
      return Promise.reject(new Error('mode must be put or get'));
    }
    let func      = this.functions.func[ mode ];
    let isDirDst  = this.functions.isDirDst[ mode ];
    let isFileSrc = this.functions.isFileSrc[ mode ];
    let isFileDst = this.functions.isFileDst[ mode ];
    let mkdir_p   = this.functions.mkdir_p[ mode ];
    let mkdir     = this.functions.mkdir[ mode ];
    let readdir   = this.functions.readdir[ mode ];
    let stat      = this.functions.stat[ mode ];

    if(await isFileDst(dst)){
      return Promise.reject(new Error('dstination path must not be existing file'));
    }
    await mkdir_p(dst);

    // pick up all files and directries on src side
    let srcFiles=[];
    let srcDirs=[];
    await walk(src, readdir, stat, srcDirs, srcFiles);

    // make directries on dst side
    await srcDirs.reduce((p, e)=>{
      return p.then(mkdirIfNotExist.bind(this, isDirDst, mkdir, path.join(dst, path.relative(src, e))));
    }, Promise.resolve());

    // transfer files
    let pFile = srcFiles.map((srcFile)=>{
      let dstFile = path.join(dst, path.relative(src, srcFile));
      return func(srcFile, dstFile, opt)
        .catch((e)=>{
          e.func=func
          e.src=src;
          e.dst=dst;
          e.opt=opt;
          return Promise.reject(e);
        });
    });

    return Promise.all(pFile);
  }

}

module.exports=SftpUtil;
