"use strict";
Error.traceLimit = 100000;
process.on("unhandledRejection", console.dir); //eslint-disable-line no-console

//setup test framework
const { expect } = require("chai");

//testee
const ARsshClient = require("../lib/index.js");

//helper
const getConfig = require("./util/config");

describe("test for utility functions", function() {
  this.timeout(5000); //eslint-disable-line no-invalid-this
  //global variables
  let arssh;
  let config;

  beforeEach(async()=>{
    config = await getConfig();
    arssh = new ARsshClient(config, { delay: 1000, connectionRetryDelay: 100 });
  });

  afterEach(()=>{
    arssh.disconnect();
  });

  describe("#canConnect", ()=>{
    it("should be resolved with true", async()=>{
      expect(await arssh.canConnect()).to.be.true;
    });
    it("should be rejected if user does not exist", async()=>{
      config.username = "xxxxx";
      const arssh2 = new ARsshClient(config, {
        connectionRetryDelay: 100
      });
      await arssh2
        .canConnect()
        .then(expect.fail)
        .catch((err)=>{
          expect(err.reason).to.equal("authentication failure");
        });
    });
    it("should be rejected if user is undefined", async()=>{
      delete (config.username);
      const arssh2 = new ARsshClient(config, { connectionRetryDelay: 100 });
      await arssh2
        .canConnect()
        .then(expect.fail)
        .catch((err)=>{
          expect(err.reason).to.equal("invalid username");
        });
    });
    it("should be rejected if password is wrong", async()=>{
      config.password = "";
      delete (config.passphrase);
      delete (config.privateKey);
      const arssh2 = new ARsshClient(config, { connectionRetryDelay: 100 });
      await arssh2
        .canConnect()
        .then(expect.fail)
        .catch((err)=>{
          expect(err.reason).to.equal("authentication failure");
        });
    });
    it("should be rejected if privateKey is wrong", async()=>{
      config.privateKey = "xxx";
      const arssh2 = new ARsshClient(config, { connectionRetryDelay: 100 });
      await arssh2
        .canConnect()
        .then(expect.fail)
        .catch((err)=>{
          expect(err.reason).to.equal("invalid private key");
        });
    });
    it("should be rejected if host does not exist", async()=>{
      config.hostname = "foo.bar.example.com";
      const arssh2 = new ARsshClient(config, { connectionRetryDelay: 100 });
      await arssh2
        .canConnect()
        .then(expect.fail)
        .catch((err)=>{
          expect(err.reason).to.equal("name resolution failure");
        });
    });
    it("should be rejected if host(ip address) does not exist", async()=>{
      config.hostname = "192.0.2.1";
      config.readyTimeout = 200;
      const arssh2 = new ARsshClient(config, { connectionRetry: 1, connectionRetryDelay: 10 });
      await arssh2
        .canConnect()
        .then(expect.fail)
        .catch((err)=>{
          expect(err.reason).to.equal("timeout occurred during connection process");
        });
    });
    it("should be rejected if port number is out of range(-1)", async()=>{
      config.port = -1;
      const arssh2 = new ARsshClient(config, { connectionRetryDelay: 100 });
      await arssh2
        .canConnect()
        .then(expect.fail)
        .catch((err)=>{
          expect(err.reason).to.equal("illegal port number");
        });
    });
    it("should be rejected if port number is out of range(65536)", async()=>{
      config.port = 65536;
      const arssh2 = new ARsshClient(config, { connectionRetryDelay: 100 });
      await arssh2
        .canConnect()
        .then(expect.fail)
        .catch((err)=>{
          expect(err.reason).to.equal("illegal port number");
        });
    });
  });

  describe.skip("#getter for statics", ()=>{
    it("should get trafic", async()=>{
      const testText = "hoge";
      const output = [];
      expect(await arssh.exec(`echo ${testText}; echo ${testText}>&2`, {}, output, output)).to.equal(0);
      expect(output).to.have.members([`${testText}\n`, `${testText}\n`]);
      expect(arssh.bytesSent).above(0);
      expect(arssh.bytesReceived).above(0);
      expect(arssh.bytesTransferred).above(0);
    });
  });
});
