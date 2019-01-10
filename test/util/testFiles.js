"use strict";
const fs = require("fs");
const path = require("path");
const { promisify } = require("util");

const del = require("del");

const localRoot = "ARssh_testLocalDir";
const localEmptyDir = path.join(localRoot, "huga");
const localFiles = [
  path.join(localRoot, "foo"),
  path.join(localRoot, "bar"),
  path.join(localRoot, "baz"),
  path.join(localRoot, "hoge", "piyo"),
  path.join(localRoot, "hoge", "puyo"),
  path.join(localRoot, "hoge", "poyo")
];

const remoteRoot = "ARssh_testRemoteDir";
const remoteEmptyDir = `${remoteRoot}/huga`;
const remoteFiles = [
  `${remoteRoot}/foo`,
  `${remoteRoot}/bar`,
  `${remoteRoot}/baz`,
  `${remoteRoot}/hoge/piyo`,
  `${remoteRoot}/hoge/puyo`,
  `${remoteRoot}/hoge/poyo`
];
const nonExisting = "ARSSH_nonExisting";

/*
 * prepare local files which contain its filename
 */
async function createLocalFiles() {
  const localDir2 = path.join(localRoot, "hoge");
  const promises = [];
  await promisify(fs.mkdir)(localRoot);
  await promisify(fs.mkdir)(localDir2);
  promises.push(promisify(fs.mkdir)(localEmptyDir));
  localFiles.forEach((localFile)=>{
    promises.push(promisify(fs.writeFile)(localFile, `${localFile}\n`));
  });
  return Promise.all(promises);
}


async function clearLocalTestFiles() {
  return del(localRoot);
}

async function createRemoteFiles(ssh) {
  //create remote files
  await ssh.mkdir_p(`${remoteRoot}/hoge`);
  await ssh.mkdir_p(remoteEmptyDir);
  let script = "";
  remoteFiles.forEach(async(remoteFile)=>{
    script += `echo ${remoteFile} > ${remoteFile};`;
  });
  return ssh.exec(script);
}

async function clearRemoteTestFiles(ssh) {
  return ssh.exec(`rm -fr ${remoteRoot}`);
}

module.exports.createLocalFiles = createLocalFiles;
module.exports.createRemoteFiles = createRemoteFiles;
module.exports.clearLocalTestFiles = clearLocalTestFiles;
module.exports.clearRemoteTestFiles = clearRemoteTestFiles;
module.exports.localRoot = localRoot;
module.exports.localEmptyDir = localEmptyDir;
module.exports.localFiles = localFiles;
module.exports.nonExisting = nonExisting;
module.exports.remoteRoot = remoteRoot;
module.exports.remoteEmptyDir = remoteEmptyDir;
module.exports.remoteFiles = remoteFiles;
