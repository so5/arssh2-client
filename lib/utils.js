const fs = require('fs');
const path = require('path');

let overwriteDefaultValue = (variable, defaultValue)=>{
  if(! variable || typeof variable !== 'number' ){
    variable = defaultValue;
  }else{
    variable = parseInt(variable);
  }
  return variable;
}

let isDirAdaptor = (isDir, target)=>{
  return isDir(target)
    .then((result)=>{
      return result ? Promise.resolve(target) : Promise.reject();
    });
}

let mkdirIfNotExist = async (isDir, mkdir, target)=>{
  if(! await isDir(target)){
    await mkdir(target)
  }
  return retry.bind(this, isDirAdaptor.bind(this, isDir, target), 10, 100);
}

/**
 * return missing directories from target to existing parent
 * @param {string} target - path
 * @param {string[]} stack - array which will be pushd results
 */
let _findPathUpward=(target, stack, realpath)=>{
  return realpath(target)
    .then((absPath)=>{
      stack.push(absPath);
    })
    .catch((err)=>{
      if(err.message === 'No such file'){
        stack.push(target)
        let parent = path.dirname(target);
        return _findPathUpward(parent, stack, realpath);
      }
      err.targetPath = target;
      return Promise.reject(err);
    });
}

/**
 * make directory recursively (like mkdir -p)
 * @param {string} target - directory path
 */
let mkdir_p=async (mkdir, realpath, isDir, target)=>{
  if(await isDir(target)) return;

  let stack=[];
  await _findPathUpward(target, stack, realpath);

  // mkdir absent parent dirs one by one
  while(stack.length>1){
    let absPath = await realpath(stack.pop())
    if(! await isDir(absPath)){
      await mkdir(absPath)
    }
  }

  // make target dir and return mkdir's promise
  target = await realpath(stack.pop());
  return mkdir(target)
    .catch((e)=>{
      e.target = target;
      return Promise.reject(e);
    });
}


/**
 * walk directory tree and do something on file and directory respectively
 * @param {string} root - directory which start to walk
 * @param {function} readdir  - readdir function
 * @param {function} stat     - stat function
 * @param {string[]} dirList  - array which contains existing directories on return
 * @param {string[]} fileList - array which contains existing files on return
 */
let walk = async (root, readdir, stat, dirList, fileList) =>{
  let dstDir=root;
  dirList.push(dstDir);
  return readdir(root)
    .then((files)=>{
      let pStat=[];
      let pWalk=[];
      files.forEach((e)=>{
        let srcPath = path.join(root, e);
        pStat.push(
          stat(srcPath)
          .then((stats)=>{
            if(stats.isFile()) {
              pWalk.push(fileList.push(srcPath));
            }else if(stats.isDirectory()){
              pWalk.push(walk(srcPath, readdir, stat, dirList, fileList));
            }
          })
        );
      });
      return Promise.all(pStat).then(Promise.all.bind(Promise, pWalk));
    });
}


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
        if(err.message === 'No such file' || err.code === 'ENOENT' || err.code === 'ENOTDIR'){
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

module.exports.overwriteDefaultValue=overwriteDefaultValue;
module.exports.mkdirIfNotExist=mkdirIfNotExist;
module.exports.mkdir_p=mkdir_p;
module.exports.walk=walk;
module.exports.retry=retry;
module.exports.checkStatWrapper=checkStatWrapper
module.exports.S_ISREG=S_ISREG;
module.exports.S_ISDIR=S_ISDIR;
module.exports.returnSize=returnSize;
module.exports.isDirLocal=checkStatWrapper.bind(fs, fs.stat, S_ISDIR);
module.exports.isFileLocal=checkStatWrapper.bind(fs, fs.stat, S_ISREG);
module.exports.getSizeLocal=checkStatWrapper.bind(fs, fs.stat, returnSize);
module.exports.mkdir_pLocal= mkdir_p.bind(fs, fs.mkdir, fs.realpath, module.exports.isDirLocal);
