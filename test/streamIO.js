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
chai.use(require("chai-events"));

//testee
const ARsshClient = require("../lib/index.js");

//helper
const {
  nonExisting,
  clearLocalTestFiles,
  clearRemoteTestFiles,
  createLocalFiles,
  localRoot,
  localEmptyDir,
  localFiles,
  createRemoteFiles,
  remoteRoot,
  remoteEmptyDir,
  remoteFiles
} = require("./util/testFiles");

const getConfig = require("./util/config");

describe.only("test for stremIO", function() {
  this.timeout(10000);//eslint-disable-line no-invalid-this
  //global variables
  let arssh; //testee
  let ssh; //house keeping
  before(async()=>{
    const config = await getConfig();
    ssh = new ARsshClient(config, { maxConnection: 1 });
    arssh = new ARsshClient(config, { delay: 1000, connectionRetryDelay: 100 });
  });
  beforeEach(async()=>{
    await clearRemoteTestFiles(ssh);
    await createRemoteFiles(ssh);
    await clearLocalTestFiles();
    await createLocalFiles();
  });
  after(async()=>{
    await clearRemoteTestFiles(ssh);
    await clearLocalTestFiles();
    ssh.disconnect();
    arssh.disconnect();
  });
  describe("#createReadStream", ()=>{
    it("should get read stream of existing remote file", async()=>{
      const stream = await arssh.createReadStream(path.posix.join(remoteRoot, "foo"));
      const data = await expect(stream).to.emit("data");
      expect(data[0].toString()).to.equal(`${path.posix.join(remoteRoot, "foo")}\n`);
      return Promise.all([
        expect(stream).to.emit("end"),
        expect(stream).not.to.emit("error")
      ]);
    });
    it("should be rejected while attempting to create read stream of not existing remote file", ()=>{
      return expect(arssh.createReadStream(nonExisting)).to.be.rejected;
    });
    it("should be rejected while attempting to create stream on existing remote directory", ()=>{
      return expect(arssh.createReadStream(path.posix.join(remoteRoot, "hoge"))).to.be.rejected;
    });
  });
  describe.skip("#writeReadStream", ()=>{
    it("should get writable strem of existing file to append", async()=>{});
    it("should get writable strem of existing file to replace", async()=>{});
    it("should get writable strem of non-existing file", async()=>{});
    it("should be rejected while attempting to create stream on existing remote directory", ()=>{
      return expect(arssh.createReadStream(path.posix.join(remoteRoot, "hoge"))).to.be.rejected;
    });
  });
});
