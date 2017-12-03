const {promisify} = require('util');
const path = require('path');
const fs = require('fs');
const {checkStatWrapper, isDirLocal, isFileLocal, S_ISREG, S_ISDIR, returnSize, retry} = require('./utils');

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
  }

  realpath(target){
    //TODO need get pathsep on remote side
    if(target.endsWith('/')) target = target.slice(0, -1);
    if(target.endsWith('\\')) target = target.slice(0, -1);
    return promisify(this.sftp.realpath.bind(this.sftp))(target);
  }

  /**
   * make directory on remote host recursively (like mkdir -p)
   * @param {Object} sftp - SFTPStream
   * @param {string} target - directory path
   */
  async mkdir_p(target){
    if(await this.isDir(target)) return;

    let stack=[];
    await this._findPathUpward(target, stack);

    // mkdir absent parent dirs one by one
    while(stack.length>1){
      let absPath = await this.realpath(stack.pop())
      if(! await this.isDir(absPath)){
        this.mkdir(absPath)
      }
    }

    // make target dir and return mkdir's promise
    target = await this.realpath(stack.pop());
    return this.mkdir(target)
      .catch((e)=>{
        e.target = target;
        throw e;
      });
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
        throw err;
      }
  //TODO path.basename should be changed path.posix or path.win32 according to remote or local server OS
      return [path.basename(target)]
    }
  }

  /**
   * put file
   * @param {string} src     - filename which should be transferd to dst
   * @param {string} dst     - remote directory path which file will be upload to
   * @param {Object} options - option object to ssh2's fastget
   */
  put(src, dst, opt={}){
    return this._putget(src, dst, opt, 'put');
  }

  /**
   * get file
   * @param {string} src     - filename which should be transferd to dst
   * @param {string} dst     - local directory path which files will be download to
   * @param {Object} options - option object to ssh2's fastget
   */
  get(src, dst, opt={}){
    return this._putget(src, dst, opt, 'get');
  }

  /**
   * check if specified path is directory or not
   * @param {string} target - path which will be tested
   * @returns {boolean} - true if specified directory is exist, false if not exist or it is not directory
   */
  isDir(target){
    return  checkStatWrapper.bind(this, this.sftp.stat.bind(this.sftp), S_ISDIR)(target);
  }
  /**
   * check if specified path is fie or not
   * @param {string} target - path which will be tested
   * @returns {boolean} - true if specified file is exist, false if not exist or it is not file
   */
  isFile(target){
    return  checkStatWrapper.bind(this, this.sftp.stat.bind(this.sftp), S_ISREG)(target);
  }
  /**
   * get file size
   * @param {string} target - directory or filename which you want to see
   * @returns {number} - file size in Byte
   */
  async getSize(target){
    return  checkStatWrapper.bind(this, this.sftp.stat.bind(this.sftp), returnSize)(target);
  }

  /**
   * multi file/dir transfer
   * @param { string| string[]} src - filename or array of filenames which will be transferd
   * @param { string } dst - destination path
   * @param { Object } opt - option object of func
   * @param { string } mode - put or get
   */
  async _putget(src, dst, opt, mode){
    if(mode !== 'put' && mode !== 'get'){
      throw new Error('mode must be put or get');
    }
    let func =   mode === 'put' ? this.fastPut.bind(this) : this.fastGet.bind(this);
    let isDir =  mode === 'put' ? this.isDir.bind(this) : isDirLocal
    let isFile = mode === 'put' ? isFileLocal : this.isFile.bind(this);

    // velify src and dst
    if(typeof src !== 'string') throw new Error('src must be string');
    let srcIsFile = await isFile(src)
      .catch((err)=>{
        throw new Error('isFile failed due to unknow error');
      });
    if(! srcIsFile) throw new Error('src must be file');

    let dstIsDir = await isDir(dst)
      .catch((err)=>{
        throw new Error('isDir failed with unknow error');
      })

    if(! dstIsDir && (dst.endsWith('/') || dst.endsWith('\\'))){
      await this.mkdir_p(dst);
      dstIsDir=true;
    }

    if(dstIsDir){
  //TODO path.basename should be changed path.posix or path.win32 according to remote or local server OS
      dst = path.join(dst, path.basename(src));
    }

    return func(src, dst, opt).catch((e)=>{
      e.func=func
      e.src=src;
      e.dst=dst;
      e.opt=opt;
      return Promise.reject(e);
    });
  }

  _findPathUpward(target, stack){
    return this.realpath(target)
      .then((absPath)=>{
        stack.push(absPath);
      })
      .catch((err)=>{
        if(err.message === 'No such file'){
          stack.push(target)
          let parent = path.dirname(target);
          return this._findPathUpward(parent, stack);
        }
        err.targetPath = target;
        throw err;
      });
  }
}

module.exports=SftpUtil;
