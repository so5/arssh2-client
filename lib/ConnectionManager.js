const debug = require("debug")("arssh2:connection-manager");
const debug_ssh = require("debug")("ssh2:");
const promiseRetry = require("promise-retry");
const ssh2Client = require("ssh2").Client;

const { waitContinue, normalizeOptionValue } = require("./utils");
const { canNotConnect } = require("./errorParser");

async function connect(conn, config) {
  return new Promise((resolve, reject) => {
    const onReady = () => {
      debug(conn.index, ": connection ready");
      resolve();
      cleanUp();
    };
    const onError = (err) => {
      debug(conn.index, ": connection failed");
      reject(err);
      cleanUp();
    };
    const cleanUp = () => {
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
  constructor(config, opt) {
    this.replaceConfig(config);
    this.isValid = false;
    this.connections = new Map();
    this.connectionRetry = normalizeOptionValue(opt.connectionRetry, 5);
    this.connectionRetryDelay = normalizeOptionValue(opt.connectionRetryDelay, 1000, 1000);
    this.maxConnection = normalizeOptionValue(opt.maxConnection, 4);
  }

  getConnection() {
    let index = null;
    // create new connection if number of existing conections less than max connection
    if (this.connections.size < this.maxConnection) {
      const ssh = new ssh2Client();
      index = getVacantIndex(this.connections);
      this.connections.set(index, { ssh: ssh, count: 0, index: index });
      debug("create new ssh connection", index, "(", this.connections.size, "/", this.maxConnection, ")");
    } else {
      // search connection which have least task
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
      await connect(conn, this.config); // 1st try
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
      if (!this.isValid) this.isValid = true;
      if (!conn.isConnected) conn.isConnected = true;
    }
  }
  async getSftp(conn) {
    return new Promise((resolve, reject) => {
      const rt = conn.ssh.sftp((err, sftp) => {
        if (err) {
          reject(err);
          return;
        }
        sftp.on("error", (err) => {
          debug("error raised from stream", err);
          reject(err);
        });
        resolve(sftp);
      });
      if (!rt) reject(new Error(waitContinue));
    });
  }

  /**
   * setter for arssh2's option and ssh2's config
   * @param {string} key - property name which will be changed
   * @param {string} value - new value
   */
  changeConfig(key, value) {
    if (key === "connectionRetry") {
      this.connectionRetry = value;
      debug("connection retry count is changed to", value);
    } else if (key === "connectionRetryDelay") {
      this.connectionRetryDelay = value;
      debug("connection retry delay is changed to", value);
    } else if (key === "maxConnection") {
      this.maxConnection = value;
      debug("max number of connection is changed to", value);
    } else {
      this.config[key] = value;
      this.isValid = false;
      debug(key, "is changed");
    }
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
    conn.ssh.end();
    conn.isConnected = false;
    this.connections.delete(conn.index);
  }

  disconnectAll() {
    for (const conn of this.connections.values()) {
      conn.ssh.end();
      conn.isConnected = false;
    }
    this.connections.clear();
  }
}

module.exports = ConnectionManager;
