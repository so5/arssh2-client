/**
 * Auto recovery ssh2 client wrapper library.
 */
"use strict";
const { EventEmitter } = require("events");
const { promisify } = require("util");
const debugLib = require("debug");
const debug = debugLib("arssh2:interface");
const debugVerbose = debugLib("arssh2:interface_verbose");
const SBS = require("simple-batch-system");
const glob = require("glob");

const SftpUtil = require("./SftpUtils");
const ConnectionManager = require("./ConnectionManager");

const { isDirLocal, isFileLocal, sleep } = require("./utils");
const { isFatal, canNotConnect } = require("./errorParser");
const { execJob, sftpJob, sftpStreamJob } = require("./jobs");

/**
 * Integer means integer number but it is defined as Object for now
 * workaround for eslint-plugin-jsdoc's no-undefined-types rule bug.
 * @typedef {Object} Integer
 */

/**
 * parse regexp option object
 * @param {Object} regexp - option object
 * @returns {[RegExp|null,RegExp|null]} - regexp object for stdout and stderr respectively
 */
function parseRegExpOpt(regexp) {
  let out = regexp instanceof RegExp ? regexp : null;
  let err = regexp instanceof RegExp ? regexp : null;

  if (Object.prototype.hasOwnProperty.call(regexp, "out") && regexp.out instanceof RegExp) {
    out = regexp.out;
  }
  if (Object.prototype.hasOwnProperty.call(regexp, "err") && regexp.err instanceof RegExp) {
    err = regexp.err;
  }
  return [out, err];
}

/**
 * Facade class.
 * @constructor
 * @param {Object} config - Ssh2's connection setting.
 * @param {Object} opt - Arssh2's own option object.
 * @param { Integer } opt.connectionRetry=5 - Max number of retry connection.
 * @param { Integer } opt.connectionRetryDelay=1000 - Delay between each connection try (msec).
 * @param { Integer } opt.maxConnection=4 - Max number of parallel connection.
 * @param { Integer } opt.renewInterval=0 - Connection renewal interval (msec).
 * @param { Integer } opt.renewDelay=0 - Reconnection delay when renewal event occurred (msec).
 * @param { Function } opt.debug - Debug output function. Please note, you also have to set DEBUG environment variable to get debug output.
 */
class ARsshClient extends EventEmitter {
  constructor(config, opt = {}) {
    super();

    if (typeof opt.debug === "function") {
      debugLib.log = opt.debug;
    }
    if (!Object.prototype.hasOwnProperty.call(config, "debug")) {
      config.debug = debugLib("arssh2:ssh2");
    }

    this._batch = new SBS({ maxRetry: 10, name: "Arssh2" });
    const checkRenewNecessity = this._checkRenewNecessity.bind(this);
    this._batch.on("done", (id, name)=>{
      debugVerbose(`${name} is done`);
      debugVerbose(`number of waiting command = ${this._batch.size()}`);
      checkRenewNecessity();
    });

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
   * Execute command on remote host.
   * @param {string} cmd - Cmdline which will be executed.
   * @param {Object} argOpt - Ssh2's exec option object.
   * @param {string[]|Function} stdout - Array to be stored stdout or call back function for stdout.
   * @param {string[]|Function} stderr - Array to be stored stderr or call back function for stderr.
   * @returns {Integer} - Return code of cmd.
   *
   * If stdout and stderr is array, last 5 line of stdout and stderr is stored in them.
   */
  async exec(cmd, argOpt = {}, stdout = null, stderr = null) {
    const opt = argOpt !== null ? argOpt : {};
    debug("exec called", cmd, opt, stdout, stderr);

    if (typeof cmd !== "string") {
      return Promise.reject(new Error("cmd must be string"));
    }
    return this._batch.qsubAndWait({
      exec: execJob.bind(this, this._cm, cmd, opt, stdout, stderr),
      name: "exec"
    });
  }

  /**
   * Execute command repeatedly until specified keyword is found in stdout and/or stderr.
   * @param {string} cmd - Cmdline which will be executed.
   * @param {Object|RegExp} regexp - End condition.
   * @param {RegExp} regexp.out - Regexp only for stdout.
   * @param {RegExp} regexp.err - Regexp only for stderr.
   * @param {number} retryDelay - Duration between each try (in msec).
   * @param {number} maxRetry - Max retry count.
   * @param {Object} argOpt - Ssh2's exec option object.
   * @param {string[]|Function} stdout - Array to be stored stdout or call back function for stdout.
   * @param {string[]|Function} stderr - Array to be stored stderr or call back function for stderr.
   * @returns {Integer} - Return code of cmd.
   *
   * If stdout and stderr is array, last 10 line of stdout and stderr is stored in them.
   */
  async watch(cmd, regexp, retryDelay = 30000000, maxRetry = null, argOpt = {}, stdout = null, stderr = null) {
    const opt = argOpt !== null ? argOpt : {};
    debug("wait called", cmd, regexp, retryDelay, maxRetry, opt);

    if (typeof cmd !== "string") {
      return Promise.reject(new Error("cmd must be string"));
    }
    const [regexpOut, regexpErr] = parseRegExpOpt(regexp);

    if (regexpOut === null && regexpErr === null) {
      const err = new Error("illegal regexp specified");
      err.regexp = regexp;
      err.regexpOut = regexpOut;
      err.regexpErr = regexpErr;
      err.cmd = cmd;
      err.retryDelay = retryDelay;
      err.maxRetry = maxRetry;
      err.stdout = stdout;
      err.stderr = stderr;
      return Promise.reject(err);
    }

    return this._batch.qsubAndWait({
      exec: async()=>{
        let matched = false;
        const stdoutChecker = (strOut)=>{
          if (!matched && regexpOut instanceof RegExp) {
            matched = regexpOut.test(strOut);
          }
          if (typeof stdout === "function") {
            stdout(strOut);
          }
        };
        const stderrChecker = (strErr)=>{
          if (!matched && regexpErr instanceof RegExp) {
            matched = regexpErr.test(strErr);
          }
          if (typeof stderr === "function") {
            stderr(strErr);
          }
        };

        const rt = await execJob(this._cm, cmd, opt, stdoutChecker, stderrChecker);

        if (!matched) {
          debug("output does not matched specified regexp, keep watching");
          const err = new Error("output string does not matched specified regexp");
          err.regexp = regexp;
          err.regexpOut = regexpOut;
          err.regexpErr = regexpErr;
          err.cmd = cmd;
          err.retryDelay = retryDelay;
          err.maxRetry = maxRetry;
          err.stdout = stdout;
          err.stderr = stderr;
          throw (err);
        }
        return rt;
      },
      name: "wait",
      maxRetry,
      retryDelay,
      retry: true
    });
  }

  async _send(src, dst, only, exclude, opt) {
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
    return this._batch.qsubAndWait({
      exec: sftpJob.bind(this, this._cm, func, src, dst, only, exclude, opt),
      name: "send"
    });
  }

  /**
   * Send file or directory and its child to server.
   * @param {string} src - File or directory name which to be send.
   * @param {string} dst - Destination path.
   * @param {string} only - Only matched file will be transferd.
   * @param {string} exclude - Matched file never transferd even it match only filter.
   * @param {Object} opt - Option object to ssh2's fastget.
   * @returns {Promise} - Resolved with undefined when file transfer is done.
   */
  async send(src, dst, only, exclude, opt = {}) {
    debug("send called", src, dst, only, exclude, opt);
    const srces = await promisify(glob)(src);
    if (srces.length === 0) {
      return Promise.reject(new Error("src must be existing file or directory"));
    }
    if (srces.length === 1) {
      return this._send(srces[0], dst, only, exclude, opt);
    }

    return Promise.all(
      srces.map((e)=>{
        return this._send(e, dst, only, exclude, opt);
      })
    );
  }

  /**
   * Get file or directory and its child from server.
   * @param {string} src - File or directory name which to be recieve.
   * @param {string} dst - Destination path.
   * @param {string} only - Only matched file will be transferd.
   * @param {string} exclude - Matched file never transferd even it match only filter.
   * @param {Object} opt - Option object to ssh2's fastget.
   * @returns {Promise} - Resolved with undefined when file transfer is done.
   */
  async recv(src, dst, only, exclude, opt = {}) {
    debug("recv called", src, dst, only, exclude, opt);

    //quick return if argument are illegal
    if (typeof src !== "string") {
      return Promise.reject(new Error("src must be string"));
    }
    return this._batch.qsubAndWait({
      exec: sftpJob.bind(this, this._cm, SftpUtil.get, src, dst, only, exclude, opt),
      name: "recv"
    });
  }

  /**
   * get readable stream
   * @param {string} src - file path which to be read
   * @param {Object} opt - Option object of ssh2's createReadStream.
   * @returns {Promise} - resolved with readable stream object
   */
  async createReadStream(src, opt) {
    debug("createReadStream called", src, opt);

    //quick return if argument are illegal
    if (typeof src !== "string") {
      return Promise.reject(new Error("src must be string"));
    }
    return this._batch.qsubAndWait({
      exec: async()=>{
        return sftpStreamJob(this._cm, SftpUtil.createReadStream, src, opt);
      },
      name: "createReadStream"
    });
  }


  /**
   * get writable stream
   * @param {string} dst - file path which to be write
   * @param {Object} opt - Option object of ssh2's createWriteStream.
   * @returns {Promise} - resolved with readable stream object
   */
  async createWriteStream(dst, opt) {
    debug("createWriteSteam called", dst, opt);

    //quick return if argument are illegal
    if (typeof dst !== "string") {
      return Promise.reject(new Error("dst must be string"));
    }
    return this._batch.qsubAndWait({
      exec: async()=>{
        return sftpStreamJob(this._cm, SftpUtil.createWriteStream, dst, opt);
      },
      name: "createWriteStream"
    });
  }

  /**
   * Recursively make directory on remote host (like mkdir -p).
   * @param {string} target - Target path.
   * @returns {Promise} - Resolved with undefined when file transfer is done.
   */
  async mkdir_p(target) { //eslint-disable-line camelcase
    debug("mkdir_p called", target);

    if (typeof target !== "string") {
      return Promise.reject(new Error("path must be string"));
    }
    return this._batch.qsubAndWait({
      exec: sftpJob.bind(this, this._cm, SftpUtil.mkdir_p, target),
      name: "mkdir_p"
    });
  }

  /**
   * Recursively remove file and directoies on remote host (like rm -rf).
   * @param {string} target - Target path.
   * @returns {Promise} - Resolved with undefined when file transfer is done.
   */
  async rm_rf(target) { //eslint-disable-line camelcase
    debug("rm_rf called", target);

    if (typeof target !== "string") {
      return Promise.reject(new Error("path must be string"));
    }
    return this._batch.qsubAndWait({
      exec: sftpJob.bind(this, this._cm, SftpUtil.rm_rf, target),
      name: "rm_rf"
    });
  }

  /**
   * Get absolute path on remote host.
   * @param {string} target - Target path.
   * @returns {string} - Absolute path of target on remote server.
   */
  async realpath(target) {
    debug("realpath called", target);

    if (typeof target !== "string") {
      return Promise.reject(new Error("path must be string"));
    }
    return this._batch.qsubAndWait({
      exec: sftpJob.bind(this, this._cm, SftpUtil.realpath, target),
      name: "realpath"
    });
  }

  /**
   * Remove single file.
   * @param {string} target - Target path.
   * @returns {Promise} - Fullfilled when rm is done on remote server.
   */
  async rm(target) {
    debug("rm called ", target);

    if (typeof target !== "string") {
      return Promise.reject(new Error("path must be string"));
    }
    return this._batch.qsubAndWait({
      exec: sftpJob.bind(this, this._cm, SftpUtil.rm, target),
      name: "rm"
    });
  }

  /**
   * List files and directories on remote host.
   * @param {string} target - Target path.
   * @returns {Promise[]} - Resolved with array of filenames.
   */
  async ls(target) {
    debug("ls called ", target);

    if (typeof target !== "string") {
      return Promise.reject(new Error("path must be string"));
    }
    return this._batch.qsubAndWait({
      exec: sftpJob.bind(this, this._cm, SftpUtil.ls, target),
      name: "ls"
    });
  }

  /**
   * Change file mode on remote host.
   * @param {string} target - Target path.
   * @param {string} mode - Desired file mode.
   * @returns {Promise} - Resolved with undefined when chmod is done.
   */
  async chmod(target, mode) {
    debug("chmod called ", target, mode);

    if (typeof target !== "string") {
      return Promise.reject(new Error("path must be string"));
    }
    return this._batch.qsubAndWait({
      exec: sftpJob.bind(this, this._cm, SftpUtil.chmod, target, mode),
      name: "chmod"
    });
  }

  /**
   * Change file owner on remote host.
   * @param {string} target - Target path.
   * @param {Integer} uid - Desired user id.
   * @param {Integer} gid - Desired group id.
   * @returns {Promise} - Resolved with undefined when chown is done.
   */
  async chown(target, uid, gid) {
    debug("chown called ", target, uid, gid);

    if (typeof target !== "string") {
      return Promise.reject(new Error("path must be string"));
    }
    return this._batch.qsubAndWait({
      exec: sftpJob.bind(this, this._cm, SftpUtil.chown, target, uid, gid),
      name: "chown"
    });
  }

  /**
   * get target files's size
   * @param {string} target - Target path.
   * @returns {Promise} - Resolved with file size in byte
   */
  async getSize(target) {
    debug("getSize called ", target);

    if (typeof target !== "string") {
      return Promise.reject(new Error("path must be string"));
    }
    return this._batch.qsubAndWait({
      exec: sftpJob.bind(this, this._cm, SftpUtil.getSize, target),
      name: "getSize"
    });
  }

  /**
   * Check if you can connect to specified server.
   * @returns {Promise} - Resolved with true on success, otherwise rejected with Error.
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
   * Disconnect all existing connections.
   */
  disconnect() {
    debug("disconnect all existing connection");
    this._cm.disconnectAll();
  }


  /**
   * Setter for arssh2's option and ssh2's config.
   * @param {string} key - Property name which will be changed.
   * @param {string} value - New value.
   */
  changeConfig(key, value) {
    debug("changing configuration", key);

    if (key === "connectionRetry") {
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
   * Rewrite whole member of ssh2's config.
   * @param {Object} config - Config object which will be passed to ssh2.connect.
   */
  overwriteConfig(config) {
    debug("replacing whole configuration");
    this._cm.replaceConfig(config);
  }

  //setter and getter
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
    debugVerbose("_checkRenewNecessity() called");

    if (this._cm.connectTime === null) {
      debugVerbose("_cm.connectTime is not set");
      return false;
    }

    if (this.renewInterval <= 0) {
      debugVerbose("renewInterval parameter is negative");
      return false;
    }

    if (Date.now() - this._cm.connectTime.getTime() < this.renewInterval) {
      debugVerbose("connect time is not exceeded");
      return false;
    }
    debugVerbose("connection renewal needed");
    this.emit("renewConnection");
    return true;
  }

  async _renewConnection() {
    debugVerbose("connection renewal process started");
    this._batch.stop();
    const ids = this._batch.getRunning();
    debugVerbose("waiting for running jobs:", ids);
    await this._batch.qwaitAll(ids, true);
    debugVerbose("batch stopped to connection renewal");
    await this._cm.disconnectAll();
    ++(this._numReconnect);
    this._batch.start();
    debugVerbose("batch restarted");

    if (this.renewDelay > 0) {
      await sleep(this.renewDelay);
    }
    this.once("renewConnection", this._renewConnection);
    debugVerbose("connection renewal done", this._numReconnect);
  }
}

module.exports = ARsshClient;
