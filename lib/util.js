const util = require('util');
const path = require('path');

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
  /**
   * put multiple files
   * @param {Object} sftp - SFTPStream
   * @param {string[] | string} src   - array of filenames (or just single filename) which should be transferd to dst
   * @param {string} dst     - local directory path which files will be download to
   * @param {Object} options - option object to ssh2's fastget
   */
  static async mput(sftp, src, dst, opt={}){
    // velify src and dst
    let multiSrcFile = Array.isArray(src);
    if(!multiSrcFile && typeof(src) !== 'string'){
      throw new Error('src must be filename or array of filenames');
    }

    let dstIsDir = await sftpUtil.isDir(sftp, dst);

    if(multiSrcFile && !dstIsDir){
      throw new Error('dst directory is not exist');
    }

    // just send single file to server
    if(! multiSrcFile){
      if(dstIsDir){
        dst = path.join(dst, path.basename(src));
      }
      return sftpUtil.fastPut(sftp, src, dst, opt);
    }

    // multi file transfer mode
    let promises=[];
    for(let i=0; i<multiSrcFile.length; i++){
      let srcFile = multiSrcFile[i];
      let dstFile = path.join(dst, path.basename(srcFile));
      promises.push(sftpUtil.fastPut(sftp, srcFile, dstFile, opt));
    }
    return Promise.all(promises);
  }

  /**
   * get multiple file
   * @param {Object} sftp - SFTPStream
   * @param {string[] | string} src   - array of filenames (or just single filename) which should be transferd to dst
   * @param {string} dst     - local directory path which files will be download to
   * @param {Object} options - option object to ssh2's fastget
   */
  static async mget(sftp, src, dst, opt={}){
    // velify src and dst
    let multiSrcFile = Array.isArray(src);
    if(!multiSrcFile && typeof(src) !== 'string'){
      throw new Error('src must be filename or array of filenames');
    }

    let stat = await util.promisify(fs.stat)(dst)
      .catch((err)=>{
        throw err
      });
    let dstIsDir = stat? stat.isDirectory(): false;
    if(multiSrcFile && !dstIsDir){
      throw new Error('det directory is not exist');
    }

    // actual file transfer start here
    if(multiSrcFile){
      let promises=[];
      for(let i=0; i<multiSrcFile.length; i++){
        let srcFile = multiSrcFile[i];
        let dstFile = path.resolve(dst, path.basename(srcFile));
        promises.push(sftpUtil.fastGet(sftp, src, dst, opt));
      }
      return Promise.all(promises);
    }else{
      if(! dstIsDir){
        dst = path.resolve(dst, path.basename(src))
      }
      return sftpUtil.fastGet(sftp, src, dst, opt);
    }

  }

  /**
   * check if specified path is directory or not
   * @param {Object} sftp - SFTPStream
   * @param {string} target - directory path which will be tested
   *
   * @returns {boolean} - true if specified directory is exist, false if not exist or it is not directory
   */
  static isDir(sftp, target){
    return new Promise((resolve, reject)=>{
      sftp.lstat(target, (err, stat)=>{
        if(err){
          if(err.message === 'No such file'){
            resolve(false);
          }else{
            reject(err);
          }
          return
        }
        if(stat.isDirectory()){
          resolve(true);
        }else{
          resolve(false);
        }
      });
    });
  }

  /**
   * make directory on remote host recursively (like mkdir -p)
   * @param {Object} sftp - SFTPStream
   * @param {string} target - directory path
   */
  static async mkdir_p(sftp, target){
    let stack=[];
    await sftpUtil.recursiveRealpathUpward(sftp, target, stack);
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
  static async recursiveRealpathUpward(sftp, target, stack){
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
          return sftpUtil.recursiveRealpathUpward(sftp, tmp, stack);
        }
        err.message = `unkonw error occurred while calling realpath on remote host: ${err.message}`;
        throw new err;
      });
  }

  static async ls(sftp, target){
    if(await sftpUtil.isDir(sftp, target)){
      let attrs = await util.promisify(sftp.readdir.bind(sftp))(target);
      let rt = attrs.map((e)=>{
        return e.filename
      });
      return rt;
    }else{
      let absPath = await sftpUtil.realpath(sftp, target);
      return [path.basename(absPath)];
    }
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
}
function promisify(fn){
  return function (...args){
    return new Promise((resolve, reject)=>{

      fn.call(this, ...args, (err)=>{
        if(err){
          reject(err);
        }else{
          resolve(undefined);
        }
      });

    });
  }
}

module.exports=sftpUtil;
