"use strict";
const fs = require("fs-extra");
const path = require("path");

process.on("unhandledRejection", console.dir); //eslint-disable-line no-console
Error.traceLimit = 100000;

//setup test framework
const chai = require("chai");
const { expect } = require("chai");
chai.use(require("chai-fs"));
chai.use(require("chai-as-promised"));

//testee
const ARsshClient = require("../lib/index.js");

//helper
const {
  clearLocalTestFiles,
  clearRemoteTestFiles,
  createLocalFiles,
  localRoot,
  createRemoteFiles,
  remoteRoot,
  localEmptyDir
} = require("./util/testFiles");

const getConfig = require("./util/config");

const remoteLargeFile = `${remoteRoot}/remoteLargeFile`;
const localLargeFile = path.resolve(localRoot, "localLargeFile");

describe("largefile handle test", async function() {
  this.timeout(0);//eslint-disable-line no-invalid-this
  //global variables
  let arssh; //testee
  let ssh; //house keeping
  before(async()=>{
    const config = await getConfig();
    ssh = new ARsshClient(config, { maxConnection: 1 });
    arssh = new ARsshClient(config);
  });
  beforeEach(async()=>{
    await clearRemoteTestFiles(ssh);
    await createRemoteFiles(ssh);
    await clearLocalTestFiles();
    await createLocalFiles();
    const ws = fs.createWriteStream(localLargeFile);
    const p = new Promise((resolve)=>{
      ws.on("close", ()=>{
        resolve();
      });
    });
    for (let i = 0; i < 4000; i++) {
      ws.write(`${`10000000000000000000000000000000${i}`.slice(-31)}\n`);
    }
    ws.end();
    await p;
  });
  after(async()=>{
    await clearRemoteTestFiles(ssh);
    await clearLocalTestFiles();
    ssh.disconnect();
    arssh.disconnect();
  });

  describe("#send", async()=>{
    describe("send single file", ()=>{
      it("should send and recieve over 128kB file", async()=>{
        await arssh.send(localLargeFile, remoteLargeFile);
        await arssh.recv(remoteLargeFile, localEmptyDir);
        expect(path.join(localEmptyDir, "remoteLargeFile")).to.be.a.file().and.equal(localLargeFile);
      });
    });
  });
});
