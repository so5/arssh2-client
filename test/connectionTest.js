const { promisify } = require("util");
const fs = require("fs");
const path = require("path");

// setup test framework
const chai = require("chai");
const chaiAsPromised = require("chai-as-promised");
chai.use(chaiAsPromised);
const { expect } = require("chai");
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
} = require("./testFiles");

const readConfig = require("./config");
const configFile = "test/ARsshTestSettings.json";

process.on("unhandledRejection", console.dir); // eslint-disable-line no-console

async function isDir(target, ssh) {
  const output = [];
  await ssh.exec(`ls -ld ${target}`, {}, output, output);
  return output[0].startsWith("d");
}

async function stat(target, ssh) {
  const output = [];
  await ssh.exec(`stat --format %a ${target}`, {}, output, output);
  return output[0].trim();
}

describe("ARsshClient connection test", function() {
  this.timeout(20000);
  let arssh;
  let sshout = sinon.stub();
  let ssherr = sinon.stub();
  before(async function() {
    const config = await readConfig(configFile);
    const ssh = new ARsshClient(config);
    await clearRemoteTestFiles(ssh);
    await createRemoteFiles(ssh);
    await clearLocalTestFiles();
    await createLocalFiles();
    ssh.disconnect();
  });
  beforeEach(async function() {
    const config = await readConfig(configFile);
    arssh = new ARsshClient(config, { delay: 1000, connectionRetryDelay: 100 });
  });
  afterEach(function() {
    arssh.disconnect();
    sshout.reset();
    ssherr.reset();
  });
  after(async function() {
    const config = await readConfig(configFile);
    const ssh = new ARsshClient(config);
    await clearRemoteTestFiles(ssh);
    await clearLocalTestFiles();
    ssh.disconnect();
  });
  describe("#canConnect", function() {
    this.timeout(100000);
    it("should be resolved with true", async function() {
      expect(await arssh.canConnect()).to.be.true;
    });
    it("should be rejected if user does not exist", async function() {
      const config2 = await readConfig(configFile);
      config2.username = "xxxxx";
      const arssh2 = new ARsshClient(config2, {
        connectionRetryDelay: 100
      });
      await arssh2
        .canConnect()
        .then(expect.fail)
        .catch((err) => {
          expect(err.reason).to.equal("authentication failure");
        });
    });
    it("should be rejected if user is undefined", async function() {
      const config2 = await readConfig(configFile);
      config2.username = undefined;
      const arssh2 = new ARsshClient(config2, { connectionRetryDelay: 100 });
      await arssh2
        .canConnect()
        .then(expect.fail)
        .catch((err) => {
          expect(err.reason).to.equal("invalid username");
        });
    });
    it("should be rejected if password is wrong", async function() {
      const config2 = await readConfig(configFile);
      config2.password = "";
      config2.passphrase = undefined;
      config2.privateKey = undefined;
      let arssh2 = new ARsshClient(config2, { connectionRetryDelay: 100 });
      await arssh2
        .canConnect()
        .then(expect.fail)
        .catch((err) => {
          expect(err.reason).to.equal("authentication failure");
        });
    });
    it("should be rejected if privateKey is wrong", async function() {
      const config2 = await readConfig(configFile);
      config2.privateKey = "xxx";
      const arssh2 = new ARsshClient(config2, { connectionRetryDelay: 100 });
      await arssh2
        .canConnect()
        .then(expect.fail)
        .catch((err) => {
          expect(err.reason).to.equal("invalid private key");
        });
    });
    it("should be rejected if host does not exist", async function() {
      const config2 = await readConfig(configFile);
      config2.hostname = "foo.bar.example.com";
      const arssh2 = new ARsshClient(config2, { connectionRetryDelay: 100 });
      await arssh2
        .canConnect()
        .then(expect.fail)
        .catch((err) => {
          expect(err.reason).to.equal("name resolution failure");
        });
    });
    it("should be rejected if host(ip address) does not exist", async function() {
      this.timeout(0);
      const config2 = await readConfig(configFile);
      config2.hostname = "192.0.2.1";
      config2.readyTimeout = 200;
      const arssh2 = new ARsshClient(config2, { connectionRetry: 1, connectionRetryDelay: 10 });
      await arssh2
        .canConnect()
        .then(expect.fail)
        .catch((err) => {
          expect(err.reason).to.equal("timeout occurred during connection process");
        });
    });
    it("should be rejected if port number is out of range(-1)", async function() {
      const config2 = await readConfig(configFile);
      config2.port = -1;
      const arssh2 = new ARsshClient(config2, { connectionRetryDelay: 100 });
      await arssh2
        .canConnect()
        .then(expect.fail)
        .catch((err) => {
          expect(err.reason).to.equal("illegal port number");
        });
    });
    it("should be rejected if port number is out of range(65536)", async function() {
      const config2 = await readConfig(configFile);
      config2.port = 65536;
      const arssh2 = new ARsshClient(config2, { connectionRetryDelay: 100 });
      await arssh2
        .canConnect()
        .then(expect.fail)
        .catch((err) => {
          expect(err.reason).to.equal("illegal port number");
        });
    });
  });

  describe("#exec", function() {
    let testText = "hoge";
    let numExec = 50;

    it("should execute single command with stdout", async function() {
      const stdout = [];
      let rt = await arssh.exec(`echo ${testText}`, {}, stdout, ssherr);
      expect(rt).to.equal(0);
      expect(ssherr).not.to.be.called;
      expect(stdout).to.have.members(["hoge\n"]);
    });
    it("should execute single command with stderr", async function() {
      const stderr = [];
      let rt = await arssh.exec(`echo ${testText} >&2`, {}, sshout, stderr);
      expect(rt).to.equal(0);
      expect(sshout).not.to.be.called;
      expect(stderr).to.have.members(["hoge\n"]);
    });
    it("should execute single command with stdout & stderr", async function() {
      const output = [];
      let rt = await arssh.exec(`echo ${testText}; echo ${testText}>&2`, {}, output, output);
      expect(rt).to.equal(0);
      expect(output).to.have.members(["hoge\n", "hoge\n"]);
    });
    it(`should execute ${numExec} times after 1sec sleep`, async function() {
      this.timeout(0);
      const promises = [];
      for (let i = 0; i < numExec; i++) {
        promises.push(arssh.exec(`sleep 1&& echo ${testText} ${i}`, {}, sshout, ssherr));
      }
      let rt = await Promise.all(promises);

      // check if all return value is 0
      expect(rt).to.have.lengthOf(numExec);
      rt = Array.from(new Set(rt));
      expect(rt).to.have.lengthOf(1);
      expect(rt).to.include(0);

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
    it.skip(`should execute ${numExec} times after 10sec sleep`, async function() {
      this.timeout(0);
      const promises = [];
      for (let i = 0; i < numExec; i++) {
        promises.push(arssh.exec(`sleep 10&& echo ${testText} ${i}`, {}, sshout, ssherr));
      }
      let rt = await Promise.all(promises);

      // check if all return value is 0
      expect(rt).to.have.lengthOf(numExec);
      rt = Array.from(new Set(rt));
      expect(rt).to.have.lengthOf(1);
      expect(rt).to.include(0);

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

  describe("#realpath", function() {
    it("should return absolute path of existing directory", async function() {
      const remoteHome = await arssh.realpath(".");
      const rt = await arssh.realpath(remoteRoot);
      expect(rt).to.equal(path.posix.join(remoteHome, remoteRoot));
    });
    it("should return absolute path of existing file", async function() {
      const remoteHome = await arssh.realpath(".");
      const rt = await arssh.realpath(remoteFiles[0]);
      expect(rt).to.equal(path.posix.join(remoteHome, remoteFiles[0]));
    });
    it("should reject absolute path of not-existing file", async function() {
      const remoteHome = await arssh.realpath(".");
      const rt = arssh.realpath(path.posix.join(remoteHome, remoteRoot, nonExisting));
      return expect(rt).to.rejectedWith("No such file");
    });
  });

  describe("#ls", function() {
    [
      { args: path.join(remoteRoot, nonExisting), expected: [] },
      { args: path.join(remoteRoot, "foo"), expected: ["foo"] },
      { args: remoteRoot, expected: ["foo", "bar", "baz", "hoge", "huga"] }
    ].forEach(function(param) {
      it("should return array of filenames", async function() {
        expect(await arssh.ls(param.args)).to.have.members(param.expected);
      });
    });
    it("should return empty array", async function() {
      expect(await arssh.ls(remoteRoot + "/" + nonExisting)).to.eql([]);
    });
  });

  describe("test with file/directory operation", function() {
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

    describe("#chmod", function() {
      it("should change file mode", async function() {
        await arssh.chmod(remoteFiles[0], "700");
        let output = [];
        await arssh.exec(`ls -l ${path.posix.dirname(remoteFiles[0])}`, {}, output, output);
        output = output.join();
        output = output.split("\n");

        const tmp2 = output.find((e) => {
          return e.endsWith(path.posix.basename(remoteFiles[0]));
        });
        expect(tmp2.startsWith("-rwx------")).to.be.true;
      });
    });
    describe("#mkdir_p", function() {
      it("should make child of existing directory", async function() {
        const target = `${remoteRoot}/hogehoge`;
        const rt = await arssh.mkdir_p(target);

        expect(rt).to.eql(undefined);
        expect(await isDir(target, ssh)).to.be.true;
      });
      it("should make child dir of non-existing directory with trailing pathsep", async function() {
        const target = `${remoteRoot}/${nonExisting}/hogehoge/foo/bar/baz/huga/`;
        const rt = await arssh.mkdir_p(target);

        expect(rt).to.eql(undefined);
        expect(await isDir(target, ssh)).to.be.true;
      });
      it("should make child dir of non-existing directory", async function() {
        const target = `${remoteRoot}/${nonExisting}/hogehoge/foo/bar/baz/huga`;
        const rt = await arssh.mkdir_p(target);

        expect(rt).to.eql(undefined);
        expect(await isDir(target, ssh)).to.be.true;
      });
      it("should resolve with undefined if making existing directory", async function() {
        const target = remoteRoot;
        const rt = await arssh.mkdir_p(target);

        expect(rt).to.eql(undefined);
        expect(await isDir(target, ssh)).to.be.true;
      });
      it("should rejected if target path is existing file", function() {
        const rt = arssh.mkdir_p(remoteFiles[0]);
        return expect(rt).to.be.rejected;
      });
      it.skip("should cause error if making child dir of not-owned directory", function() {});
    });

    describe("#send", function() {
      it("should send single file to server", async function() {
        await arssh.send(localFiles[0], remoteEmptyDir);

        let rt = await ssh.ls(remoteEmptyDir);
        expect(rt).to.have.members(["foo"]);
      });
      it("should send single file to server", async function() {
        await arssh.send(localFiles[3], remoteEmptyDir);

        let rt = await ssh.ls(remoteEmptyDir);
        expect(rt).to.have.members(["piyo"]);
      });
      it("should send single file to server and rename", async function() {
        await arssh.send(localFiles[0], path.posix.join(remoteEmptyDir, "hoge"));

        let rt = await ssh.ls(path.posix.join(remoteEmptyDir, "hoge"));
        expect(rt).to.have.members(["hoge"]);
      });
      if (process.platform !== "win32") {
        it("should send single file to server with keep file permission(can not work on windows)", async function() {
          let perm = "633";
          await promisify(fs.chmod)(localFiles[0], perm);
          await arssh.send(localFiles[0], remoteEmptyDir);

          let rt = await stat(path.posix.join(remoteEmptyDir, "foo"), ssh);
          expect(rt).to.be.equal(perm);
        });
      }
      it("should send directory tree to server", async function() {
        await arssh.send(localRoot, remoteEmptyDir);

        let rt = await ssh.ls(remoteEmptyDir);
        expect(rt).to.have.members(["foo", "bar", "baz", "hoge", "huga"]);
        let rt2 = await ssh.ls(path.posix.join(remoteEmptyDir, "hoge"));
        expect(rt2).to.have.members(["piyo", "puyo", "poyo"]);
      });
      it("should send directory tree to server", async function() {
        await arssh.send(path.resolve(localRoot, "hoge"), remoteEmptyDir);

        let rt = await ssh.ls(path.posix.join(remoteEmptyDir));
        expect(rt).to.have.members(["piyo", "puyo", "poyo"]);
      });
      if (process.platform !== "win32") {
        it("should send directory tree to server with keep file permission", async function() {
          let perm = "633";
          await promisify(fs.chmod)(localFiles[0], perm);
          await arssh.send(localRoot, remoteEmptyDir);

          let rt = await ssh.ls(remoteEmptyDir);
          expect(rt).to.have.members(["foo", "bar", "baz", "hoge", "huga"]);
          let rt2 = await ssh.ls(path.posix.join(remoteEmptyDir, "hoge"));
          expect(rt2).to.have.members(["piyo", "puyo", "poyo"]);
          expect(await stat(path.posix.join(remoteEmptyDir, "foo"), ssh)).to.be.equal(perm);
        });
      }
      it("should send directory tree to server if only filter matched", async function() {
        await arssh.send(localRoot, remoteEmptyDir, "*/{ba*,hoge/*}");

        let rt = await ssh.ls(path.posix.join(remoteEmptyDir));
        expect(rt).to.have.members(["hoge", "bar", "baz", "huga"]);
        rt = await ssh.ls(path.posix.join(remoteEmptyDir, "hoge"));
        expect(rt).to.have.members(["piyo", "puyo", "poyo"]);
      });
      it("should send directory tree to server if exclude filter not matched", async function() {
        await arssh.send(localRoot, remoteEmptyDir, null, "*/{ba*,hoge*}");

        let rt = await ssh.ls(path.posix.join(remoteEmptyDir));
        expect(rt).to.have.members(["foo", "hoge", "huga"]);
      });
      it("should send directory tree to server if only filter matched but exclude filter not matched", async function() {
        await arssh.send(localRoot, remoteEmptyDir, "*/{ba*,hoge/*}", "**/poyo");

        let rt = await ssh.ls(path.posix.join(remoteEmptyDir));
        expect(rt).to.have.members(["hoge", "bar", "baz", "huga"]);
        rt = await ssh.ls(path.posix.join(remoteEmptyDir, "hoge"));
        expect(rt).to.have.members(["piyo", "puyo"]);
      });
    });

    describe("#recv", function() {
      it("should get single file into specific dir", async function() {
        await arssh.recv(remoteFiles[3], localEmptyDir);

        let rt = await promisify(fs.readdir)(localEmptyDir);
        expect(rt).to.have.members(["piyo"]);
      });
      it("should get single file from server with different name", async function() {
        await arssh.recv(remoteFiles[0], path.join(localEmptyDir, "hoge"));

        let rt = await promisify(fs.readdir)(localEmptyDir);
        expect(rt).to.have.members(["hoge"]);
      });
      it("should recv directory tree from server", async function() {
        await arssh.recv(remoteRoot, localEmptyDir);

        let rt = await promisify(fs.readdir)(localEmptyDir);
        expect(rt).to.have.members(["foo", "bar", "baz", "hoge", "huga"]);
        rt = await promisify(fs.readdir)(path.join(localEmptyDir, "hoge"));
        expect(rt).to.have.members(["piyo", "puyo", "poyo"]);
      });
      it("should recv directory tree from server", async function() {
        await arssh.recv(path.posix.join(remoteRoot, "hoge"), localEmptyDir);

        const rt = await promisify(fs.readdir)(path.join(localEmptyDir));
        expect(rt).to.have.members(["piyo", "puyo", "poyo"]);
      });
      it("should recv files which matches only filter", async function() {
        await arssh.recv(remoteRoot, localEmptyDir, "*/{ba*,hoge/*}");
        let rt = await promisify(fs.readdir)(path.join(localEmptyDir));
        expect(rt).to.have.members(["bar", "baz", "hoge", "huga"]);
        rt = await promisify(fs.readdir)(path.join(localEmptyDir, "hoge"));
        expect(rt).to.have.members(["piyo", "puyo", "poyo"]);
      });
      it("should not recv files which matches exclude filter", async function() {
        await arssh.recv(remoteRoot, localEmptyDir, null, "*/{ba*,hoge/*}");
        let rt = await promisify(fs.readdir)(path.join(localEmptyDir));
        expect(rt).to.have.members(["foo", "hoge", "huga"]);
      });
      it("should recv files which matches only filter but should not recv which matches exclude filter", async function() {
        await arssh.recv(remoteRoot, localEmptyDir, "*/{ba*,hoge/*}", "**/piyo");
        let rt = await promisify(fs.readdir)(path.join(localEmptyDir));
        expect(rt).to.have.members(["bar", "baz", "hoge", "huga"]);
        rt = await promisify(fs.readdir)(path.join(localEmptyDir, "hoge"));
        expect(rt).to.have.members(["puyo", "poyo"]);
      });
    });
  });
});