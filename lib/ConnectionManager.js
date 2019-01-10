const debug = require("debug")("arssh2:connection-manager");
const debug_ssh = require("debug")("ssh2:");
const promiseRetry = require("promise-retry");
const ssh2Client = require("ssh2").Client;

const { waitContinue } = require("./utils");
const { canNotConnect } = require("./errorParser");

async function connect(conn, config) {
  return new Promise((resolve, reject)=>{
    const onReady = ()=>{
      debug(conn.index, ": connection ready");
      resolve();
      cleanUp();
    };

    const onError = (err)=>{
      debug(conn.index, ": connection failed");
      reject(err);
      cleanUp();
    };

    const cleanUp = ()=>{
      ssh.removeListener("ready", onReady);
      ssh.removeListener("error", onError);
    };

    const ssh = conn.ssh;
    debug(conn.index, ": try to connect to", config.hostname);
    ssh.on("ready", onReady);
    ssh.on("error", onError);
    ssh.connect(config);
  });
}

function getVacantIndex(map) {
  let index = 0;

  while (map.has(index)) {
    index++;
  }
  return index;
}

class ConnectionManager {
  constructor(config) {
    this.config = Object.assign({}, config);
    this.config.debug = debug_ssh;
    this.isValid = false;
    this.connections = new Map();
    //default settings these value will be overwrite in arssh's constructor
    this.connectionRetry = 5;
    this.connectionRetryDelay = 1000;
    this.maxConnection = 4;
  }

  getConnection() {
    let index = null;

    //create new connection if number of existing conections less than max connection
    if (this.connections.size < this.maxConnection) {
      const ssh = new ssh2Client();
      index = getVacantIndex(this.connections);
      this.connections.set(index, { ssh, count: 0, index });
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
    ++conn.count;
    return conn;
  }

  async connect(conn, forceReconnect = false) {
    if (conn.isConnected && this.isValid && !forceReconnect) {
      debug("no need to reconnect");
      return;
    }

    try {
      await connect(conn, this.config); //1st try
    } catch (e) {
      debug("connection failed due to", e);

      if (canNotConnect(e) || !this.isValid) {
        return Promise.reject(e);
      }
      await promiseRetry(connect.bind(null, conn, this.config), {
        retries: this.connectionRetry,
        minTimeout: this.connectionRetryDelay
      });
    } finally {
      if (!this.isValid) {
        this.isValid = true;
      }

      if (!conn.isConnected) {
        conn.isConnected = true;
      }

      if (!this.connectTime) {
        this.connectTime = Date.now();
      }
    }
  }

  async getSftp(conn) {
    return new Promise((resolve, reject)=>{
      const rt = conn.ssh.sftp((err, sftp)=>{
        if (err) {
          reject(err);
          return;
        }
        sftp.on("error", (err)=>{
          debug("error raised from stream", err);
          err.needRecconect = true;
          reject(err);
        });
        resolve(sftp);
      });

      if (!rt) {
        reject(new Error(waitContinue));
      }
    });
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
   * setter for arssh2's option and ssh2's config
   * @param {string} key - property name which will be changed
   * @param {string} value - new value
   */
  changeConfig(key, value) {
    this.config[key] = value;
    this.isValid = false;
    debug(key, "is changed");
  }


  /**
   * rewrite whole member of ssh2's config
   * @param {Object} config - config object which will be passed to ssh2.connect
   */
  replaceConfig(config) {
    this.config = Object.assign({}, config);
    this.config.debug = debug_ssh;
    this.isValid = false;
    debug("ssh library's configuration is completely replaced");
  }

  disconnect(conn) {
    if (conn.isConnected) {
      conn.ssh.end();
    }
    conn.isConnected = false;
    this.connections.delete(conn.index);
  }

  disconnectAll() {
    for (const conn of this.connections.values()) {
      if (conn.isConnected) {
        conn.ssh.end();
      }
      conn.isConnected = false;
    }
    this.connections.clear();
    this.connectTime = undefined;
  }
}

module.exports = ConnectionManager;
