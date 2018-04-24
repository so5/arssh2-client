/**
 * auto recovery ssh2 client wrapper library
 */
const { EventEmitter } = require("events");

const debug = require("debug")("arssh2:arssh2");
const debug_ssh = require("debug")("ssh2:");

const { sshExec } = require("./sshExec");
const SftpUtil = require("./SftpUtils");
const ConnectionManager = require("./ConnectionManager");
const { isDirLocal, isFileLocal } = require("./utils");
const { overwriteDefaultValue } = require("./utils");
const waitContinue = "You should wait continue event before sending any more traffic";

async function getSftp(ssh) {
  return new Promise((resolve, reject) => {
    const rt = ssh.sftp((err, sftp) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(sftp);
    });
    if (!rt) reject(new Error(waitContinue));
  });
}



class Executer extends EventEmitter {
  constructor(cm, opt) {
    super();
    this.cm = cm;
    this.delay = overwriteDefaultValue(opt.delay, 1000);
    this.maxConnection = overwriteDefaultValue(opt.maxConnection, 4);
    this.queue = [];
    this.numRunning = 0;
    this.once("go", this._executer);
  }
  enqueue(order) {
    debug("enqueue", order);
    this.queue.push(order);
    this.emit("go");
  }
  async _exec(ssh, order) {
    return sshExec(ssh, order.cmd, order.opt, order.stdout, order.stderr);
  }
  async _put(ssh, order) {
    const sftp = new SftpUtil(await getSftp(ssh));
    return sftp.put(order.src, order.dst, order.only, order.exclude);
  }
  async _rput(ssh, order) {
    const sftp = new SftpUtil(await getSftp(ssh));
    return sftp.put_R(order.src, order.dst, order.only, order.exclude);
  }

  async _get(ssh, order) {
    const sftp = new SftpUtil(await getSftp(ssh));
    const srcIsFile = await sftp.isFile(order.src);
    const srcIsDir = await sftp.isDir(order.src);
    if (!srcIsFile && !srcIsDir) {
      return Promise.reject(new Error("src must be existing file or directory"));
    } else if (srcIsDir) {
      return sftp.get_R(order.src, order.dst, order.only, order.exclude);
    }
    return sftp.get(order.src, order.dst, order.only, order.exclude);
  }

  async _chmod(ssh, order) {
    const sftp = new SftpUtil(await getSftp(ssh));
    return sftp.chmod(order.target, order.mode);
  }
  async _ls(ssh, order) {
    const sftp = new SftpUtil(await getSftp(ssh));
    return sftp.ls(order.target);
  }
  async _mkdir_p(ssh, order) {
    const sftp = new SftpUtil(await getSftp(ssh));
    return sftp.mkdir_p(order.target);
  }
  async _realpath(ssh, order) {
    const sftp = new SftpUtil(await getSftp(ssh));
    return sftp.realpath(order.target);
  }
  async _executer() {
    debug("_executer called");
    if (this.queue.length <= 0) {
      this.once("go", this._executer);
      return;
    }

    let order = this.queue.shift();
    let conn = await this.cm.getConnection();
    ++conn.count;

    ++this.numRunning;
    if (this.numRunning < this.maxConnection && this.queue.length > 0) {
      setImmediate(() => {
        this.emit("go");
      });
    }
    this.once("go", this._executer);

    await this._getCmd(order.type)(conn.ssh, order)
      .then((rt) => {
        debug(order.type, "cmd finished. rt=", rt);
        order.resolve(rt);
      })
      .catch((err) => {
        // error message is defined around line 1195 of ssh2/lib/client.js
        if (
          err.message.startsWith("(SSH) Channel open failure:") ||
          err.message === "You should wait continue event before sending any more traffic"
        ) {
          debug("channel open failure");
          this.queue.unshift(order);
          return;
        }
        debug(order.type, "cmd failed due to", err);
        order.reject(err);
      })
      .then(() => {
        --conn.count;
        --this.numRunning;
        if (conn.count < 0) conn.count = 0;
        if (this.queue.length > 0) {
          setImmediate(() => {
            this.emit("go");
          });
        }
      });
  }
  _getCmd(type) {
    if (type === "exec") {
      return this._exec;
    } else if (type === "put") {
      return this._put;
    } else if (type === "rput") {
      return this._rput;
    } else if (type === "get") {
      return this._get;
    } else if (type === "chmod") {
      return this._chmod;
    } else if (type === "ls") {
      return this._ls;
    } else if (type === "mkdir_p") {
      return this._mkdir_p;
    } else if (type === "realpath") {
      return this._realpath;
    }
  }
}

/**
 * arssh2 facade class
 */
class ARsshClient {
  /**
   * constructor
   * @param { object } [ config ] - ssh2's connection setting
   * @param { object } [ opt ] - arssh2's own option object
   * @param { string } [ opt.delay=1000 ] - delay between each cmd execution
   * @param { string } [ opt.connectionRetry=5] - max number of retry connection
   * @param { string } [ opt.connectionRetryDelay=1000] - delay between each connection try (msec)
   * @param { string } [ opt.maxConnection=4] - max number of parallel connection
   *
   * please note you can pass any other original ssh2's option by config object
   */
  constructor(config, opt = {}) {
    this.config = Object.assign({}, config);
    this.config.debug = debug_ssh;
    this.opt = Object.assign({}, opt);
    this.cm = new ConnectionManager(this.config, this.opt);
    this.executer = new Executer(this.cm, this.opt);
  }

  /**
   * execute command on remote host
   * @param {string} cmd - cmdline which will be executed
   * @param {object} [ opt={} ] - ssh2's exec option object
   * @param {[]} stdout - array which will have last 10 line of stdout on exit
   * @param {[]} stderr - array which will have last 10 line of stder on exit
   */
  exec(cmd, opt = {}, stdout = null, stderr = null) {
    if (typeof cmd !== "string") {
      return Promise.reject(new Error("cmd must be string"));
    }
    debug("exec", cmd);
    return new Promise((resolve, reject) => {
      this.executer.enqueue({
        type: "exec",
        cmd: cmd,
        opt: opt,
        stdout: stdout,
        stderr: stderr,
        resolve: resolve,
        reject: reject
      });
    });
  }

  /**
   * send file or directory and its child to server
   * @param {string} src - file or directory name which to be send
   * @param {string} dst - destination path
   * @param {string=null} only - only matched file will be transferd
   * @param {string=null} exclude - matched file never transferd even it match only filter
   */
  async send(src, dst, only = null, exclude = null) {
    //quick return if argument are illegal
    let srcIsFile = await isFileLocal(src);
    let srcIsDir = await isDirLocal(src);
    if (!srcIsFile && !srcIsDir) {
      return Promise.reject(new Error("src must be existing file or directory"));
    }
    if (typeof dst !== "string") {
      return Promise.reject(new Error("dst must be string"));
    }
    debug("send", src, "to", dst);

    return new Promise((resolve, reject) => {
      let type = srcIsFile ? "put" : "rput";
      this.executer.enqueue({
        type: type,
        src: src,
        dst: dst,
        only: only,
        exclude: exclude,
        resolve: resolve,
        reject: reject
      });
    });
  }

  /**
   * get file or directory and its child from server
   * @param {string} src - file or directory name which to be recieve
   * @param {string} dst - destination path
   * @param {string=null} only - only matched file will be transferd
   * @param {string=null} exclude - matched file never transferd even it match only filter
   */
  async recv(src, dst, only = null, exclude = null) {
    //quick return if argument are illegal
    if (await isFileLocal(dst)) {
      return Promise.reject(new Error("dst must not be existing file"));
    }
    if (typeof src !== "string") {
      return Promise.reject(new Error("src must be string"));
    }
    debug("recv", src, "to", dst);
    return new Promise((resolve, reject) => {
      this.executer.enqueue({
        type: "get",
        src: src,
        dst: dst,
        only: only,
        exclude: exclude,
        resolve: resolve,
        reject: reject
      });
    });
  }

  /**
   * change file mode on remote host
   * @param {string} target - target path
   * @param {string} mode   - desired file mode
   *
   */
  async chmod(target, mode) {
    if (typeof target !== "string") {
      return Promise.reject(new Error("path must be string"));
    }
    debug("chmod", target);
    return new Promise((resolve, reject) => {
      this.executer.enqueue({
        type: "chmod",
        target: target,
        mode: mode,
        resolve: resolve,
        reject: reject
      });
    });
  }

  /**
   * list files and directories on remote host
   * @param {string} target - target path
   */
  async ls(target) {
    if (typeof target !== "string") {
      return Promise.reject(new Error("path must be string"));
    }
    debug("ls", target);
    return new Promise((resolve, reject) => {
      this.executer.enqueue({
        type: "ls",
        target: target,
        resolve: resolve,
        reject: reject
      });
    });
  }

  /**
   * recursively make directory on remote host (like mkdir -p)
   * @param {string} target - target path
   */
  async mkdir_p(target) {
    if (typeof target !== "string") {
      return Promise.reject(new Error("path must be string"));
    }
    debug("mkdir_p", target);
    return new Promise((resolve, reject) => {
      this.executer.enqueue({
        type: "mkdir_p",
        target: target,
        resolve: resolve,
        reject: reject
      });
    });
  }

  /**
   * get absolute path on remote host
   * @param {string} target - target path
   */
  async realpath(target) {
    if (typeof target !== "string") {
      return Promise.reject(new Error("path must be string"));
    }
    debug("realpath", target);
    return new Promise((resolve, reject) => {
      this.executer.enqueue({
        type: "realpath",
        target: target,
        resolve: resolve,
        reject: reject
      });
    });
  }

  /**
   * setter for arssh2's option and ssh2's config
   * @param {string} property - property which will be changed
   * @param {string} value - new value
   */
  changeConfig(property, value) {
    if (this.config.hasOwnProperty(property)) {
      this.config[property] = value;
    }
    if (this.opt.hasOwnProperty(property)) {
      this.opt[property] = value;
    }
  }
  /**
   * rewrite whole member of ssh2's config
   * @param {Object} config - config object which will be passed to ssh2.connect
   */
  overwriteConfig(config) {
    Object.assign(this.config, config);
  }
  /**
   * check if you can connect to specified server
   */
  async canConnect() {
    await this.cm.getConnection();
    //If this.cm.getConnection() rejected,
    //async/await functionality will return Promise.reject().
    //so, we just ignore failed case.
    return Promise.resolve(true);
  }
  /**
   * disconnect all existing connections
   */
  disconnect() {
    return this.cm.disconnectAll();
  }
}

module.exports = ARsshClient;
