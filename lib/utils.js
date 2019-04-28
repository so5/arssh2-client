const fs = require("fs");

/**
 * Walk directory tree and make file and directory list.
 * @param {string} root - Directory which start to walk.
 * @param {Function} readdir  - Readdir function.
 * @param {Function} stat     - Stat function.
 * @param {Function} join     - Path.join function on tree.
 * @param {string[]} dirList  - Array which contains existing directories on return.
 * @param {string[]} fileList - Array which contains existing files on return.
 */
async function walk(root, readdir, stat, join, dirList, fileList) {
  const dstDir = root;
  return readdir(root).then((files)=>{
    dirList.push(dstDir);
    const pStat = [];
    const pWalk = [];
    files.forEach((e)=>{
      const srcPath = join(root, e);
      pStat.push(
        stat(srcPath).then((stats)=>{
          if (stats.isFile()) {
            pWalk.push(fileList.push(srcPath));
          } else if (stats.isDirectory()) {
            pWalk.push(walk(srcPath, readdir, stat, join, dirList, fileList));
          }
        })
      );
    });
    return Promise.all(pStat).then(Promise.all.bind(Promise, pWalk));
  });
}

function getFileMode(mode, withStickyBit = false) {
  const mask = withStickyBit ? 0o7777 : 0o777;
  return (mode & mask).toString(8);
}

function getFileType(mode) {
  const S_IFMT = 61440; //0170000 file type bit field
  return mode & S_IFMT;
}

function S_ISREG(stat) {
  const S_IFREG = 32768; //0100000 regular file
  return getFileType(stat.mode) === S_IFREG;
}

function S_ISDIR(stat) {
  const S_IFDIR = 16384; //0040000 directory
  return getFileType(stat.mode) === S_IFDIR;
}

function returnSize(stat) {
  if (!S_ISREG(stat)) {
    return false;
  }
  return stat.size;
}

//helper function to parse fs.stat and SFTPStream.stat
function checkStatWrapper(statFunc, parser, target) {
  return new Promise((resolve, reject)=>{
    statFunc(target, (err, stat)=>{
      if (err) {
        if (err.message === "No such file" || err.code === "ENOENT" || err.code === "ENOTDIR") {
          resolve(false);
        } else {
          reject(err);
        }
      } else {
        resolve(parser(stat));
      }
    });
  });
}

async function sleep(time) {
  return new Promise((resolve)=>{
    setTimeout(()=>{
      resolve();
    }, time);
  });
}

module.exports.sleep = sleep;
module.exports.walk = walk;
module.exports.getFileMode = getFileMode;
module.exports.checkStatWrapper = checkStatWrapper;
module.exports.S_ISREG = S_ISREG;
module.exports.S_ISDIR = S_ISDIR;
module.exports.returnSize = returnSize;
module.exports.isDirLocal = checkStatWrapper.bind(fs, fs.stat, S_ISDIR);
module.exports.isFileLocal = checkStatWrapper.bind(fs, fs.stat, S_ISREG);
module.exports.getSizeLocal = checkStatWrapper.bind(fs, fs.stat, returnSize);
