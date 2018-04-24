const debug = require("debug")("arssh2:connection-manager");
const promiseRetry = require("promise-retry");
const ssh2Client = require("ssh2").Client;

const { overwriteDefaultValue } = require("./utils");

async function connect(ssh, config) {
  return new Promise((resolve, reject) => {
    const onReady = () => {
      debug("connection ready");
      resolve();
      cleanUp();
    };
    const onError = (err) => {
      debug("connection failed");
      reject(err);
      cleanUp();
    };
    const cleanUp = () => {
      ssh.removeListener("ready", onReady);
      ssh.removeListener("error", onError);
    };

    debug("try to connect to", config.host);
    ssh.on("ready", onReady);
    ssh.on("error", onError);
    ssh.connect(config);
  });
}

// fatal errors on ssh.connect
function parseError(e) {
  let isFatal = true;
  const privateKeyParseError = "Cannot parse privateKey";
  if (e.name === "InvalidAsn1Error") {
    e.message = "invalid passphrase";
    e.reason = "invalid passphrase";
  } else if (e.name.startsWith("RangeError")) {
    e.reason = "illegal port number";
  } else if (e.code === "ENOTFOUND") {
    e.reason = "name resolution failure";
  } else if (e.code === "ETIMEDOUT") {
    e.reason = "timeout occurred during connection process";
    isFatal = false;
  } else if (e.level === "client-authentication") {
    e.reason = "authentication failure";
  } else if (e.level === "client-timeout") {
    e.reason = "timeout occurred during connection process";
  } else if (e.message === "Invalid username") {
    e.reason = "invalid username";
  } else if (e.message === "privateKey value does not contain a (valid) private key") {
    e.reason = "invalid private key";
  } else if (e.message === "Encrypted private key detected, but no passphrase given") {
    e.reason = "invalid passphrase";
  } else if (e.message.startsWith(privateKeyParseError)) {
    e.reason = "invalid private key";
  } else {
    e.reason = "unknown";
    isFatal = false;
  }
  return isFatal;
}

class ConnectionManager {
  constructor(config, opt) {
    this.config = config;
    this.connections = [];
    this.connectionRetry = overwriteDefaultValue(opt.connectionRetry, 5);
    this.connectionRetryDelay = overwriteDefaultValue(opt.connectionRetryDelay, 1000);
    this.maxConnection = overwriteDefaultValue(opt.maxConnection, 4);
    this.listeners = {};
  }

  async getConnection() {
    // search unused connection
    let index = this.connections.findIndex((e) => {
      return e.count === 0;
    });
    if (index === -1) {
      // create new connection if number of existing conections less than max connection
      if (this.connections.length < this.maxConnection) {
        const ssh = new ssh2Client();
        for (let eventName in this.listeners) {
          this.listeners[eventName].forEach((listener) => {
            ssh.on(eventName, listener);
          });
        }
        index = this.connections.length;
        this.connections.push({ ssh: ssh, count: 0 });
      } else {
        // search connection which have least task
        let minCount = this.connections[0].count;
        index = 0;
        this.connections.forEach((e, i) => {
          if (minCount > e.count) {
            index = i;
            minCount = e.count;
          }
        });
      }
    }

    debug("returning ssh connection:", index);
    let ssh = this.connections[index].ssh;
    try {
      await connect(ssh, this.config); // 1st try
    } catch (e) {
      debug("connection failed due to", e);
      if (parseError(e)) {
        return Promise.reject(e);
      }
      try {
        await promiseRetry(connect.bind(null, ssh, this.config), {
          retries: this.connectionRetry,
          minTimeout: this.connectionRetryDelay
        });
      } catch (err) {
        parseError(err);
        return Promise.reject(err);
      }
    }
    return this.connections[index];
  }

  disconnectAll() {
    this.connections.forEach((conn) => {
      conn.ssh.end();
    });
    this.connections.splice(0, this.connections.length);
  }
}

/*
  isConnected() {
    const notConnected = "Not connected";
    const noResponse = "No response from server";
    const channelOpenError = "(SSH) Channel open failure";

    return new Promise((resolve, reject) => {
      this.sftp()
        .then(() => {
          resolve(true);
        })
        .catch((err) => {
          debug("isConnected() failed due to", err.message);
          if (err.message.trim() === noResponse) {
            resolve(false);
          } else if (err.message.trim() === notConnected) {
            resolve(false);
          } else if (err.message.trim() === waitContinue) {
            resolve(false);
          } else if (err.message.startsWith(channelOpenError)) {
            resolve(false);
          } else if (err.code === "ECONNRESET") {
            resolve(false);
          } else {
            reject(err);
          }
        });
    });
  }
  */

module.exports = ConnectionManager;
