"use strict";
const path = require("path");

process.on("unhandledRejection", console.dir); //eslint-disable-line no-console
Error.traceLimit = 100000;

//setup test framework
const chai = require("chai");
const { expect } = require("chai");
const sinon = require("sinon");
chai.use(require("sinon-chai"));
chai.use(require("chai-fs"));
chai.use(require("chai-as-promised"));


//testee
const ARsshClient = require("../lib/index.js");

/*
 * test directory tree
 * ${ROOT}
 * +-- huga/ (empty directory)
 * +-- foo
 * +-- bar
 * +-- baz
 * +-- hoge
 *     +-- piyo
 *     +-- puyo
 *     +-- poyo
 *
 * ${ROOT} is "ARssh_testLocalDir" on local side
 * it is ARssh_testLocalDir on remote side
 *
 */

//helper
const {
  clearLocalTestFiles,
  clearRemoteTestFiles,
  createLocalFiles,
  localEmptyDir,
  localFiles,
  createRemoteFiles,
  remoteEmptyDir,
  remoteFiles
} = require("./util/testFiles");

const getConfig = require("./util/config");
const sshout = sinon.stub();
const ssherr = sinon.stub();

describe("connection renewal functionality", function() {
  this.timeout(0); //eslint-disable-line no-invalid-this
  let ssh;
  let arssh;
  const testText = "hoge";
  beforeEach(async()=>{
    const config = await getConfig();
    ssh = new ARsshClient(config);
    await clearRemoteTestFiles(ssh);
    await createRemoteFiles(ssh);
    await clearLocalTestFiles();
    await createLocalFiles();

    arssh = new ARsshClient(config, { delay: 1000, connectionRetryDelay: 100 });
    arssh.renewInterval = 1000;
    arssh.renewDelay = 1000;
    arssh.maxConnection = 5;
  });
  afterEach(async()=>{
    await clearRemoteTestFiles(ssh);
    await clearLocalTestFiles();
    ssh.disconnect();
    arssh.disconnect();
    sshout.reset();
    ssherr.reset();
  });
  describe("#exec", ()=>{
    it("should reconnect 2 times while executing 1sec command 12 times", async()=>{
      const stdout = [];
      let rt = await arssh.exec(`sleep 1 && echo ${testText}`, {}, stdout, ssherr);
      expect(rt).to.equal(0);

      //after reconnect!!
      const p = [];

      for (let i = 0; i < 11; ++i) {
        p.push(arssh.exec(`sleep 1 && echo ${testText}`, {}, stdout, ssherr));
      }
      rt = await Promise.all(p);
      expect(
        rt.some((e)=>{
          return e !== 0;
        })
      ).to.false;
      expect(rt).to.have.lengthOf(11);

      //please note stdout is rotated before adding new output if its length is more than 5
      //so, exec called total 12 times but stdout has last 6 outputs
      expect(stdout).to.have.members(["hoge\n", "hoge\n", "hoge\n", "hoge\n", "hoge\n", "hoge\n"]);
      expect(ssherr).not.to.be.called;
      expect(arssh.numReconnect).to.equal(4);
    });
  });
  describe("with file operation", ()=>{
    describe("#send", ()=>{
      it("should reconnect before sending file", async()=>{
        const stdout = [];
        const rt = await arssh.exec(`sleep 4 && echo ${testText}`, {}, stdout, ssherr);
        expect(rt).to.equal(0);

        //after reconnect!!
        await arssh.send(localFiles[1], remoteEmptyDir);
        const rt2 = await ssh.ls(remoteEmptyDir);
        expect(rt2.map((e)=>{
          return path.posix.basename(e);
        })).to.have.members(["bar"]);
        expect(arssh.numReconnect).to.equal(1);
      });
    });
    describe("#recv", ()=>{
      it("should reconnect before recieving file", async()=>{
        const stdout = [];
        const rt = await arssh.exec(`sleep 4 && echo ${testText}`, {}, stdout, ssherr);
        expect(rt).to.equal(0);

        //after reconnect!!
        await arssh.recv(remoteFiles[4], localEmptyDir);
        expect(localEmptyDir).to.be.a.directory().with.files(["puyo"]);
        expect(arssh.numReconnect).to.equal(1);
      });
    });
  });
});
