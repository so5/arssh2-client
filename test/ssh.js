const { promisify } = require("util");
const fs = require("fs");
const path = require("path");

//setup test framework
const chai = require("chai");
const { expect } = require("chai");
const sinon = require("sinon");
chai.use(require("sinon-chai"));
chai.use(require("chai-fs"));

const ARsshClient = require("../lib/index.js");
Error.traceLimit = 100000;

const getConfig = require("./util/config");
const { nonExisting } = require("./util/testFiles");

describe("#exec", function() {
  this.timeout(10000);
  //global variables
  let arssh; //testee
  const sshout = sinon.stub();
  const ssherr = sinon.stub();
  beforeEach(async()=>{
    const config = await getConfig();
    arssh = new ARsshClient(config, { delay: 1000, connectionRetryDelay: 100 });
  });
  afterEach(async()=>{
    sshout.reset();
    ssherr.reset();
    arssh.disconnect();
  });


  const testText = "hoge";

  it("should execute single command with stdout", async()=>{
    const stdout = [];
    const rt = await arssh.exec(`echo ${testText}`, {}, stdout, ssherr);
    expect(rt).to.equal(0);
    expect(ssherr).not.to.be.called;
    expect(stdout).to.have.members(["hoge\n"]);
  });
  it("should execute single command with stderr", async()=>{
    const stderr = [];
    const rt = await arssh.exec(`echo ${testText} >&2`, {}, sshout, stderr);
    expect(rt).to.equal(0);
    expect(sshout).not.to.be.called;
    expect(stderr).to.have.members(["hoge\n"]);
  });
  it("should execute single command with stdout & stderr", async()=>{
    const output = [];
    const rt = await arssh.exec(`echo ${testText}; echo ${testText}>&2`, {}, output, output);
    expect(rt).to.equal(0);
    expect(output).to.have.members(["hoge\n", "hoge\n"]);
  });
  //please note that exec() resolves with non-zero value
  //(126 permisssion deny or 127 file not found)
  //but does not reject in following 2 cases
  it("should not execute command which do not have exec permission", async()=>{
    await arssh.exec("echo echo hoge >hoge");
    await arssh.exec("chmod ugo-x hoge");
    const rt = await arssh.exec("./hoge");
    expect(rt).to.equal(126);
  });
  it("should reject if command is not found", async()=>{
    const rt = await arssh.exec(`./${nonExisting}`, {});
    expect(rt).to.equal(127);
  });
});
