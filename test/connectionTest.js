const { promisify } = require("util");
const fs = require("fs");
const path = require("path");

// setup test framework
const chai = require("chai");
const { expect } = require("chai");
const sinon = require("sinon");
const sinonChai = require("sinon-chai");
chai.use(sinonChai);

const ARsshClient = require("../lib/index.js");
Error.traceLimit = 100000;

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
  //global variables
  let arssh;
  const sshout = sinon.stub();
  const ssherr = sinon.stub();
  beforeEach(async function() {
    this.timeout(0);
    const config = await readConfig(configFile);
    arssh = new ARsshClient(config, { delay: 1000, connectionRetryDelay: 100 });
  });
  afterEach(function() {
    this.timeout(0);
    sshout.reset();
    ssherr.reset();
    arssh.disconnect();
  });

  describe("test without file operation", function() {
    describe("#canConnect", function() {
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
      const testText = "hoge";
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
      // please note that exec() resolves with non-zero value
      // (126 permisssion deny or 127 file not found)
      // but does not reject in following 2 cases
      it("should not execute command which do not have exec permission", async function() {
        await arssh.exec("echo echo hoge >hoge");
        await arssh.exec("chmod ugo-x hoge");
        const rt = await arssh.exec("./hoge");
        expect(rt).to.equal(126);
      });
      it("should reject if command is not found", async function() {
        const rt = await arssh.exec(`./${nonExisting}`, {});
        expect(rt).to.equal(127);
      });
    });
  });

  describe("test with file/directory operation", function() {
    let ssh;
    beforeEach(async function() {
      this.timeout(0);
      const config = await readConfig(configFile);
      ssh = new ARsshClient(config);
      await clearRemoteTestFiles(ssh);
      await createRemoteFiles(ssh);
      await clearLocalTestFiles();
      await createLocalFiles();
    });
    afterEach(async function() {
      this.timeout(0);
      await clearRemoteTestFiles(ssh);
      await clearLocalTestFiles();
      ssh.disconnect();
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
      it("should reject if relative path of not-existing file is specified", async function() {
        try {
          await arssh.realpath(path.posix.join(remoteRoot, nonExisting));
          expect.fail();
        } catch (e) {
          expect(e.message).to.equal("No such file");
        }
      });
      it("should reject if absolute path of not-existing file is specified", async function() {
        const remoteHome = await arssh.realpath(".");
        try {
          await arssh.realpath(path.posix.join(remoteHome, remoteRoot, nonExisting));
          expect.fail();
        } catch (e) {
          expect(e.message).to.equal("No such file");
        }
      });
    });

    describe("#ls", function() {
      it("should return array of file and directory names", async function() {
        expect(await arssh.ls(remoteRoot)).to.have.members(["foo", "bar", "baz", "hoge", "huga"]);
      });
      it("should return array which has single file", async function() {
        expect(await arssh.ls(path.posix.join(remoteRoot, "foo"))).to.eql(["foo"]);
      });
      it("should return empty array", async function() {
        expect(await arssh.ls(path.posix.join(remoteRoot, nonExisting))).to.eql([]);
      });
    });

    describe("#chmod", function() {
      this.timeout(4000);
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
      it("should rejected if target path is existing file", async function() {
        try {
          await arssh.mkdir_p(remoteFiles[0]);
          expect.fail();
        } catch (e) {
          expect(e.code).to.equal("EEXIST");
        }
      });
      it("should reject if making child dir of not-owned directory", async function() {
        try {
          await arssh.mkdir_p("/root/hoge");
          expect.fail();
        } catch (e) {
          expect(e.message).to.equal("Permission denied");
        }
      });
    });

    describe("#send", async function() {
      describe("send single file", function() {
        it("should accept relative src file and relative dst dir name", async function() {
          await arssh.send(localFiles[0], remoteEmptyDir);

          let rt = await ssh.ls(remoteEmptyDir);
          expect(rt).to.have.members(["foo"]);
        });
        it("should accept absolute src file and relative dst dir name", async function() {
          await arssh.send(path.resolve(localFiles[3]), remoteEmptyDir);

          let rt = await ssh.ls(remoteEmptyDir);
          expect(rt).to.have.members(["piyo"]);
        });
        it("should accept relative src file and absolute dst dir name", async function() {
          const remoteHome = await arssh.realpath(".");
          await arssh.send(localFiles[0], path.posix.join(remoteHome, remoteEmptyDir));

          let rt = await ssh.ls(remoteEmptyDir);
          expect(rt).to.have.members(["foo"]);
        });
        it("should accept absolute src file and absolute dst dir name", async function() {
          const remoteHome = await arssh.realpath(".");
          await arssh.send(path.resolve(localFiles[0]), path.posix.join(remoteHome, remoteEmptyDir));

          let rt = await ssh.ls(remoteEmptyDir);
          expect(rt).to.have.members(["foo"]);
        });
        it("should accept relative src file and relative dst file name", async function() {
          await arssh.send(localFiles[0], path.posix.join(remoteEmptyDir, "hoge"));

          let rt = await ssh.ls(path.posix.join(remoteEmptyDir, "hoge"));
          expect(rt).to.have.members(["hoge"]);
        });
        it("should accept absolute src file and relative dst file name", async function() {
          await arssh.send(path.resolve(localFiles[0]), path.posix.join(remoteEmptyDir, "hoge"));

          let rt = await ssh.ls(path.posix.join(remoteEmptyDir, "hoge"));
          expect(rt).to.have.members(["hoge"]);
        });
        it("should accept relative src file and absolute dst file name", async function() {
          const remoteHome = await arssh.realpath(".");
          await arssh.send(localFiles[0], path.posix.join(remoteHome, remoteEmptyDir, "hoge"));

          let rt = await ssh.ls(path.posix.join(remoteEmptyDir, "hoge"));
          expect(rt).to.have.members(["hoge"]);
        });
        it("should accept absolute src file and absolute dst file name", async function() {
          const remoteHome = await arssh.realpath(".");
          await arssh.send(path.resolve(localFiles[0]), path.posix.join(remoteHome, remoteEmptyDir, "hoge"));

          let rt = await ssh.ls(path.posix.join(remoteEmptyDir, "hoge"));
          expect(rt).to.have.members(["hoge"]);
        });
        if (process.platform !== "win32") {
          it("should send and keep file permission(can not work on windows)", async function() {
            let perm = "633";
            await promisify(fs.chmod)(localFiles[0], perm);
            await arssh.send(localFiles[0], remoteEmptyDir);

            let rt = await stat(path.posix.join(remoteEmptyDir, "foo"), ssh);
            expect(rt).to.be.equal(perm);
          });
        }
        it("should overwrite existing file", async function() {
          const target = path.posix.join(remoteEmptyDir, "hoge");
          await arssh.send(localFiles[0], target);
          let rt = await ssh.ls(target);
          expect(rt).to.have.members(["hoge"]);

          await arssh.send(localFiles[1], target);
          rt = await ssh.ls(target);
          expect(rt).to.have.members(["hoge"]);
          const output = [];
          await arssh.exec(`cat ${target}`, {}, output, output);
          rt = output.join();
          expect(rt).to.equal("ARssh_testLocalDir/bar\n");
        });
      });
      describe("send directory tree", function() {
        it("should accept relative src dirname and relative dst dirname", async function() {
          await arssh.send(localRoot, remoteEmptyDir);

          let rt = await ssh.ls(remoteEmptyDir);
          expect(rt).to.have.members(["foo", "bar", "baz", "hoge", "huga"]);
          let rt2 = await ssh.ls(path.posix.join(remoteEmptyDir, "hoge"));
          expect(rt2).to.have.members(["piyo", "puyo", "poyo"]);
        });
        it("should accept absolute src dirname and relative dst dirname", async function() {
          await arssh.send(path.resolve(localRoot), remoteEmptyDir);

          let rt = await ssh.ls(remoteEmptyDir);
          expect(rt).to.have.members(["foo", "bar", "baz", "hoge", "huga"]);
          let rt2 = await ssh.ls(path.posix.join(remoteEmptyDir, "hoge"));
          expect(rt2).to.have.members(["piyo", "puyo", "poyo"]);
        });
        it("should accept relative src dirname and absolute dst dirname", async function() {
          const remoteHome = await arssh.realpath(".");
          await arssh.send(localRoot, path.posix.join(remoteHome, remoteEmptyDir));

          let rt = await ssh.ls(remoteEmptyDir);
          expect(rt).to.have.members(["foo", "bar", "baz", "hoge", "huga"]);
          let rt2 = await ssh.ls(path.posix.join(remoteEmptyDir, "hoge"));
          expect(rt2).to.have.members(["piyo", "puyo", "poyo"]);
        });
        it("should accept absolute src dirname and absolute dst dirname", async function() {
          const remoteHome = await arssh.realpath(".");
          await arssh.send(path.resolve(localRoot), path.posix.join(remoteHome, remoteEmptyDir));

          let rt = await ssh.ls(remoteEmptyDir);
          expect(rt).to.have.members(["foo", "bar", "baz", "hoge", "huga"]);
          let rt2 = await ssh.ls(path.posix.join(remoteEmptyDir, "hoge"));
          expect(rt2).to.have.members(["piyo", "puyo", "poyo"]);
        });

        if (process.platform !== "win32") {
          it("should send directory tree and keep file permission", async function() {
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
        it("should send directory tree if only filter matched", async function() {
          await arssh.send(localRoot, remoteEmptyDir, "*/{ba*,hoge/*}");

          let rt = await ssh.ls(path.posix.join(remoteEmptyDir));
          expect(rt).to.have.members(["hoge", "bar", "baz", "huga"]);
          rt = await ssh.ls(path.posix.join(remoteEmptyDir, "hoge"));
          expect(rt).to.have.members(["piyo", "puyo", "poyo"]);
        });
        it("should send directory tree if exclude filter not matched", async function() {
          await arssh.send(localRoot, remoteEmptyDir, null, "*/{ba*,hoge*}");

          let rt = await ssh.ls(path.posix.join(remoteEmptyDir));
          expect(rt).to.have.members(["foo", "hoge", "huga"]);
        });
        it("should send directory tree if only filter matched but exclude filter not matched", async function() {
          await arssh.send(localRoot, remoteEmptyDir, "*/{ba*,hoge/*}", "**/poyo");

          let rt = await ssh.ls(path.posix.join(remoteEmptyDir));
          expect(rt).to.have.members(["hoge", "bar", "baz", "huga"]);
          rt = await ssh.ls(path.posix.join(remoteEmptyDir, "hoge"));
          expect(rt).to.have.members(["piyo", "puyo"]);
        });
        it("shoud send empty directory", async function() {
          await arssh.send(localEmptyDir, remoteEmptyDir);

          let rt = await ssh.ls(remoteEmptyDir);
          expect(rt).to.have.lengthOf(0);
        });
      });
      describe("error case", function() {
        it("should not send directory to existing file path", async function() {
          await arssh.send(localFiles[0], path.posix.join(remoteEmptyDir, "hoge"));
          let rt = await ssh.ls(path.posix.join(remoteEmptyDir, "hoge"));
          expect(rt).to.have.members(["hoge"]);

          try {
            await arssh.send(localRoot, path.posix.join(remoteEmptyDir, "hoge"));
            expect.fail();
          } catch (e) {
            expect(e).to.be.an("error");
            expect(e.message).to.equal("destination path must not be existing file");
          }
        });
        it("should reject if src file does not exist", async function() {
          try {
            await arssh.send(path.join(localRoot, nonExisting), remoteEmptyDir);
            expect.fail();
          } catch (e) {
            expect(e.message).to.equal("src must be existing file or directory");
          }
        });
      });
    });

    describe("#recv", async function() {
      describe("recieve single file", function() {
        it("should accept relative src file and relative dst dir name", async function() {
          await arssh.recv(remoteFiles[3], localEmptyDir);

          let rt = await promisify(fs.readdir)(localEmptyDir);
          expect(rt).to.have.members(["piyo"]);
        });
        it("should accept absolute src file and relative dst dir name", async function() {
          const remoteHome = await arssh.realpath(".");
          await arssh.recv(path.posix.join(remoteHome, remoteFiles[3]), localEmptyDir);

          let rt = await promisify(fs.readdir)(localEmptyDir);
          expect(rt).to.have.members(["piyo"]);
        });
        it("should accept relative src file and absolute dst dir name", async function() {
          await arssh.recv(remoteFiles[3], path.resolve(localEmptyDir));

          let rt = await promisify(fs.readdir)(localEmptyDir);
          expect(rt).to.have.members(["piyo"]);
        });
        it("should accept absolute src file and absolute dst dir name", async function() {
          const remoteHome = await arssh.realpath(".");
          await arssh.recv(path.posix.join(remoteHome, remoteFiles[3]), path.resolve(localEmptyDir));

          let rt = await promisify(fs.readdir)(localEmptyDir);
          expect(rt).to.have.members(["piyo"]);
        });
        it("should accept relative src file and relative dst file name", async function() {
          await arssh.recv(remoteFiles[0], path.join(localEmptyDir, "hoge"));

          let rt = await promisify(fs.readdir)(localEmptyDir);
          expect(rt).to.have.members(["hoge"]);
        });
        it("should accept absolute src file and relative dst file name", async function() {
          const remoteHome = await arssh.realpath(".");
          await arssh.recv(path.posix.join(remoteHome, remoteFiles[0]), path.join(localEmptyDir, "hoge"));

          let rt = await promisify(fs.readdir)(localEmptyDir);
          expect(rt).to.have.members(["hoge"]);
        });
        it("should accept relative src file and absolute dst file name", async function() {
          await arssh.recv(remoteFiles[0], path.resolve(localEmptyDir, "hoge"));

          let rt = await promisify(fs.readdir)(localEmptyDir);
          expect(rt).to.have.members(["hoge"]);
        });
        it("should accept absolute src file and absolute dst file name", async function() {
          const remoteHome = await arssh.realpath(".");
          await arssh.recv(path.posix.join(remoteHome, remoteFiles[0]), path.resolve(localEmptyDir, "hoge"));

          let rt = await promisify(fs.readdir)(localEmptyDir);
          expect(rt).to.have.members(["hoge"]);
        });
      });
      describe("recieve directory tree", function() {
        it("should accept relative src dirname and relative dst dirname", async function() {
          await arssh.recv(remoteRoot, localEmptyDir);

          let rt = await promisify(fs.readdir)(localEmptyDir);
          expect(rt).to.have.members(["foo", "bar", "baz", "hoge", "huga"]);
          rt = await promisify(fs.readdir)(path.join(localEmptyDir, "hoge"));
          expect(rt).to.have.members(["piyo", "puyo", "poyo"]);
        });
        it("should accept absolute src dirname and relative dst dirname", async function() {
          const remoteHome = await arssh.realpath(".");
          await arssh.recv(path.posix.join(remoteHome, remoteRoot), localEmptyDir);

          let rt = await promisify(fs.readdir)(localEmptyDir);
          expect(rt).to.have.members(["foo", "bar", "baz", "hoge", "huga"]);
          rt = await promisify(fs.readdir)(path.join(localEmptyDir, "hoge"));
          expect(rt).to.have.members(["piyo", "puyo", "poyo"]);
        });
        it("should accept relative src dirname and absolute dst dirname", async function() {
          await arssh.recv(remoteRoot, path.resolve(localEmptyDir));

          let rt = await promisify(fs.readdir)(localEmptyDir);
          expect(rt).to.have.members(["foo", "bar", "baz", "hoge", "huga"]);
          rt = await promisify(fs.readdir)(path.join(localEmptyDir, "hoge"));
          expect(rt).to.have.members(["piyo", "puyo", "poyo"]);
        });
        it("should accept absolute src dirname and absolute dst dirname", async function() {
          const remoteHome = await arssh.realpath(".");
          await arssh.recv(path.posix.join(remoteHome, remoteRoot), path.resolve(localEmptyDir));

          let rt = await promisify(fs.readdir)(localEmptyDir);
          expect(rt).to.have.members(["foo", "bar", "baz", "hoge", "huga"]);
          rt = await promisify(fs.readdir)(path.join(localEmptyDir, "hoge"));
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
      describe("error case", function() {
        it("should not send directory to existing file path", async function() {
          try {
            await arssh.recv(remoteRoot, localFiles[0]);
            expect.fail();
          } catch (e) {
            expect(e).to.be.an("error");
            expect(e.message).to.equal("destination path must not be existing file");
          }
        });
        it("should reject if src file does not exist", async function() {
          try {
            await arssh.recv(nonExisting, localEmptyDir);
            expect.fail();
          } catch (e) {
            expect(e).to.be.an("error");
            expect(e.message).to.equal("src must be existing file or directory");
          }
        });
      });
    });
  });
});
