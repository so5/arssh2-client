"use strict";
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
  createRemoteFiles,
  remoteRoot
} = require("./util/testFiles");

const getConfig = require("./util/config");

describe("test for stremIO", function() {
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
      return expect(arssh.createReadStream(path.posix.join(remoteRoot, nonExisting))).to.be.rejected;
    });
    it("should be rejected while attempting to create stream on existing remote directory", ()=>{
      return expect(arssh.createReadStream(path.posix.join(remoteRoot, "hoge"))).to.be.rejected;
    });
  });
  describe("#createWriteStream", ()=>{
    it("should get writable strem of existing file to append", async()=>{
      const target = path.posix.join(remoteRoot, "foo");
      const stream = await arssh.createWriteStream(target, { flags: "a" });
      stream.write("hoge");
      stream.end();

      //check write result
      const rstream = await arssh.createReadStream(target);
      const data = await expect(rstream).to.emit("data");
      expect(data[0].toString()).to.equal(`${target}\nhoge`);

      return expect(stream).not.to.emit("error");
    });
    it("should get writable strem of existing file to replace", async()=>{
      const target = path.posix.join(remoteRoot, "foo");
      const stream = await arssh.createWriteStream(target);
      stream.write("hoge");
      stream.end();

      //check write result
      const rstream = await arssh.createReadStream(target);
      const data = await expect(rstream).to.emit("data");
      expect(data[0].toString()).to.equal("hoge");
      return expect(stream).not.to.emit("error");
    });
    it("should get writable strem of non-existing file", async()=>{
      const target = path.posix.join(remoteRoot, nonExisting);
      const stream = await arssh.createWriteStream(target);
      stream.write("hoge");
      stream.end();

      //check write result
      const rstream = await arssh.createReadStream(target);
      const data = await expect(rstream).to.emit("data");
      expect(data[0].toString()).to.equal("hoge");
      return expect(stream).not.to.emit("error");
    });
    it("should be rejected while attempting to create stream on existing remote directory", ()=>{
      return expect(arssh.createReadStream(path.posix.join(remoteRoot, "hoge"))).to.be.rejected;
    });
  });
  describe("#pipe read and write stream", ()=>{
    it("should overwrite existing file", async()=>{
      const target = path.posix.join(remoteRoot, "foo");
      const stream = await arssh.createWriteStream(target);
      const rtarget = path.posix.join(remoteRoot, "bar");
      const rstream = await arssh.createReadStream(rtarget);
      rstream.pipe(stream);

      //check write result
      const rstream2 = await arssh.createReadStream(target);
      const data = await expect(rstream2).to.emit("data");
      expect(data[0].toString()).to.equal(`${rtarget}\n`);
      return expect(stream).not.to.emit("error");
    });
    it("should append existing file", async()=>{
      const target = path.posix.join(remoteRoot, "foo");
      const stream = await arssh.createWriteStream(target, { flags: "a" });
      const rtarget = path.posix.join(remoteRoot, "bar");
      const rstream = await arssh.createReadStream(rtarget);
      rstream.pipe(stream);

      //check write result
      const rstream2 = await arssh.createReadStream(target);
      const data = await expect(rstream2).to.emit("data");
      expect(data[0].toString()).to.equal(`${target}\n${rtarget}\n`);
      return expect(stream).not.to.emit("error");
    });
  });
});
