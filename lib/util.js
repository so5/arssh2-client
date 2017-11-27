const util = require('util');
const path = require('path');
// utility functions along with sssh2's SFTPStream

class sftpUtil{
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

  static realpath(sftp, target){
    return new Promise((resolve, reject)=>{
      sftp.realpath(target, (err, absPath)=>{
        if(err){
          reject(err);
          return
        }
        resolve(absPath);
      });
    });
  }

  static mkdir(sftp, target){
    return new Promise((resolve, reject)=>{
      sftp.mkdir(target, (err)=>{
        if(err){
          reject(err);
          return
        }
        resolve(0);
      });
    });
  }
  static async recursiveRealpathUpwind(sftp, target, stack){
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
        return sftpUtil.recursiveRealpathUpwind(sftp, tmp, stack);
      }
      throw new Error('unkonw error occurred while calling realpath on remote host', err);
    });
  }
  static async mkdir_p(sftp, target){
    let stack=[];
    await sftpUtil.recursiveRealpathUpwind(sftp, target, stack);
    // mkdir absent parent dirs one by one
    while(stack.length>1){
      let dir=await sftpUtil.realpath(sftp, stack.pop());
      await sftpUtil.mkdir(sftp, dir)
      .catch((err)=>{throw new Error(err)});
    }
    // return promise from mkdir original target
    target = await sftpUtil.realpath(sftp, stack.pop());
    return sftpUtil.mkdir(sftp, target)
  }
}

module.exports=sftpUtil;
