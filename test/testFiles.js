const fs = require("fs");
const path = require("path");
const { promisify } = require("util");

const del = require("del");

let localRoot = "ARssh_testLocalDir";
let localEmptyDir = path.join(localRoot, "huga");
let localFiles = [
  path.join(localRoot, "foo"),
  path.join(localRoot, "bar"),
  path.join(localRoot, "baz"),
  path.join(localRoot, "hoge", "piyo"),
  path.join(localRoot, "hoge", "puyo"),
  path.join(localRoot, "hoge", "poyo")
];

let remoteRoot = "ARssh_testRemoteDir";
let remoteEmptyDir = `${remoteRoot}/huga`;
let remoteFiles = [
  `${remoteRoot}/foo`,
  `${remoteRoot}/bar`,
  `${remoteRoot}/baz`,
  `${remoteRoot}/hoge/piyo`,
  `${remoteRoot}/hoge/puyo`,
  `${remoteRoot}/hoge/poyo`
];
let nonExisting = "ARSSH_nonExisting";

/*
 * prepare local files which contain its filename
 */
let createLocalFiles = async () => {
  let localDir2 = path.join(localRoot, "hoge");
  let promises = [];
  await promisify(fs.mkdir)(localRoot);
  await promisify(fs.mkdir)(localDir2);
  promises.push(promisify(fs.mkdir)(localEmptyDir));
  localFiles.forEach((localFile) => {
    promises.push(promisify(fs.writeFile)(localFile, localFile + "\n"));
  });
  return Promise.all(promises);
};

let createRemoteFiles = async (ssh, sftp) => {
  let remoteDir2 = `${remoteRoot}/hoge`;
  let promises = [];
  //create remote files
  await sftp.mkdir_p(`${remoteDir2}`);
  promises.push(sftp.mkdir_p(`${remoteEmptyDir}`));
  let script = "";
  remoteFiles.forEach(async (remoteFile) => {
    script += `echo ${remoteFile} > ${remoteFile};`;
  });
  promises.push(ssh.exec(script, {}));
  return Promise.all(promises);
};

let clearRemoteTestFiles = async (ssh) => {
  return ssh.exec(`rm -fr ${remoteRoot}`, {});
};
let clearLocalTestFiles = async () => {
  return del(localRoot);
};

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
