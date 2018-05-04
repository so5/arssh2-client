const path = require("path");
// setup test framework
const chai = require("chai");
const { expect } = require("chai");
chai.use(require("chai-as-promised"));
chai.use(require("sinon-chai"));
chai.use(require("chai-fs"));
chai.use(require("chai-things"));
const sinon = require("sinon");

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
  remoteEmptyDir
} = require("./testFiles");

const readConfig = require("./config");
const configFile = "test/ARsshTestSettings.json";

process.on("unhandledRejection", console.dir); // eslint-disable-line no-console

describe.skip("ARsshClient stress test", function() {
  this.timeout(0);
  //global variables
  let arssh;
  const sshout = sinon.stub();
  const ssherr = sinon.stub();
  const numExec = 100000;
  const numExecSmall = numExec / 100;
  const testText = "hoge";

  beforeEach(async function() {
    const config = await readConfig(configFile);
    arssh = new ARsshClient(config, { delay: 1000, connectionRetryDelay: 100 });
  });
  afterEach(function() {
    sshout.reset();
    ssherr.reset();
    arssh.disconnect();
  });

  describe("exec only", function() {
    it(`should execute very short command ${numExec} times`, async function() {
      const promises = [];
      for (let i = 0; i < numExec; i++) {
        promises.push(arssh.exec(`echo ${testText} ${i}`, {}, sshout, ssherr));
      }
      let rt = await Promise.all(promises);

      // check if all return value is 0
      expect(rt).to.have.lengthOf(numExec);
      expect(rt).to.all.eql(0);

      // check output of ssh
      expect(ssherr).not.to.be.called;
      expect(sshout.args).to.have.lengthOf(numExec);
      const results = sshout.args.map((e) => {
        return e[0].toString();
      });

      const expectedResults = [];
      for (let i = 0; i < numExec; i++) {
        expectedResults.push(`${testText} ${i}` + "\n");
      }
      expect(results).to.have.members(expectedResults);
    });
  });
  describe("file transfer only", function() {
    let ssh;
    beforeEach(async function() {
      const config = await readConfig(configFile);
      ssh = new ARsshClient(config);
      await clearRemoteTestFiles(ssh);
      await createRemoteFiles(ssh);
      await clearLocalTestFiles();
      await createLocalFiles();
    });
    afterEach(async function() {
      await clearRemoteTestFiles(ssh);
      await clearLocalTestFiles();
      ssh.disconnect();
    });
    it(`should get file repeatedly`, async function() {
      const p = [];
      for (let i = 0; i < numExecSmall; i++) {
        p.push(arssh.recv(remoteFiles[3], path.join(localEmptyDir, i.toString())));
      }
      const rt = await Promise.all(p);

      // check if all return value is 0
      expect(rt).to.have.lengthOf(numExecSmall);
      expect(rt).to.all.eql(undefined);

      const expectedFiles = Array.from(Array(numExecSmall).keys()).map((e) => {
        return e.toString();
      });

      //make sure localEmptyDir has 0 to numExecSmall files
      expect(localEmptyDir)
        .to.be.a.directory()
        .with.files(expectedFiles);
    });
    it(`should get directory tree repeatedly`, async function() {
      const p = [];
      for (let i = 0; i < numExecSmall; i++) {
        p.push(arssh.recv(remoteRoot, path.join(localEmptyDir, i.toString())));
      }
      const rt = await Promise.all(p);

      // check if all return value is 0
      expect(rt).to.have.lengthOf(numExecSmall);
      expect(rt).to.all.eql([undefined, undefined, undefined, undefined, undefined, undefined]);

      //make sure localEmptyDir has numExecSmall copy of remoteRoot
      for (let i = 0; i < numExecSmall; i++) {
        expect(path.join(localEmptyDir, i.toString()))
          .to.be.a.directory()
          .with.files(["foo", "bar", "baz"]);
        expect(path.join(localEmptyDir, i.toString(), "hoge"))
          .to.be.a.directory()
          .with.files(["piyo", "puyo", "poyo"]);
      }
    });
    it(`should put file repeatedly`, async function() {
      const p = [];
      for (let i = 0; i < numExecSmall; i++) {
        p.push(arssh.send(localFiles[0], path.posix.join(remoteEmptyDir, i.toString())));
      }
      const rt = await Promise.all(p);

      // check if all return value is 0
      expect(rt).to.have.lengthOf(numExecSmall);
      expect(rt).to.all.eql(undefined);

      //check sftp result
      const expectedFiles = Array.from(Array(numExecSmall).keys()).map((e) => {
        return e.toString();
      });
      //make sure remoteEmptyDir has 0 to numExecSmall files
      const remoteExistingFiles = await arssh.ls(remoteEmptyDir);
      expect(remoteExistingFiles).to.have.members(expectedFiles);
      expect(remoteExistingFiles).to.have.lengthOf(numExecSmall);
    });
    it(`should put directory tree repeatedly`, async function() {
      const p = [];
      for (let i = 0; i < numExecSmall; i++) {
        p.push(arssh.send(localRoot, path.posix.join(remoteEmptyDir, i.toString())));
      }
      const rt = await Promise.all(p);

      // check if all return value is 0
      expect(rt).to.have.lengthOf(numExecSmall);
      expect(rt).to.all.eql([undefined, undefined, undefined, undefined, undefined, undefined]);

      //check sftp result
      const expectedFiles = Array.from(Array(numExecSmall).keys()).map((e) => {
        return e.toString();
      });
      //make sure remoteEmptyDir has 0 to numExecSmall files
      const remoteExistingDirs = await arssh.ls(remoteEmptyDir);
      expect(remoteExistingDirs).to.have.members(expectedFiles);
      expect(remoteExistingDirs).to.have.lengthOf(numExecSmall);
      remoteExistingDirs.forEach(async (e) => {
        const rt = await arssh.ls(path.posix.join(remoteEmptyDir, e));
        expect(rt).to.have.members(localFiles);
      });
    });
  });
  describe("exec send and recieve mixed test", function() {
    let ssh;
    beforeEach(async function() {
      const config = await readConfig(configFile);
      ssh = new ARsshClient(config);
      await clearRemoteTestFiles(ssh);
      await createRemoteFiles(ssh);
      await clearLocalTestFiles();
      await createLocalFiles();
    });
    afterEach(async function() {
      await clearRemoteTestFiles(ssh);
      await clearLocalTestFiles();
      ssh.disconnect();
    });
    it(`should execute command and get file repeatedly`, async function() {
      const p = [];
      for (let i = 0; i < numExecSmall; i++) {
        p.push(arssh.send(localFiles[0], path.posix.join(remoteEmptyDir, i.toString())));
        p.push(arssh.exec(`sleep 1&& echo ${testText} ${i}`, {}, sshout, ssherr));
        p.push(arssh.recv(remoteFiles[3], path.join(localEmptyDir, i.toString())));
      }
      const rt = await Promise.all(p);

      // check if all return value is 0
      expect(rt).to.have.lengthOf(3 * numExecSmall);
      const sshRt = rt.filter((e, i) => {
        return i % 3 === 1;
      });
      const sftpRt = rt.filter((e, i) => {
        return i % 3 !== 1;
      });

      expect(sftpRt).to.all.eql(undefined);
      expect(sshRt).to.all.eql(0);

      // check output of ssh
      expect(ssherr).not.to.be.called;
      expect(sshout.args).to.have.lengthOf(numExecSmall);
      const results = sshout.args.map((e) => {
        return e[0].toString();
      });

      const expectedResults = [];
      for (let i = 0; i < numExecSmall; i++) {
        expectedResults.push(`${testText} ${i}` + "\n");
      }
      expect(results).to.have.members(expectedResults);

      //check sftp result
      const expectedFiles = Array.from(Array(numExecSmall).keys()).map((e) => {
        return e.toString();
      });
      //make sure localEmptyDir has 0 to numExecSmall files
      expect(localEmptyDir)
        .to.be.a.directory()
        .with.files(expectedFiles);

      //make sure remoteEmptyDir has 0 to numExecSmall files
      const remoteExistingFiles = await arssh.ls(remoteEmptyDir);
      expect(remoteExistingFiles).to.have.members(expectedFiles);
      expect(remoteExistingFiles).to.have.lengthOf(numExecSmall);
    });
  });
});
