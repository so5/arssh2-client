"use strict";
const debug = require("debug")("arssh2:connection-manager");
const promiseRetry = require("promise-retry");
const Ssh2Client = require("ssh2").Client;
const { canNotConnect } = require("./errorParser");

//wrapper class for ssh2Client
class Connection {
  constructor(ssh, index) {
    this.ssh = ssh;
    this.count = 0;
    this.index = index;
    this.isConnected = false;
  }

  done() {
    this.count = this.count > 0 ? --this.count : 0;
  }

  increaseCount() {
    ++this.count;
  }

  disconnect() {
    if (this.isConnected) {
      this.ssh.end();
    }
    this.isConnected = false;
  }

  async connect(config) {
    return new Promise((resolve, reject)=>{
      const ssh = this.ssh;
      const cleanUp = ()=>{
        ssh.removeListener("ready", onReady); //eslint-disable-line no-use-before-define
        ssh.removeListener("error", onError); //eslint-disable-line no-use-before-define
      };

      const onReady = ()=>{
        debug(this.index, ": connection ready");
        resolve();
        cleanUp();
      };

      const onError = (err)=>{
        debug(this.index, ": connection failed");
        reject(err);
        cleanUp();
      };

      debug(this.index, `: try to connect to ${config.host}:${config.port}`);
      ssh.on("ready", onReady);
      ssh.on("error", onError);
      ssh.connect(config);
    });
  }
}

class ConnectionManager {
  constructor(config) {
    this.config = Object.assign({}, config);
    this.isValid = false;
    this.connections = new Map();

    //default settings these value will be overwrite in arssh's constructor
    this.connectionRetry = 5;
    this.connectionRetryDelay = 1000;
    this.maxConnection = 4;
    this.connectTime = null;
  }

  getVacantIndex() {
    let index = 0;

    while (this.connections.has(index)) {
      index++;
    }
    return index;
  }

  getConnection() {
    let index = null;

    //create new connection if number of existing conections less than max connection
    if (this.connections.size < this.maxConnection) {
      const ssh = new Ssh2Client();
      index = this.getVacantIndex(this.connections);
      this.connections.set(index, new Connection(ssh, index));
      debug("create new ssh connection", index, "(", this.connections.size, "/", this.maxConnection, ")");
    } else {
      //search connection which have least task
      let minCount = Number.MAX_VALUE;

      for (const [k, v] of this.connections) {
        if (minCount > v.count) {
          index = k;
          minCount = v.count;
        }
      }
      debug("reuse connection (index:", index, "count:", minCount, ")");
    }
    const conn = this.connections.get(index);
    conn.increaseCount();
    return conn;
  }

  async connect(conn, forceReconnect = false) {
    if (conn.isConnected && this.isValid && !forceReconnect) {
      debug("no need to reconnect");
      return;
    }

    await promiseRetry((retry)=>{
      return conn.connect(this.config)
        .catch((err)=>{
          debug("connection failed due to", err);

          if (!canNotConnect(err)) {
            retry(err);
          }
          throw err;
        });
    }, {
      retries: this.connectionRetry,
      minTimeout: this.connectionRetryDelay
    });

    this.isValid = true;
    conn.isConnected = true;

    if (this.connectTime === null) {
      this.connectTime = new Date();
      debug("ssh session created at ", this.connectTime.toLocaleString());
    }
  }

  set connectionRetry(value) {
    if (typeof value !== "number") {
      debug("connection retry must be number", value);
      return;
    }

    if (value < 0) {
      debug("negative connection retry is recognized as 0");
    }
    this._connectionRetry = value >= 0 ? Math.floor(value) : 0;
    debug("connection retry count is set:", this.connectionRetry);
  }

  get connectionRetry() {
    return this._connectionRetry;
  }

  set connectionRetryDelay(value) {
    if (typeof value !== "number") {
      debug("connection retry delay must be number", value);
      return;
    }

    if (value < 1000) {
      debug("specified retry delay is too small. we will use 1000");
    }
    this._connectionRetryDelay = value >= 1000 ? Math.floor(value) : 1000;
    debug("connection retry delay is set:", this.connectionRetryDelay);
  }

  get connectionRetryDelay() {
    return this._connectionRetryDelay;
  }

  set maxConnection(value) {
    if (typeof value !== "number") {
      debug("maxConnection must be number", value);
      return;
    }

    if (value < 0) {
      debug("negative connection retry is recognized as 0");
    }
    this._maxConnection = value >= 0 ? Math.floor(value) : 0;
    debug("max number of connection is set:", this.maxConnection);
  }

  get maxConnection() {
    return this._maxConnection;
  }

  /**
   * Setter for arssh2's option and ssh2's config.
   * @param {string} key - Property name which will be changed.
   * @param {string} value - New value.
   */
  changeConfig(key, value) {
    this.config[key] = value;
    this.isValid = false;
    debug(key, "is changed");
  }


  /**
   * Rewrite whole member of ssh2's config.
   * @param {Object} config - Config object which will be passed to ssh2.connect.
   */
  replaceConfig(config) {
    this.config = Object.assign({}, config);
    this.isValid = false;
    debug("ssh library's configuration is completely replaced");
  }

  disconnect(conn) {
    conn.disconnect();
    this.connections.delete(conn.index);
  }

  disconnectAll() {
    for (const conn of this.connections.values()) {
      conn.disconnect();
    }
    this.connections.clear();
    this.connectTime = null;
  }
}

module.exports = ConnectionManager;
