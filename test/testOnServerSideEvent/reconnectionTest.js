const {fs} = require("fs-extra");
const { expect } = require("chai");

const ARsshClient = require("../lib/index.js");
const { sleep } = require("../lib/utils");

process.on("unhandledRejection", console.dir); //eslint-disable-line no-console

const testText = "hoge";
let config = null;
let arssh = null;

describe("reconnect test", function() {
  this.timeout(0);
  let privateKey;
  before(async()=>{
    const keyFile = `${process.env.HOME}/.vagrant.d/insecure_private_key`;
    privateKey = (await fs.readFile(keyFile)).toString();
  });
  beforeEach(async()=>{
    config = {
      hsostname: "127.0.0.1",
      username: "vagrant",
      port: 2222,
      privateKey
    };

    arssh = new ARsshClient(config, { connectionRetryDelay: 100, maxConnection: 1 });
  });
  afterEach(()=>{
    arssh.disconnect();
  });
  it("should exec command after sshd is restarted", async()=>{
    const stdout = [];
    let rt = await arssh.exec("sudo systemctl restart sshd", {}, stdout);
    expect(rt).to.equal(0);
    await sleep(1000);

    rt = await arssh.exec(`echo ${testText}`, {}, stdout);
    expect(rt).to.equal(0);
    expect(stdout).to.have.members(["hoge\n"]);
  });
  it("should exec command after network device is reset", async()=>{
    const stdout = [];
    let rt = await arssh.exec("sudo ip link set dev eth0 down&& sleep 1 &&sudo ip link set dev eth0 up", {}, stdout);
    expect(rt).to.equal(0);
    await sleep(1000);
    rt = await arssh.exec(`echo ${testText}`, {}, stdout);
    expect(rt).to.equal(0);
    expect(stdout).to.have.members(["hoge\n"]);
  });
  it("should exec command if network device is reset while executing", async()=>{
    const stdout = [];
    arssh.maxConnection = 2;
    let rt = await arssh.exec(
      "nohup sh -c 'sudo ip link set dev eth0 down&& sleep 10 &&sudo ip link set dev eth0 up' &",
      {},
      stdout
    );
    expect(rt).to.equal(0);
    await sleep(1000);
    rt = await arssh.exec(`echo ${testText}| tee tmp`, {}, stdout);
    expect(rt).to.equal(0);
    expect(stdout).to.have.members(["hoge\n"]);
  });
  it("should exec command after ssh re-key event is occurred", async()=>{
    arssh.changeConfig("port", 2022);
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
  it("should exec command after client alive event is occurred", async()=>{
    arssh.changeConfig("port", 2023);
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
  it("should exec command after tcp session timeout event is occurred", async()=>{
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
