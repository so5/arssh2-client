const fs = require('fs');

/**
 * call Promisified function until it will be fulfilled
 * @param {function} func - function which should be called repeatedly
 * @param {number} maxRetry - max number of retry count. 0 and negative value means infinit retry
 * @param {number} delay - delay (msec) between each try
 * @param {function} test - test function for return value of func's resolve()
 * @param {number} count - start count.
 *
 * please note, both func and test must be return Promise
 */
let retry = (func, maxRetry, delay, test=null, count=0)=>{
  return func()
    .then((rt)=>{
      if(test) return test(rt);
      return rt;
    })
    .catch((err)=>{
      return new Promise((resolve, reject)=>{
        count++;
        if(count > maxRetry && maxRetry > 0){
          resolve('max retry count exceeded');
        }else{
          reject(err);
        }
      });
    })
    .catch((err)=>{
      return new Promise((resolve, reject)=>{
        setTimeout(reject.bind(this, err), delay);
      });
    })
    .catch(()=>{
      return retry(func, maxRetry, delay, test, count);
    });
}

let getFileType=(mode)=>{
  const S_IFMT = 61440;   //0170000 filetype bit field
  return mode & S_IFMT;
}
let S_ISREG=(stat)=>{
  const S_IFREG = 32768;  //0100000 regular file
  return getFileType(stat.mode) === S_IFREG
}
let S_ISDIR=(stat)=>{
  const S_IFDIR = 16384;  //0040000 directory
  return getFileType(stat.mode) === S_IFDIR
}
let returnSize=(stat)=>{
  if(! S_ISREG(stat)) return false
  return stat.size;
}

// helper function to parse fs.stat and SFTPStream.stat
let checkStatWrapper = (statFunc, parser, target)=>{
  return new Promise((resolve, reject)=>{
    statFunc(target, (err, stat)=>{
      if(err){
        if(err.message === 'No such file' || err.code === 'ENOENT'){
          resolve(false);
        }else{
          reject(err);
        }
      }else{
        resolve(parser(stat));
      }
    });
  });
}

module.exports.retry=retry;
module.exports.checkStatWrapper=checkStatWrapper
module.exports.S_ISREG=S_ISREG;
module.exports.S_ISDIR=S_ISDIR;
module.exports.returnSize=returnSize;
module.exports.isDirLocal=checkStatWrapper.bind(fs, fs.stat, S_ISDIR);
module.exports.isFileLocal=checkStatWrapper.bind(fs, fs.stat, S_ISREG);
module.exports.getSizeLocal=checkStatWrapper.bind(fs, fs.stat, returnSize);
