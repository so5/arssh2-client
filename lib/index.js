/**
 * auto recovery ssh2 client wrapper library
 */
const { EventEmitter } = require("events");
const debugLib = require("debug");
const debug = debugLib("arssh2:arssh2");
const SBS = require("simple-batch-system");

const { sshExec } = require("./sshExec");
const SftpUtil = require("./SftpUtils");
const ConnectionManager = require("./ConnectionManager");

const { isDirLocal, isFileLocal, sleep } = require("./utils");
const { needReconnect, mustWaitBeforeRetry, isFatal, canNotConnect } = require("./errorParser");

const delayTimeForChannelBusy = 3000;

async function execJob(cm, ...args) {
  debug("start exec", ...args);
  let rt;
  const conn = cm.getConnection();
  await cm.connect(conn);

  try {
    rt = await sshExec(conn, ...args);
  } catch (e) {
    debug("exec failed with", e);

    if (needReconnect(e)) {
      cm.disconnect(conn);
    }

    if (mustWaitBeforeRetry(e)) {
      await sleep(delayTimeForChannelBusy);
    }
    throw e;
  } finally {
    conn.done();
    debug("exec done");
  }
  return rt;
}

async function sftpJob(cm, func, ...args) {
  debug("start", func.name, ...args);
  let rt;
  const conn = cm.getConnection();
  await cm.connect(conn);
  debug("open sftp session");
  const sftp = await cm.getSftp(conn);

  try {
    debug("exec sftp command");
    rt = await func(sftp, ...args);
  } catch (e) {
    debug("sftp command failed with", e);

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
    conn.done();
    debug(func.name, "done");
  }
  return rt;
}

/**
 * arssh2 facade class
 */
class ARsshClient extends EventEmitter {

  /**
   * constructor
   * @param { object } [ config ] - ssh2's connection setting
   * @param { object } [ opt ] - arssh2's own option object
   * @param { integer } [ opt.connectionRetry=5 ] - max number of retry connection
   * @param { integer } [ opt.connectionRetryDelay=1000 ] - delay between each connection try (msec)
   * @param { integer } [ opt.maxConnection=4 ] - max number of parallel connection
   * @param { integer } [ opt.renewInterval=0 ] - connection renewal interval (msec)
   * @param { integer } [ opt.renewDelay=0 ] - reconnection delay when renewal event occurred (msec)
   * @param { function } [opt.debug] -  debug output function
   *
   * please note you can pass any other original ssh2's option by config object
   */
  constructor(config, opt = {}) {
    super();
    if(typeof opt.debug === 'function'){
      if (!debug.enabled) {
      const namespace = debugLib.disable();
      debugLib.enable(`arssh2:*,${namespace}`);
    }
    }
    this._batch = new SBS({ maxRetry: 10, name: "Arssh2" });

    this._batch.retry = (err)=>{
      if (canNotConnect(err)) {
        debug("connection failure", err);
        return false;
      }

      if (isFatal(err)) {
        debug("fatal error occurred", err);
        return false;
      }
      debug("retring due to", err.message);
      return true;
    };
    this._cm = new ConnectionManager(config);


    //option parameters to keep itself
    this.verbose = opt.verbose || false;
    this.renewInterval = opt.renewInterval || 0;
    this.renewDelay = opt.renewDelay || 0;

    //option parameters pass to connection manager and/or SBS via setter
    this.maxConnection = opt.maxConnection || 4;
    this.connectionRetry = opt.connectionRetry || 5;
    this.connectionRetryDelay = opt.connectionRetryDelay || 1000;

    //statistical information
    this._numReconnect = 0;
  }

  /**
   * execute command on remote host
   * @param {string} cmd - cmdline which will be executed
   * @param {object} [ opt={} ] - ssh2's exec option object
   * @param {[]|Function} stdout
   * @param {[]|Function} stderr
   *
   * if stdout and stderr is array, last 10 line of stdout and stderr is stored in them.
   * if it is function, it will be used as call back on recieve stdout and stderr output
   */
  async exec(cmd, opt = {}, stdout = null, stderr = null) {
    debug("exec called", cmd, opt, stdout, stderr);

    if (typeof cmd !== "string") {
      return Promise.reject(new Error("cmd must be string"));
    }
    this._prologue();
    return this._batch.qsubAndWait({
      exec: async()=>{
        this._prologue();
        const rt = await execJob(this._cm, cmd, opt, stdout, stderr);
        return rt;
      },
      name: "exec"
    });
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
    this._prologue();
    return this._batch.qsubAndWait({
      exec: async()=>{
        this._prologue();
        const rt = await sftpJob(this._cm, func, src, dst, only, exclude, opt);
        return rt;
      },
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
    this._prologue();
    return this._batch.qsubAndWait({
      exec: async()=>{
        this._prologue();
        const rt = await sftpJob(this._cm, SftpUtil.get, src, dst, only, exclude, opt);
        return rt;
      },
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
    this._prologue();
    return this._batch.qsubAndWait({
      exec: async()=>{
        this._prologue();
        const rt = await sftpJob(this._cm, SftpUtil.mkdir_p, target);
        return rt;
      },
      name: "mkdir_p"
    });
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
    this._prologue();
    return this._batch.qsubAndWait({
      exec: async()=>{
        this._prologue();
        const rt = await sftpJob(this._cm, SftpUtil.rm_rf, target);
        return rt;
      },
      name: "rm_rf"
    });
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
    this._prologue();
    return this._batch.qsubAndWait({
      exec: async()=>{
        this._prologue();
        const rt = await sftpJob(this._cm, SftpUtil.realpath, target);
        return rt;
      },
      name: "realpath"
    });
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
    this._prologue();
    return this._batch.qsubAndWait({
      exec: async()=>{
        this._prologue();
        const rt = await sftpJob(this._cm, SftpUtil.ls, target);
        return rt;
      },
      name: "ls"
    });
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
    this._prologue();
    return this._batch.qsubAndWait({
      exec: async()=>{
        this._prologue();
        const rt = await sftpJob(this._cm, SftpUtil.chmod, target, mode);
        return rt;
      },
      name: "chmod"
    });
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
    this._prologue();
    return this._batch.qsubAndWait({
      exec: async()=>{
        this._prologue();
        const rt = await sftpJob(this._cm, SftpUtil.chown, target, uid, gid);
        return rt;
      },
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
    } else if (key === "connectionRetry") {
      this.connectionRetry = value;
    } else if (key === "connectionRetryDelay") {
      this.connectionRetryDelay = value;
    } else if (key === "maxConnection") {
      this.maxConnection = value;
    } else if (key === "renewInterval") {
      this.renewInterval = value;
    } else if (key === "renewDelay") {
      this.renewDelay = value;
    } else {
      this._cm.changeConfig(key, value);
    }
  }


  /**
   * rewrite whole member of ssh2's config
   * @param {Object} config - config object which will be passed to ssh2.connect
   */
  overwriteConfig(config) {
    debug("replacing whole configuration");
    this._cm.replaceConfig(config);
  }


  /**
   * check if you can connect to specified server
   */
  async canConnect() {
    debug("checking connectivity");
    const conn = this._cm.getConnection();
    await this._cm.connect(conn);
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
    return this._cm.disconnectAll();
  }

  //setter and getter
  set verbose(value) {
    if (value) {
      this._verbose = true;
    }
    debug("verbose option is set:", this.verbose);
  }

  get verbose() {
    return this._verbose;
  }

  set renewInterval(value) {
    if (typeof value !== "number") {
      debug("renewInterval must be number", value);
      return;
    }

    if (value < 0) {
      debug("negative renewInterval is recognized as 0");
    }
    this._renewInterval = value >= 0 ? Math.floor(value) : 0;
    debug("connection renewal interval is set:", this.renewInterval);

    if (this.renewInterval > 0) {
      this.once("renewConnection", this._renewConnection);
    } else {
      this.removeListener("renewConnection", this._renewConnection);
    }
  }

  get renewInterval() {
    return this._renewInterval;
  }

  set renewDelay(value) {
    if (typeof value !== "number") {
      debug("renewDelay must be number", value);
      return;
    }

    if (value < 0) {
      debug("negative renewDelay is recognized as 0");
    }
    this._renewDelay = value >= 0 ? Math.floor(value) : 0;
    debug("connection renewal delay is set:", this.renewDelay);
  }

  get renewDelay() {
    return this._renewDelay;
  }

  //following property is read only
  get numReconnect() {
    return this._numReconnect;
  }

  set maxConnection(value) {
    this._batch.maxConcurrent = value;
    this._cm.maxConnection = value;
  }

  get maxConnection() {
    return this._cm.maxConnection;
  }

  set connectionRetry(value) {
    this._cm.connectionRetry = value;
  }

  get connectionRetry() {
    return this._cm.connectionRetry;
  }

  set connectionRetryDelay(value) {
    this._cm.connectionRetryDelay = value;
  }

  get connectionRetryDelay() {
    return this._cm.connectionRetryDelay;
  }

  //private functions (but can be called from outside...)
  _checkRenewNecessity() {
    if (typeof this._cm.connectTime !== "number") {
      return false;
    }

    if (this.renewInterval <= 0) {
      return false;
    }

    if (Date.now() - this._cm.connectTime < this.renewInterval) {
      return false;
    }
    this.emit("renewConnection");
    return true;
  }

  async _reconnect() {
    debug("actual reconnection process start");
    this.disconnect();

    if (this.renewDelay > 0) {
      await sleep(this.renewDelay);
    }
    ++this._numReconnect;
  }

  async _renewConnection() {
    debug("connection renewal process started");
    this._batch.stop();
    const ids = this._batch.getRunning();
    debug("waiting for running jobs:", ids);
    await this._batch.qwaitAll(ids, true);
    debug("batch stopped");
    const maxConcurrent = this._batch.maxConcurrent;
    this._batch.maxConcurrent = 1;

    try {
      const id = this._batch.qsub(
        {
          exec: this._reconnect.bind(this),
          retry: false,
          name: "connection renewal"
        },
        true
      );
      this._batch.start();
      debug("batch restarted");
      await this._batch.qwait(id);
      debug("connection renewal job done");
    } catch (e) {
      debug("connection renewal failed but ignored", e);
    } finally {
      this._batch.maxConcurrent = maxConcurrent;
      this.once("renewConnection", this._renewConnection);
      debug("connection renewal done");
    }
  }

  _prologue() {
    if (this.verbose) {
      debug("number of waiting command =", this._batch.size());
    }
    this._checkRenewNecessity();
  }
}

module.exports = ARsshClient;
