const util = require('util');
const path = require('path');
const fs = require('fs');

// helper function for isFile and isDirectory
function _checkStatWrapper(statFunc, mode, target){
  return new Promise((resolve, reject)=>{
    if( mode !== 'dir' && mode !== 'file') reject(new Error('mode must be dir or file'));
    statFunc(target, (err, stat)=>{
      if(err){
        if(err.message === 'No such file' || err.code === 'ENOENT'){
          resolve(false);
        }else{
          reject(err);
        }
        return
      }
      let checker= mode === 'dir'? stat.isDirectory.bind(stat):stat.isFile.bind(stat);
      resolve(checker());
    });
  });
}
let isDirLocal  = _checkStatWrapper.bind(fs, fs.stat, 'dir');
let isFileLocal = _checkStatWrapper.bind(fs, fs.stat, 'file');


// utility functions along with sssh2's SFTPStream
//
// this class provide some of promisified SFTPStream client method
// and following extended functions:
// - isDir
// - mkdir_p
// - mget
// - mput
//
// https://github.com/mscdex/ssh2-streams/blob/master/SFTPStream.md#sftpstream-methods
class sftpUtil{
  constructor(sftp){
    this.sftp=sftp;
  }

  /**
   * make directory on remote host recursively (like mkdir -p)
   * @param {Object} sftp - SFTPStream
   * @param {string} target - directory path
   */
  async mkdir_p(target){
    let stack=[];
    await this._recursiveRealpathUpward(target, stack);
    // mkdir absent parent dirs one by one
    while(stack.length>1){
      let dir=await this.realpath(stack.pop());
      await this.mkdir(dir)
        .catch((err)=>{throw new Error(err)});
    }
    // return promise from mkdir original target
    let tmp = stack.pop();
    target = await this.realpath(tmp);
    return this.mkdir(target)
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
        if(err.message !== 'No such file'){
          throw err;
        }
        return [];
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
  async put(src, dst, opt={}){
    return this._putget(src, dst, opt, 'put');
  }

  /**
   * get file
   * @param {string} src     - filename which should be transferd to dst
   * @param {string} dst     - local directory path which files will be download to
   * @param {Object} options - option object to ssh2's fastget
   */
  async get(src, dst, opt={}){
    return this._putget(src, dst, opt, 'get');
  }

  /**
   * check if specified path is directory or not
   * @param {string} target - path which will be tested
   * @returns {boolean} - true if specified directory is exist, false if not exist or it is not directory
   */
  isDir(target){
    return  _checkStatWrapper.bind(this, this.sftp.stat.bind(this.sftp), 'dir')(target);
  }
  /**
   * check if specified path is fie or not
   * @param {string} target - path which will be tested
   * @returns {boolean} - true if specified file is exist, false if not exist or it is not file
   */
  isFile(target){
    return  _checkStatWrapper.bind(this, this.sftp.stat.bind(this.sftp), 'file')(target);
  }

  readdir(target){
    return util.promisify(this.sftp.readdir.bind(this.sftp))(target);
  }
  stat(target){
    return util.promisify(this.sftp.stat.bind(this.sftp))(target);
  }
  lstat(target){
    return util.promisify(this.sftp.lstat.bind(this.sftp))(target);
  }
  unlink(target){
    return util.promisify(this.sftp.unlink.bind(this.sftp))(target);
  }
  mkdir(target){
    return util.promisify(this.sftp.mkdir.bind(this.sftp))(target);
  }
  rmdir(target){
    return util.promisify(this.sftp.rmdir.bind(this.sftp))(target);
  }
  fastGet(src, dst, options={}){
    return util.promisify(this.sftp.fastGet.bind(this.sftp))(src, dst, options);
  }
  fastPut(src, dst, options={}){
    return util.promisify(this.sftp.fastPut.bind(this.sftp))(src, dst, options);
  }
  realpath(target){
    return util.promisify(this.sftp.realpath.bind(this.sftp))(target);
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
    if(dstIsDir){
  //TODO path.basename should be changed path.posix or path.win32 according to remote or local server OS
      dst = path.join(dst, path.basename(src));
    }
    return func(src, dst, opt);
  }

  /**
   * check if directory is exist from target to root
   * on exit, stack contains non-existing directories
   * @param {string} target  - directory path
   * @param {string[]} stack - result
   *
   * please note that if stack has some member before 1st call,
   * result is pushd after existing member
   */
  async _recursiveRealpathUpward(target, stack){
    await this.realpath(target)
      .then((absPath)=>{
        stack.push(absPath);
        return;
      })
      .catch((err)=>{
        if(err.message === 'No such file'){
          stack.push(target);
          //TODO must be check with windows
          let tmp = path.dirname(target);
          return this._recursiveRealpathUpward(tmp, stack);
        }
        err.message = `unkonw error occurred while calling realpath on remote host: ${err.message}`;
        throw new err;
      });
  }
}

module.exports=sftpUtil;
