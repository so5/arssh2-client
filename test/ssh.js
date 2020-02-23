"use strict";

//setup test framework
const chai = require("chai");
const { expect } = require("chai");
const sinon = require("sinon");
chai.use(require("sinon-chai"));
chai.use(require("chai-fs"));

const ARsshClient = require("../lib/index.js");
Error.traceLimit = 100000;

const getConfig = require("./util/config");
const { nonExisting, remoteRoot } = require("./util/testFiles");

describe("test for ssh execution", function() {
  this.timeout(10000);//eslint-disable-line no-invalid-this

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

  describe("#watch", ()=>{
    beforeEach(async()=>{
      try {
        await arssh.mkdir_p(remoteRoot);
        await arssh.rm(`${remoteRoot}/tmp`);
      } catch (e) {
        if (e.message !== "No such file") {
          throw e;
        }
      }
    });
    afterEach(async()=>{
      try {
        await arssh.rm(`${remoteRoot}/tmp`);
        await arssh.rm(remoteRoot);
      } catch (e) {
        if (e.message !== "No such file") {
          throw e;
        }
      }
    });
    it("should execute command repeatedly until output match with specified regexp", async()=>{
      const rt = await arssh.watch(`echo -n hoge >> ${remoteRoot}/tmp && cat ${remoteRoot}/tmp`, /hogehogehoge/u, 10, 5, {}, sshout, ssherr);
      expect(rt).to.equal(0);
      expect(sshout).to.be.calledThrice;
      expect(sshout.getCall(0)).to.be.calledWith("hoge");
      expect(sshout.getCall(1)).to.be.calledWith("hogehoge");
      expect(sshout.getCall(2)).to.be.calledWith("hogehogehoge");
      expect(ssherr).not.to.be.called;
    });
    it("should execute command repeatedly until stdout match with specified regexp", async()=>{
      const rt = await arssh.watch(`echo -n hogehogehoge >&2 && echo -n hoge >> ${remoteRoot}/tmp && cat ${remoteRoot}/tmp`, { out: /hogehogehoge/u }, 10, 5, {}, sshout, ssherr);
      expect(rt).to.equal(0);
      expect(sshout).to.be.calledThrice;
      expect(sshout.getCall(0)).to.be.calledWith("hoge");
      expect(sshout.getCall(1)).to.be.calledWith("hogehoge");
      expect(sshout.getCall(2)).to.be.calledWith("hogehogehoge");
      expect(ssherr).to.be.calledThrice;
      expect(ssherr).to.be.calledWith("hogehogehoge");
    });
    it("should execute command repeatedly until stderr match with specified regexp", async()=>{
      const rt = await arssh.watch(`echo -n hogehogehoge && echo -n hoge >> ${remoteRoot}/tmp && cat ${remoteRoot}/tmp >&2`, { err: /hogehogehoge/u }, 10, 5, {}, sshout, ssherr);
      expect(rt).to.equal(0);
      expect(ssherr).to.be.calledThrice;
      expect(ssherr.getCall(0)).to.be.calledWith("hoge");
      expect(ssherr.getCall(1)).to.be.calledWith("hogehoge");
      expect(ssherr.getCall(2)).to.be.calledWith("hogehogehoge");
      expect(sshout).to.be.calledThrice;
      expect(sshout).to.be.calledWith("hogehogehoge");
    });
    it("should be rejected if output does not matched with specified regexp", ()=>{
      return expect(arssh.watch(`echo -n hoge >> ${remoteRoot}/tmp && cat ${remoteRoot}/tmp`, /foo/u, 10, 2, {}, sshout, ssherr)).to.be.rejected;
    });
    it("should be rejected if stdout does not matched with specified regexp", ()=>{
      return expect(arssh.watch(`echo -n hogehogehoge >&2 && echo -n hoge >> ${remoteRoot}/tmp && cat ${remoteRoot}/tmp`, { out: /foo/u }, 10, 2, {}, sshout, ssherr)).to.be.rejected;
    });
    it("should be rejected if stderr does not matched with specified regexp", ()=>{
      return expect(arssh.watch(`echo -n hogehogehoge && echo -n hoge >> ${remoteRoot}/tmp && cat ${remoteRoot}/tmp >&2`, { err: /foo/u }, 10, 2, {}, sshout, ssherr)).to.be.rejected;
    });
  });
  describe("#exec", ()=>{
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
    it("should execute single command with stdout and pass to call back routine", async()=>{
      const rt = await arssh.exec(`echo ${testText}`, {}, sshout, ssherr);
      expect(rt).to.equal(0);
      expect(sshout).to.be.calledOnce;
      expect(sshout).to.be.calledWithExactly("hoge\n");
      expect(ssherr).not.to.be.called;
    });
    it("should execute single command with stderr and pass to call back routine", async()=>{
      const rt = await arssh.exec(`echo ${testText} >&2`, {}, sshout, ssherr);
      expect(rt).to.equal(0);
      expect(ssherr).to.be.calledOnce;
      expect(ssherr).to.be.calledWithExactly("hoge\n");
      expect(sshout).not.to.be.called;
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
});
