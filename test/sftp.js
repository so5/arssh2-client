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

async function isDir(target, ssh) {
  const output = [];
  await ssh.exec(`ls -ld ${target}`, {}, output, output);
  return output[0].startsWith("d");
}

async function stat(target, ssh) {
  const output = [];
  //TODO check BSD
  const cmdline = process.platform === "darwin" ? `stat -f \'%Op\' ${target}` : `stat --format '%a' ${target}`;
  await ssh.exec(cmdline, {}, output, output);
  return output[0].trim().slice(-3);
}


//actual test start from here
describe("test for sftp subcommands", function() {
  this.timeout(10000);
  //global variables
  let arssh; //testee
  let ssh; //house keeping
  before(async()=>{
    const config = await getConfig();
    ssh = new ARsshClient(config);
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

  describe("#realpath", ()=>{
    it("should return absolute path of existing directory", async()=>{
      const remoteHome = await arssh.realpath(".");
      const rt = await arssh.realpath(remoteRoot);
      expect(rt).to.equal(path.posix.join(remoteHome, remoteRoot));
    });
    it("should return absolute path of existing file", async()=>{
      const remoteHome = await arssh.realpath(".");
      const rt = await arssh.realpath(remoteFiles[0]);
      expect(rt).to.equal(path.posix.join(remoteHome, remoteFiles[0]));
    });
    it("should return absolute path of not-existing", async ()=>{
      const remoteHome = await arssh.realpath(".");
      const rt = await arssh.realpath(nonExisting);
      expect(rt).to.equal(path.posix.join(remoteHome, nonExisting));
    });
  });

  describe("#ls", ()=>{
    it("should return array of file and directory names", async()=>{
      expect(await arssh.ls(remoteRoot)).to.have.members(["foo", "bar", "baz", "hoge", "huga"]);
    });
    it("should return array which has single file", async()=>{
      expect(await arssh.ls(path.posix.join(remoteRoot, "foo"))).to.eql(["foo"]);
    });
    it("should return empty array", async()=>{
      expect(await arssh.ls(path.posix.join(remoteRoot, nonExisting))).to.eql([]);
    });
  });

  describe("#chmod", function() {
    this.timeout(4000);
    it("should change file mode", async()=>{
      await arssh.chmod(remoteFiles[0], "700");
      let output = [];
      await arssh.exec(`ls -l ${path.posix.dirname(remoteFiles[0])}`, {}, output, output);
      output = output.join();
      output = output.split("\n");

      const tmp2 = output.find((e)=>{
        return e.endsWith(path.posix.basename(remoteFiles[0]));
      });
      expect(tmp2.startsWith("-rwx------")).to.be.true;
    });
  });
  describe("#mkdir_p", ()=>{
    it("should make child of existing directory", async()=>{
      const target = `${remoteRoot}/hogehoge`;
      const rt = await arssh.mkdir_p(target);

      expect(rt).to.eql(undefined);
      expect(await isDir(target, ssh)).to.be.true;
    });
    it("should make child dir of non-existing directory with trailing pathsep", async()=>{
      const target = `${remoteRoot}/${nonExisting}/hogehoge/foo/bar/baz/huga/`;
      const rt = await arssh.mkdir_p(target);

      expect(rt).to.eql(undefined);
      expect(await isDir(target, ssh)).to.be.true;
    });
    it("should make child dir of non-existing directory", async()=>{
      const target = `${remoteRoot}/${nonExisting}/hogehoge/foo/bar/baz/huga`;
      const rt = await arssh.mkdir_p(target);

      expect(rt).to.eql(undefined);
      expect(await isDir(target, ssh)).to.be.true;
    });
    it("should resolve with undefined if making existing directory", async()=>{
      const target = remoteRoot;
      const rt = await arssh.mkdir_p(target);

      expect(rt).to.eql(undefined);
      expect(await isDir(target, ssh)).to.be.true;
    });
    it("should rejected if target path is existing file", async()=>{
      try {
        await arssh.mkdir_p(remoteFiles[0]);
        expect.fail();
      } catch (e) {
        expect(e.code).to.equal("EEXIST");
      }
    });
    it("should reject if making child dir of not-owned directory", async()=>{
      try {
        await arssh.mkdir_p("/root/hoge");
        expect.fail();
      } catch (e) {
        expect(e.message).to.equal("Permission denied");
      }
    });
  });

  describe("#send", async()=>{
    describe("send single file", ()=>{
      it("should accept relative src file and relative dst dir name", async()=>{
        await arssh.send(localFiles[0], remoteEmptyDir);

        const rt = await ssh.ls(remoteEmptyDir);
        expect(rt).to.have.members(["foo"]);
      });
      it("should accept absolute src file and relative dst dir name", async()=>{
        await arssh.send(path.resolve(localFiles[3]), remoteEmptyDir);

        const rt = await ssh.ls(remoteEmptyDir);
        expect(rt).to.have.members(["piyo"]);
      });
      it("should accept relative src file and absolute dst dir name", async()=>{
        const remoteHome = await arssh.realpath(".");
        await arssh.send(localFiles[0], path.posix.join(remoteHome, remoteEmptyDir));

        const rt = await ssh.ls(remoteEmptyDir);
        expect(rt).to.have.members(["foo"]);
      });
      it("should accept absolute src file and absolute dst dir name", async()=>{
        const remoteHome = await arssh.realpath(".");
        await arssh.send(path.resolve(localFiles[0]), path.posix.join(remoteHome, remoteEmptyDir));

        const rt = await ssh.ls(remoteEmptyDir);
        expect(rt).to.have.members(["foo"]);
      });
      it("should accept relative src file and relative dst file name", async()=>{
        await arssh.send(localFiles[0], path.posix.join(remoteEmptyDir, "hoge"));

        const rt = await ssh.ls(path.posix.join(remoteEmptyDir, "hoge"));
        expect(rt).to.have.members(["hoge"]);
      });
      it("should accept absolute src file and relative dst file name", async()=>{
        await arssh.send(path.resolve(localFiles[0]), path.posix.join(remoteEmptyDir, "hoge"));

        const rt = await ssh.ls(path.posix.join(remoteEmptyDir, "hoge"));
        expect(rt).to.have.members(["hoge"]);
      });
      it("should accept relative src file and absolute dst file name", async()=>{
        const remoteHome = await arssh.realpath(".");
        await arssh.send(localFiles[0], path.posix.join(remoteHome, remoteEmptyDir, "hoge"));

        const rt = await ssh.ls(path.posix.join(remoteEmptyDir, "hoge"));
        expect(rt).to.have.members(["hoge"]);
      });
      it("should accept absolute src file and absolute dst file name", async()=>{
        const remoteHome = await arssh.realpath(".");
        await arssh.send(path.resolve(localFiles[0]), path.posix.join(remoteHome, remoteEmptyDir, "hoge"));

        const rt = await ssh.ls(path.posix.join(remoteEmptyDir, "hoge"));
        expect(rt).to.have.members(["hoge"]);
      });

      if (process.platform !== "win32") {
        it("should send and keep file permission(can not work on windows)", async()=>{
          const perm = "633";
          await fs.chmod(localFiles[0], perm);
          await arssh.send(localFiles[0], remoteEmptyDir);

          const remoteHome = await arssh.realpath(".");
          const rt = await stat(path.posix.join(remoteHome, remoteEmptyDir, path.basename(localFiles[0])), ssh);
          expect(rt).to.be.equal(perm);
        });
      }
      it("should overwrite existing file", async()=>{
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
    describe("send directory tree", ()=>{
      it("should accept relative src dirname and relative dst dirname", async()=>{
        await arssh.send(localRoot, remoteEmptyDir);

        const rt = await ssh.ls(remoteEmptyDir);
        expect(rt).to.have.members(["foo", "bar", "baz", "hoge", "huga"]);
        const rt2 = await ssh.ls(path.posix.join(remoteEmptyDir, "hoge"));
        expect(rt2).to.have.members(["piyo", "puyo", "poyo"]);
      });
      it("should accept absolute src dirname and relative dst dirname", async()=>{
        await arssh.send(path.resolve(localRoot), remoteEmptyDir);

        const rt = await ssh.ls(remoteEmptyDir);
        expect(rt).to.have.members(["foo", "bar", "baz", "hoge", "huga"]);
        const rt2 = await ssh.ls(path.posix.join(remoteEmptyDir, "hoge"));
        expect(rt2).to.have.members(["piyo", "puyo", "poyo"]);
      });
      it("should accept relative src dirname and absolute dst dirname", async()=>{
        const remoteHome = await arssh.realpath(".");
        await arssh.send(localRoot, path.posix.join(remoteHome, remoteEmptyDir));

        const rt = await ssh.ls(remoteEmptyDir);
        expect(rt).to.have.members(["foo", "bar", "baz", "hoge", "huga"]);
        const rt2 = await ssh.ls(path.posix.join(remoteEmptyDir, "hoge"));
        expect(rt2).to.have.members(["piyo", "puyo", "poyo"]);
      });
      it("should accept absolute src dirname and absolute dst dirname", async()=>{
        const remoteHome = await arssh.realpath(".");
        await arssh.send(path.resolve(localRoot), path.posix.join(remoteHome, remoteEmptyDir));

        const rt = await ssh.ls(remoteEmptyDir);
        expect(rt).to.have.members(["foo", "bar", "baz", "hoge", "huga"]);
        const rt2 = await ssh.ls(path.posix.join(remoteEmptyDir, "hoge"));
        expect(rt2).to.have.members(["piyo", "puyo", "poyo"]);
      });

      if (process.platform !== "win32") {
        it("should send directory tree and keep file permission (can not work on windows)", async()=>{
          const perm = "633";
          await fs.chmod(localFiles[0], perm);
          await arssh.send(localRoot, remoteEmptyDir);

          const rt = await ssh.ls(remoteEmptyDir);
          expect(rt).to.have.members(["foo", "bar", "baz", "hoge", "huga"]);
          const rt2 = await ssh.ls(path.posix.join(remoteEmptyDir, "hoge"));
          expect(rt2).to.have.members(["piyo", "puyo", "poyo"]);
          expect(await stat(path.posix.join(remoteEmptyDir, "foo"), ssh)).to.be.equal(perm);
        });
      }
      it("should send directory tree if only filter matched", async()=>{
        await arssh.send(localRoot, remoteEmptyDir, "*/{ba*,hoge/*}");

        let rt = await ssh.ls(path.posix.join(remoteEmptyDir));
        expect(rt).to.have.members(["hoge", "bar", "baz", "huga"]);
        rt = await ssh.ls(path.posix.join(remoteEmptyDir, "hoge"));
        expect(rt).to.have.members(["piyo", "puyo", "poyo"]);
      });
      it("should send directory tree if exclude filter not matched", async()=>{
        await arssh.send(localRoot, remoteEmptyDir, null, "*/{ba*,hoge*}");

        const rt = await ssh.ls(path.posix.join(remoteEmptyDir));
        expect(rt).to.have.members(["foo", "hoge", "huga"]);
      });
      it("should send directory tree if only filter matched but exclude filter not matched", async()=>{
        await arssh.send(localRoot, remoteEmptyDir, "*/{ba*,hoge/*}", "**/poyo");

        let rt = await ssh.ls(path.posix.join(remoteEmptyDir));
        expect(rt).to.have.members(["hoge", "bar", "baz", "huga"]);
        rt = await ssh.ls(path.posix.join(remoteEmptyDir, "hoge"));
        expect(rt).to.have.members(["piyo", "puyo"]);
      });
      it("shoud send empty directory", async()=>{
        await arssh.send(localEmptyDir, remoteEmptyDir);

        const rt = await ssh.ls(remoteEmptyDir);
        expect(rt).to.have.lengthOf(0);
      });
    });
    describe("error case", ()=>{
      it("should not send directory to existing file path", async()=>{
        await arssh.send(localFiles[0], path.posix.join(remoteEmptyDir, "hoge"));
        const rt = await ssh.ls(path.posix.join(remoteEmptyDir, "hoge"));
        expect(rt).to.have.members(["hoge"]);

        try {
          await arssh.send(localRoot, path.posix.join(remoteEmptyDir, "hoge"));
          expect.fail();
        } catch (e) {
          expect(e).to.be.an("error");
          expect(e.message).to.equal("destination path must not be existing file");
        }
      });
      it("should reject if src file does not exist", async()=>{
        try {
          await arssh.send(path.join(localRoot, nonExisting), remoteEmptyDir);
          expect.fail();
        } catch (e) {
          expect(e.message).to.equal("src must be existing file or directory");
        }
      });
    });
  });

  describe("#recv", async()=>{
    describe("recieve single file", ()=>{
      it("should accept relative src file and relative dst dir name", async()=>{
        await arssh.recv(remoteFiles[3], localEmptyDir);

        const rt = await fs.readdir(localEmptyDir);
        expect(rt).to.have.members(["piyo"]);
      });
      it("should accept absolute src file and relative dst dir name", async()=>{
        const remoteHome = await arssh.realpath(".");
        await arssh.recv(path.posix.join(remoteHome, remoteFiles[3]), localEmptyDir);

        const rt = await fs.readdir(localEmptyDir);
        expect(rt).to.have.members(["piyo"]);
      });
      it("should accept relative src file and absolute dst dir name", async()=>{
        await arssh.recv(remoteFiles[3], path.resolve(localEmptyDir));

        const rt = await fs.readdir(localEmptyDir);
        expect(rt).to.have.members(["piyo"]);
      });
      it("should accept absolute src file and absolute dst dir name", async()=>{
        const remoteHome = await arssh.realpath(".");
        await arssh.recv(path.posix.join(remoteHome, remoteFiles[3]), path.resolve(localEmptyDir));

        const rt = await fs.readdir(localEmptyDir);
        expect(rt).to.have.members(["piyo"]);
      });
      it("should accept relative src file and relative dst file name", async()=>{
        await arssh.recv(remoteFiles[0], path.join(localEmptyDir, "hoge"));

        const rt = await fs.readdir(localEmptyDir);
        expect(rt).to.have.members(["hoge"]);
      });
      it("should accept absolute src file and relative dst file name", async()=>{
        const remoteHome = await arssh.realpath(".");
        await arssh.recv(path.posix.join(remoteHome, remoteFiles[0]), path.join(localEmptyDir, "hoge"));

        const rt = await fs.readdir(localEmptyDir);
        expect(rt).to.have.members(["hoge"]);
      });
      it("should accept relative src file and absolute dst file name", async()=>{
        await arssh.recv(remoteFiles[0], path.resolve(localEmptyDir, "hoge"));

        const rt = await fs.readdir(localEmptyDir);
        expect(rt).to.have.members(["hoge"]);
      });
      it("should accept absolute src file and absolute dst file name", async()=>{
        const remoteHome = await arssh.realpath(".");
        await arssh.recv(path.posix.join(remoteHome, remoteFiles[0]), path.resolve(localEmptyDir, "hoge"));

        const rt = await fs.readdir(localEmptyDir);
        expect(rt).to.have.members(["hoge"]);
      });
    });
    describe("recieve directory tree", ()=>{
      it("should accept relative src dirname and relative dst dirname", async()=>{
        await arssh.recv(remoteRoot, localEmptyDir);

        let rt = await fs.readdir(localEmptyDir);
        expect(rt).to.have.members(["foo", "bar", "baz", "hoge", "huga"]);
        rt = await fs.readdir(path.join(localEmptyDir, "hoge"));
        expect(rt).to.have.members(["piyo", "puyo", "poyo"]);
      });
      it("should accept absolute src dirname and relative dst dirname", async()=>{
        const remoteHome = await arssh.realpath(".");
        await arssh.recv(path.posix.join(remoteHome, remoteRoot), localEmptyDir);

        let rt = await fs.readdir(localEmptyDir);
        expect(rt).to.have.members(["foo", "bar", "baz", "hoge", "huga"]);
        rt = await fs.readdir(path.join(localEmptyDir, "hoge"));
        expect(rt).to.have.members(["piyo", "puyo", "poyo"]);
      });
      it("should accept relative src dirname and absolute dst dirname", async()=>{
        await arssh.recv(remoteRoot, path.resolve(localEmptyDir));

        let rt = await fs.readdir(localEmptyDir);
        expect(rt).to.have.members(["foo", "bar", "baz", "hoge", "huga"]);
        rt = await fs.readdir(path.join(localEmptyDir, "hoge"));
        expect(rt).to.have.members(["piyo", "puyo", "poyo"]);
      });
      it("should accept absolute src dirname and absolute dst dirname", async()=>{
        const remoteHome = await arssh.realpath(".");
        await arssh.recv(path.posix.join(remoteHome, remoteRoot), path.resolve(localEmptyDir));

        let rt = await fs.readdir(localEmptyDir);
        expect(rt).to.have.members(["foo", "bar", "baz", "hoge", "huga"]);
        rt = await fs.readdir(path.join(localEmptyDir, "hoge"));
        expect(rt).to.have.members(["piyo", "puyo", "poyo"]);
      });
      it("should recv files which matches only filter", async()=>{
        await arssh.recv(remoteRoot, localEmptyDir, "*/{ba*,hoge/*}");
        let rt = await fs.readdir(path.join(localEmptyDir));
        expect(rt).to.have.members(["bar", "baz", "hoge", "huga"]);
        rt = await fs.readdir(path.join(localEmptyDir, "hoge"));
        expect(rt).to.have.members(["piyo", "puyo", "poyo"]);
      });
      it("should not recv files which matches exclude filter", async()=>{
        await arssh.recv(remoteRoot, localEmptyDir, null, "*/{ba*,hoge/*}");
        const rt = await fs.readdir(path.join(localEmptyDir));
        expect(rt).to.have.members(["foo", "hoge", "huga"]);
      });
      it("should recv files which matches only filter but should not recv which matches exclude filter", async()=>{
        await arssh.recv(remoteRoot, localEmptyDir, "*/{ba*,hoge/*}", "**/piyo");
        let rt = await fs.readdir(path.join(localEmptyDir));
        expect(rt).to.have.members(["bar", "baz", "hoge", "huga"]);
        rt = await fs.readdir(path.join(localEmptyDir, "hoge"));
        expect(rt).to.have.members(["puyo", "poyo"]);
      });
    });
    describe("error case", ()=>{
      it("should not send directory to existing file path", async()=>{
        try {
          await arssh.recv(remoteRoot, localFiles[0]);
          expect.fail();
        } catch (e) {
          expect(e).to.be.an("error");
          expect(e.message).to.equal("destination path must not be existing file");
        }
      });
      it("should reject if src file does not exist", async()=>{
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