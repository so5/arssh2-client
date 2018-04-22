const { expect } = require("chai");

const ARsshClient = require("../lib/index.js");
const readConfig = require("./config");
const { sleep } = require("./util");

process.on("unhandledRejection", console.dir); // eslint-disable-line no-console

const testText = "hoge";
let config = null;
let arssh = null;

describe.skip("reconnect test", function() {
  this.timeout(0);
  before(async function() {
    const configFile = "test/server/vbox.json";
    const keyFile = `${process.env.HOME}/.vagrant.d/insecure_private_key`;
    config = await readConfig(configFile, keyFile);
  });
  afterEach(function() {
    arssh.disconnect();
  });
  it("should exec command after sshd is restarted", async function() {
    arssh = new ARsshClient(config, { connectionRetryDelay: 100, maxConnection: 1 });
    const stdout = [];
    let rt = await arssh.exec(`sudo systemctl restart sshd`, {}, stdout);
    expect(rt).to.equal(0);
    await sleep(1000);

    rt = await arssh.exec(`echo ${testText}`, {}, stdout);
    expect(rt).to.equal(0);
    expect(stdout).to.have.members(["hoge\n"]);
  });
  it("should exec command after ssh re-key event is occurred", async function() {
    config.port = 2022;
    arssh = new ARsshClient(config, { connectionRetryDelay: 100, maxConnection: 1 });
    const stdout = [];
    let rt = await arssh.exec(`echo ${testText}`, {}, stdout);
    expect(rt).to.equal(0);
    expect(stdout).to.have.members(["hoge\n"]);
    await sleep(6000);

    stdout.splice(0, stdout.length);
    rt = await arssh.exec(`echo ${testText}`, {}, stdout);
    expect(rt).to.equal(0);
    expect(stdout).to.have.members(["hoge\n"]);
  });
  it("should exec command after client alive event is occurred", async function() {
    config.port = 2023;
    arssh = new ARsshClient(config, { connectionRetryDelay: 100, maxConnection: 1 });
    const stdout = [];
    let rt = await arssh.exec(`echo ${testText}`, {}, stdout);
    expect(rt).to.equal(0);
    expect(stdout).to.have.members(["hoge\n"]);
    await sleep(6000);

    stdout.splice(0, stdout.length);
    rt = await arssh.exec(`echo ${testText}`, {}, stdout);
    expect(rt).to.equal(0);
    expect(stdout).to.have.members(["hoge\n"]);
  });
  it("should exec command after tcp session timeout event is occurred", async function() {
    arssh = new ARsshClient(config, { connectionRetryDelay: 100, maxConnection: 1 });
    const stdout = [];
    let rt = await arssh.exec(`echo ${testText}`, {}, stdout);
    expect(rt).to.equal(0);
    expect(stdout).to.have.members(["hoge\n"]);
    await sleep(62000);

    stdout.splice(0, stdout.length);
    rt = await arssh.exec(`echo ${testText}`, {}, stdout);
    expect(rt).to.equal(0);
    expect(stdout).to.have.members(["hoge\n"]);
  });
});
