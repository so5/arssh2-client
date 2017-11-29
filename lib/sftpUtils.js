const util = require('util');
const path = require('path');
const fs = require('fs');

let isDirLocal  = async (path)=>{
  let lstat = await util.promisify(fs.lstat)(path);
  return lstat.isDirectory();
}
let isFileLocal = async (path)=>{
  let lstat = await util.promisify(fs.lstat)(path);
  return lstat.isFile();
}

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
  static async mkdir_p(sftp, target){
    let stack=[];
    await sftpUtil._recursiveRealpathUpward(sftp, target, stack);
    // mkdir absent parent dirs one by one
    while(stack.length>1){
      let dir=await sftpUtil.realpath(sftp, stack.pop());
      await sftpUtil.mkdir(sftp, dir)
        .catch((err)=>{throw new Error(err)});
    }
    // return promise from mkdir original target
    let tmp = stack.pop();
    target = await sftpUtil.realpath(sftp, tmp);
    return sftpUtil.mkdir(sftp, target)
  }

  static async ls(sftp, target){
    if(await sftpUtil.isDir(sftp, target)){
      let attrs = await sftpUtil.readdir(sftp, target);
      let rt = attrs.map((e)=>{
        return e.filename
      });
      return rt;
    }else{
      try{
        await sftpUtil.stat(sftp, target)
      }catch(err){
        if(err.message !== 'No such file'){
          throw err;
        }
        return [];
      }
      return [path.basename(target)]
    }
  }

  /**
   * put multiple files
   * @param {Object} sftp - SFTPStream
   * @param {string[] | string} src   - array of filenames (or just single filename) which should be transferd to dst
   * @param {string} dst     - local directory path which files will be download to
   * @param {Object} options - option object to ssh2's fastget
   */
  static async mput(sftp, src, dst, opt={}){
    return sftpUtil._mputget(sftp, src, dst, opt, 'put');
  }

  /**
   * get multiple file
   * @param {Object} sftp - SFTPStream
   * @param {string[] | string} src   - array of filenames (or just single filename) which should be transferd to dst
   * @param {string} dst     - local directory path which files will be download to
   * @param {Object} options - option object to ssh2's fastget
   */
  static async mget(sftp, src, dst, opt={}){
    return sftpUtil._mputget(sftp, src, dst, opt, 'get');
  }

  /**
   * check if specified path is directory or not
   * @param {Object} sftp - SFTPStream
   * @param {string} target - path which will be tested
   *
   * @returns {boolean} - true if specified directory is exist, false if not exist or it is not directory
   */
  static isDir(sftp, target){
    return sftpUtil._checkRemoteStat(sftp, target, 'dir');
  }
  /**
   * check if specified path is fie or not
   * @param {Object} sftp - SFTPStream
   * @param {string} target - path which will be tested
   *
   * @returns {boolean} - true if specified directory is exist, false if not exist or it is not directory
   */
  static isFile(sftp, target){
    return sftpUtil._checkRemoteStat(sftp, target, 'file');
  }

  static readdir(sftp, target){
    return util.promisify(sftp.readdir.bind(sftp))(target);
  }
  static stat(sftp, target){
    return util.promisify(sftp.stat.bind(sftp))(target);
  }
  static unlink(sftp, target){
    return util.promisify(sftp.unlink.bind(sftp))(target);
  }
  static mkdir(sftp, target){
    return util.promisify(sftp.mkdir.bind(sftp))(target);
  }
  static rmdir(sftp, target){
    return util.promisify(sftp.rmdir.bind(sftp))(target);
  }
  static fastGet(sftp, src, dst, options={}){
    return util.promisify(sftp.fastGet.bind(sftp))(src, dst, options);
  }
  static fastPut(sftp, src, dst, options={}){
    return util.promisify(sftp.fastPut.bind(sftp))(src, dst, options);
  }
  static realpath(sftp, target){
    return util.promisify(sftp.realpath.bind(sftp))(target);
  }

  //TODO path.basename should be changed path.posix or path.win32 according to remote or local server OS
  /**
   * multi file/dir transfer
   * @param { string| string[]} src - filename or array of filenames which will be transferd
   * @param { string } dst - destination path
   * @param { Object } opt - option object of func
   * @param { string } mode - put or get
   */
  static async _mputget(sftp, src, dst, opt, mode){
    if(mode !== 'put' && mode !== 'get'){
      throw new Error('mode must be put or get');
    }
    let func =   mode === 'put' ? sftpUtil.fastPut.bind(sftp, sftp) : sftpUtil.fastGet.bind(sftp, sftp);
    let isDir =  mode === 'put' ? sftpUtil.isDir.bind(sftp, sftp) : isDirLocal
    let isFile = mode === 'put' ? isFileLocal : sftpUtil.isFile.bind(sftp, sftp);

    // velify src and dst
    let srcIsArray = Array.isArray(src);
    if(!srcIsArray){
      let srcIsFile = await isFile(src)
        .catch((err)=>{
          if(err.code === 'ENOENT'){
            throw err;
          }
          throw new Error('isFile failed due to unknow error');
        });
      if(! srcIsFile) throw new Error('src must be file');
    }else{
      let promises = src.map((e)=>{
        return isFile(e);
      });
      let isFileResults = await Promise.all(promises)
        .catch((err)=>{
          throw new Error('isFile on array failed');
        });
      src = src.filter((e,i)=>{
        return isFileResults[i];
      });
      if(src.length === 0){
        throw new Error('all src is not file');
      }
    }
    let dstIsDir = await isDir(dst)
      .catch((err)=>{
        if(err.code === ENOENT){
          throw err;
        }
        throw new Error('isDir failed with unknow error');
      })
    if(srcIsArray && !dstIsDir){
      throw new Error('dst directory is not exist');
    }

    // single file mode
    if(! srcIsArray){
      if(dstIsDir){
        dst = path.join(dst, path.basename(src));
      }
      return func(src, dst, opt);
    }

    // multi file mode
    let promises=[];
    for(let i=0; i<src.length; i++){
      let srcFile = src[i];
      let dstFile = path.join(dst, path.basename(srcFile));
      promises.push(func(srcFile, dstFile, opt));
    }
    return Promise.all(promises);
  }

  /**
   * check if specified path is directory or not
   * @param { Object } sftp - SFTPStream
   * @param { string } target - directory path which will be tested
   * @param { string } mode   - file or directory
   *
   * @returns {boolean} - true if specified directory is exist, false if not exist or it is not directory
   */
  static _checkRemoteStat(sftp, target, mode){
    return new Promise((resolve, reject)=>{
      if( mode !== 'dir' && mode !== 'file') reject(new Error('mode must be dir or file'));
      sftp.lstat(target, (err, stat)=>{
        if(err){
          if(err.message === 'No such file'){
            resolve(false);
          }else{
            reject(err);
          }
          return
        }
        let rt=false;
        if(mode === 'dir'){
          rt = stat.isDirectory();
        }else{
          rt = stat.isFile();
        }
        resolve(rt);
      });
    });
  }

  /**
   * check if directory is exist from target to root
   * on exit, stack contains non-existing directories
   * @param {Object} sftp    - SFTPStream
   * @param {string} target  - directory path
   * @param {string[]} stack - result
   *
   * please note that if stack has some member before 1st call,
   * result is pushd after existing member
   */
  static async _recursiveRealpathUpward(sftp, target, stack){
    await sftpUtil.realpath(sftp, target)
      .then((absPath)=>{
        stack.push(absPath);
        return;
      })
      .catch((err)=>{
        if(err.message === 'No such file'){
          stack.push(target);
          //TODO must be check with windows
          let tmp = path.dirname(target);
          return sftpUtil._recursiveRealpathUpward(sftp, tmp, stack);
        }
        err.message = `unkonw error occurred while calling realpath on remote host: ${err.message}`;
        throw new err;
      });
  }
}

module.exports=sftpUtil;
