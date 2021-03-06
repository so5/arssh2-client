"use strict";
/*eslint no-undefined: 0 */
const path = require("path");

//setup test framework
const chai = require("chai");
const { expect } = require("chai");
chai.use(require("chai-as-promised"));
chai.use(require("sinon-chai"));
chai.use(require("chai-fs"));
chai.use(require("chai-things"));
const sinon = require("sinon");

const ARsshClient = require("../lib/index.js");

const {
  clearLocalTestFiles,
  clearRemoteTestFiles,
  createLocalFiles,
  localRoot,
  localEmptyDir,
  localFiles,
  createRemoteFiles,
  remoteRoot,
  remoteFiles,
  remoteEmptyDir,
  nonExisting
} = require("./util/testFiles");

const getConfig = require("./util/config");

process.on("unhandledRejection", console.dir); //eslint-disable-line no-console

describe.skip("ARsshClient stress test", function() {
  this.timeout(0);//eslint-disable-line no-invalid-this
  //global variables
  let arssh;
  const sshout = sinon.stub();
  const ssherr = sinon.stub();
  const numExec = 5000;
  const numExecSmall = numExec / 40;
  const testText = "hoge";

  beforeEach(async()=>{
    const config = await getConfig();
    arssh = new ARsshClient(config, { delay: 1000, connectionRetryDelay: 100, maxConnection: 8 });
  });
  afterEach(()=>{
    sshout.reset();
    ssherr.reset();
    arssh.disconnect();
  });

  describe("just exec", ()=>{
    it(`should execute very short command ${numExec} times`, async()=>{
      const promises = [];

      for (let i = 0; i < numExec; i++) {
        promises.push(arssh.exec(`echo ${testText} ${i}`, {}, sshout, ssherr));
      }
      const rt = await Promise.all(promises);

      //check if all return value is 0
      expect(rt).to.have.lengthOf(numExec);
      expect(rt).to.all.eql(0);

      //check output of ssh
      expect(ssherr).not.to.be.called;
      expect(sshout.args).to.have.lengthOf(numExec);
      const results = sshout.args.map((e)=>{
        return e[0].toString();
      });

      const expectedResults = [];

      for (let i = 0; i < numExec; i++) {
        expectedResults.push(`${testText} ${i}\n`);
      }
      expect(results).to.have.members(expectedResults);
    });
  });
  describe("test with file and/or directory operation ", ()=>{
    beforeEach(async()=>{
      const config = await getConfig();
      const ssh = new ARsshClient(config);
      await clearRemoteTestFiles(ssh);
      await createRemoteFiles(ssh);
      await clearLocalTestFiles();
      await createLocalFiles();
      ssh.disconnect();
    });
    after(async()=>{
      const config = await getConfig();
      const ssh = new ARsshClient(config);
      await clearRemoteTestFiles(ssh);
      await clearLocalTestFiles();
      ssh.disconnect();
    });
    it("should mkdir same directory", async()=>{
      const p = [];

      for (let i = 0; i < numExecSmall; i++) {
        p.push(arssh.mkdir_p(path.posix.join(remoteRoot, nonExisting)));
      }
      const rt = await Promise.all(p);

      //check if all return value is undefined
      expect(rt).to.have.lengthOf(numExecSmall);
      expect(rt).to.all.eql(undefined);
    });
    it("should get file repeatedly", async()=>{
      const p = [];

      for (let i = 0; i < numExecSmall; i++) {
        p.push(arssh.recv(remoteFiles[3], path.join(localEmptyDir, i.toString())));
      }
      const rt = await Promise.all(p);

      //check if all return value is undefined
      expect(rt).to.have.lengthOf(numExecSmall);
      expect(rt).to.all.eql(undefined);

      const expectedFiles = Array.from(Array(numExecSmall).keys()).map((e)=>{
        return e.toString();
      });

      //make sure localEmptyDir has 0 to numExecSmall files
      expect(localEmptyDir)
        .to.be.a.directory()
        .with.files(expectedFiles);
    });
    it("should get directory tree repeatedly", async()=>{
      const p = [];

      for (let i = 0; i < numExecSmall; i++) {
        p.push(arssh.recv(remoteRoot, path.join(localEmptyDir, i.toString())));
      }
      const rt = await Promise.all(p);

      //check if all return value is 0
      expect(rt).to.have.lengthOf(numExecSmall);
      expect(rt).to.all.eql([undefined, undefined, undefined, undefined, undefined, undefined]);

      //make sure localEmptyDir has numExecSmall copy of remoteRoot
      for (let i = 0; i < numExecSmall; i++) {
        expect(path.join(localEmptyDir, i.toString(), remoteRoot))
          .to.be.a.directory()
          .with.files(["foo", "bar", "baz"]);
        expect(path.join(localEmptyDir, i.toString(), remoteRoot, "hoge"))
          .to.be.a.directory()
          .with.files(["piyo", "puyo", "poyo"]);
      }
    });
    it("should put file repeatedly", async()=>{
      const p = [];

      for (let i = 0; i < numExecSmall; i++) {
        p.push(arssh.send(localFiles[0], path.posix.join(remoteEmptyDir, i.toString())));
      }
      const rt = await Promise.all(p);

      //check if all return value is 0
      expect(rt).to.have.lengthOf(numExecSmall);
      expect(rt).to.all.eql(undefined);

      //check sftp result
      const expectedFiles = Array.from(Array(numExecSmall).keys()).map((e)=>{
        return e.toString();
      });

      //make sure remoteEmptyDir has 0 to numExecSmall files
      const remoteExistingFiles = await arssh.ls(remoteEmptyDir);
      expect(remoteExistingFiles.map((e)=>{
        return path.posix.basename(e);
      })).to.have.members(expectedFiles);
      expect(remoteExistingFiles).to.have.lengthOf(numExecSmall);
    });
    it("should put directory tree repeatedly", async()=>{
      const p = [];

      for (let i = 0; i < numExecSmall; i++) {
        p.push(arssh.send(localRoot, path.posix.join(remoteEmptyDir, i.toString())));
      }
      const rt = await Promise.all(p);

      //check if all return value is 0
      expect(rt).to.have.lengthOf(numExecSmall);
      expect(rt).to.all.eql([undefined, undefined, undefined, undefined, undefined, undefined]);

      //check sftp result
      const expectedFiles = Array.from(Array(numExecSmall).keys()).map((e)=>{
        return e.toString();
      });

      //make sure remoteEmptyDir has 0 to numExecSmall files
      const remoteExistingDirs = await arssh.ls(remoteEmptyDir);
      expect(remoteExistingDirs.map((e)=>{
        return path.posix.basename(e);
      })).to.have.members(expectedFiles);
      expect(remoteExistingDirs).to.have.lengthOf(numExecSmall);

      //eslint-disable-next-line guard-for-in
      for (const e in remoteExistingDirs) {
        const lsResults = await arssh.ls(path.posix.join(remoteEmptyDir, e, localRoot));
        expect(lsResults.map((e2)=>{
          return path.posix.basename(e2);
        })).to.have.members(["hoge", "foo", "bar", "baz"]);
      }
    });
    it("should execute command and get file repeatedly", async()=>{
      const pSsh = [];
      const pSftp = [];

      for (let i = 0; i < numExecSmall; i++) {
        pSftp.push(arssh.send(localFiles[0], path.posix.join(remoteEmptyDir, i.toString())));
        pSsh.push(arssh.exec(`sleep 1&& echo ${testText} ${i}`, {}, sshout, ssherr));
        pSftp.push(arssh.recv(remoteFiles[3], path.join(localEmptyDir, i.toString())));
      }
      const sshRt = await Promise.all(pSsh);
      const sftpRt = await Promise.all(pSftp);

      expect(sftpRt).to.all.eql(undefined);
      expect(sshRt).to.all.eql(0);

      //check output of ssh
      expect(ssherr).not.to.be.called;
      expect(sshout.args).to.have.lengthOf(numExecSmall);
      const results = sshout.args.map((e)=>{
        return e[0].toString();
      });

      const expectedResults = [];

      for (let i = 0; i < numExecSmall; i++) {
        expectedResults.push(`${testText} ${i}\n`);
      }
      expect(results).to.have.members(expectedResults);

      //check sftp result
      const expectedFiles = Array.from(Array(numExecSmall).keys()).map((e)=>{
        return e.toString();
      });

      //make sure localEmptyDir has 0 to numExecSmall files
      expect(localEmptyDir)
        .to.be.a.directory()
        .with.files(expectedFiles);

      //make sure remoteEmptyDir has 0 to numExecSmall files
      const remoteExistingFiles = await arssh.ls(remoteEmptyDir);
      expect(remoteExistingFiles.map((e)=>{
        return path.posix.basename(e);
      })).to.have.members(expectedFiles);
      expect(remoteExistingFiles).to.have.lengthOf(numExecSmall);
    });
  });
});
