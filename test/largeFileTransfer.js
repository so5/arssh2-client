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

const remoteLargeFile = `${remoteRoot}/remoteLargeFile`;
const localLargeFile = path.resolve(localRoot, "localLargeFile");

describe.skip("largefile handle test", async function() {
  this.timeout(0);
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

    //await ssh.exec(`for i in \`seq -w 0000000000000000000000000000001 0000000000000000000000000003000\`; do echo $i >> ${remoteLargeFile};done`);
    const ws = fs.createWriteStream(localLargeFile);
    const p = new Promise((resolve)=>{
      ws.on("close", ()=>{
        resolve();
      });
    });
    for (let i = 0; i < 6000000; i++) {
      ws.write(`${`10000000000000000000000000000000${i}`.slice(-31)}\n`);
    }
    ws.end();
    await p;
  });
  after(async()=>{
    //await clearRemoteTestFiles(ssh);
    //await clearLocalTestFiles();
    ssh.disconnect();
    arssh.disconnect();
  });

  describe("#send", async()=>{
    describe("send single file", ()=>{
      it("should send over 32kB file", async()=>{
        await arssh.send(localLargeFile, remoteEmptyDir);
      });
    });
  });
});
