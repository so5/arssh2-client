/**
 * auto recovery ssh2 client wrapper library
 */
const debug = require("debug")("arssh2:arssh2");
const SBS = require("simple-batch-system");

const { sshExec } = require("./sshExec");
const SftpUtil = require("./SftpUtils");
const ConnectionManager = require("./ConnectionManager");

const { isDirLocal, isFileLocal, normalizeOptionValue, sleep } = require("./utils");
const { needReconnect, mustWaitBeforeRetry, isFatal, canNotConnect } = require("./errorParser");

const delayTimeForChannelBusy = 3000;

function decreaseCount(conn) {
  --conn.count;
  if (conn.count < 0) conn.count = 0;
}

async function execJob(cm, ...args) {
  debug("start exec", ...args);
  let rt;
  const conn = cm.getConnection();
  await this.cm.connect(conn);
  try {
    rt = await sshExec(conn.ssh, ...args);
  } catch (e) {
    if (needReconnect(e)) {
      cm.disconnect(conn);
    }
    if (mustWaitBeforeRetry(e)) {
      await sleep(delayTimeForChannelBusy);
    }
    throw e;
  } finally {
    decreaseCount(conn);
    debug("exec done");
  }
  return rt;
}

async function sftpJob(cm, func, ...args) {
  debug("start", func.name, ...args);
  let rt;
  const conn = cm.getConnection();
  await this.cm.connect(conn);
  const sftp = await cm.getSftp(conn);
  try {
    debug("open sftp");
    rt = await func(sftp, ...args);
  } catch (e) {
    if (needReconnect(e)) {
      cm.disconnect(conn);
    }
    if (mustWaitBeforeRetry(e)) {
      await sleep(delayTimeForChannelBusy);
    }
    throw e;
  } finally {
    debug("close sftp");
    sftp.end();
    decreaseCount(conn);
    debug(func.name, "done");
  }
  return rt;
}

/**
 * arssh2 facade class
 */
class ARsshClient {
  /**
   * constructor
   * @param { object } [ config ] - ssh2's connection setting
   * @param { object } [ opt ] - arssh2's own option object
   * @param { integer } [ opt.connectionRetry=5] - max number of retry connection
   * @param { integer } [ opt.connectionRetryDelay=1000] - delay between each connection try (msec)
   * @param { integer } [ opt.maxConnection=4] - max number of parallel connection
   *
   * please note you can pass any other original ssh2's option by config object
   */
  constructor(config, opt = {}) {
    if (opt.verbose) this.verbose = true;
    this.cm = new ConnectionManager(config, opt);
    const numConcurrent = normalizeOptionValue(opt.maxConnection, 4);
    this.batch = new SBS({ maxConcurrent: numConcurrent, maxRetry: 10, name: "Arssh2" });
    this.batch.retry = (err) => {
      if (canNotConnect(err)) return false;
      if (isFatal(err)) {
        return false;
      }
      debug("retring due to", err.message);
      return true;
    };
  }

  /**
   * execute command on remote host
   * @param {string} cmd - cmdline which will be executed
   * @param {object} [ opt={} ] - ssh2's exec option object
   * @param {[]} stdout - array which will have last 10 line of stdout on exit
   * @param {[]} stderr - array which will have last 10 line of stder on exit
   */
  async exec(cmd, opt = {}, stdout = null, stderr = null) {
    debug("exec called", cmd, opt, stdout, stderr);
    if (typeof cmd !== "string") {
      return Promise.reject(new Error("cmd must be string"));
    }
    if (this.verbose) debug("number of waiting command =", this.batch.size());
    return this.batch.qsubAndWait({ exec: execJob.bind(this, this.cm, cmd, opt, stdout, stderr), name: "exec" });
  }

  /**
   * send file or directory and its child to server
   * @param {string} src - file or directory name which to be send
   * @param {string} dst - destination path
   * @param {string} only - only matched file will be transferd
   * @param {string} exclude - matched file never transferd even it match only filter
   */
  async send(src, dst, only, exclude, opt = {}) {
    debug("send called", src, dst, only, exclude, opt);
    //quick return if argument are illegal
    const srcIsFile = await isFileLocal(src);
    const srcIsDir = await isDirLocal(src);
    if (!srcIsFile && !srcIsDir) {
      return Promise.reject(new Error("src must be existing file or directory"));
    }
    if (typeof dst !== "string") {
      return Promise.reject(new Error("dst must be string"));
    }
    const func = srcIsFile ? SftpUtil.put : SftpUtil.rput;
    if (this.verbose) debug("number of waiting command =", this.batch.size());
    return this.batch.qsubAndWait({
      exec: sftpJob.bind(this, this.cm, func, src, dst, only, exclude, opt),
      name: "send"
    });
  }

  /**
   * get file or directory and its child from server
   * @param {string} src - file or directory name which to be recieve
   * @param {string} dst - destination path
   * @param {string} only - only matched file will be transferd
   * @param {string} exclude - matched file never transferd even it match only filter
   */
  async recv(src, dst, only, exclude, opt = {}) {
    debug("recv called", src, dst, only, exclude, opt);
    //quick return if argument are illegal
    if (typeof src !== "string") {
      return Promise.reject(new Error("src must be string"));
    }
    if (this.verbose) debug("number of waiting command =", this.batch.size());
    return this.batch.qsubAndWait({
      exec: sftpJob.bind(this, this.cm, SftpUtil.get, src, dst, only, exclude, opt),
      name: "recv"
    });
  }

  /**
   * recursively make directory on remote host (like mkdir -p)
   * @param {string} target - target path
   */
  async mkdir_p(target) {
    debug("mkdir_p called", target);
    if (typeof target !== "string") {
      return Promise.reject(new Error("path must be string"));
    }
    if (this.verbose) debug("number of waiting command =", this.batch.size());
    return this.batch.qsubAndWait({ exec: sftpJob.bind(this, this.cm, SftpUtil.mkdir_p, target), name: "mkdir_p" });
  }
  /**
   * recursively remove file and directoies on remote host (like rm -rf)
   * @param {string} target - target path
   */
  async rm_rf(target) {
    debug("rm_rf called", target);
    if (typeof target !== "string") {
      return Promise.reject(new Error("path must be string"));
    }
    if (this.verbose) debug("number of waiting command =", this.batch.size());
    return this.batch.qsubAndWait({ exec: sftpJob.bind(this, this.cm, SftpUtil.rm_rf, target), name: "rm_rf" });
  }

  /**
   * get absolute path on remote host
   * @param {string} target - target path
   */
  async realpath(target) {
    debug("realpath called", target);
    if (typeof target !== "string") {
      return Promise.reject(new Error("path must be string"));
    }
    if (this.verbose) debug("number of waiting command =", this.batch.size());
    return this.batch.qsubAndWait({ exec: sftpJob.bind(this, this.cm, SftpUtil.realpath, target), name: "realpath" });
  }

  /**
   * list files and directories on remote host
   * @param {string} target - target path
   */
  async ls(target) {
    debug("ls called ", target);
    if (typeof target !== "string") {
      return Promise.reject(new Error("path must be string"));
    }
    if (this.verbose) debug("number of waiting command =", this.batch.size());
    return this.batch.qsubAndWait({ exec: sftpJob.bind(this, this.cm, SftpUtil.ls, target), name: "ls" });
  }

  /**
   * change file mode on remote host
   * @param {string} target - target path
   * @param {string} mode   - desired file mode
   *
   */
  async chmod(target, mode) {
    debug("chmod called ", target, mode);
    if (typeof target !== "string") {
      return Promise.reject(new Error("path must be string"));
    }
    if (this.verbose) debug("number of waiting command =", this.batch.size());
    return this.batch.qsubAndWait({ exec: sftpJob.bind(this, this.cm, SftpUtil.chmod, target, mode), name: "chmod" });
  }
  /**
   * change file owner on remote host
   * @param {string} target - target path
   * @param {integer} uid - desired user id
   * @param {integer} gid - desired group id
   */
  async chown(target, uid, gid) {
    debug("chown called ", target, uid, gid);
    if (typeof target !== "string") {
      return Promise.reject(new Error("path must be string"));
    }
    if (this.verbose) debug("number of waiting command =", this.batch.size());
    return this.batch.qsubAndWait({
      exec: sftpJob.bind(this, this.cm, SftpUtil.chown, target, uid, gid),
      name: "chown"
    });
  }

  /**
   * setter for arssh2's option and ssh2's config
   * @param {string} key - property name which will be changed
   * @param {string} value - new value
   */
  changeConfig(key, value) {
    debug("changing configuration", key);
    if (key === "verbose") {
      this.verbose = value;
      return;
    }
    this.cm.changeConfig(key, value);
  }
  /**
   * rewrite whole member of ssh2's config
   * @param {Object} config - config object which will be passed to ssh2.connect
   */
  overwriteConfig(config) {
    debug("replacing whole configuration");
    this.cm.replaceConfig(config);
  }
  /**
   * check if you can connect to specified server
   */
  async canConnect() {
    debug("checking connectivity");
    const conn = this.cm.getConnection();
    await this.cm.connect(conn);
    //If connect() rejected,
    //async/await functionality will return Promise.reject().
    //so, we do nothing on failed case
    --conn.count;
    return Promise.resolve(true);
  }
  /**
   * disconnect all existing connections
   */
  disconnect() {
    debug("disconnect all existing connection");
    return this.cm.disconnectAll();
  }
}

module.exports = ARsshClient;
