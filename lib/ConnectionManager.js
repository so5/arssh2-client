const debug = require("debug")("arssh2:connection-manager");
const promiseRetry = require("promise-retry");

const Pssh = require("./PsshClient");
const { overwriteDefaultValue } = require("./utils");

function parseError(e) {
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
  }
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

  // mimic some EventEmitter's method to pass listeners to ssh
  on(eventName, listener) {
    if (!Array.isArray(this.listeners[eventName])) {
      this.listeners[eventName] = [];
    }
    this.listeners[eventName].push(listener);
    this.connections.forEach((e) => {
      e.ssh.on(eventName, listener);
    });
  }
  off(eventName, listener) {
    this.connections.forEach((e) => {
      e.ssh.removeListener(eventName, listener);
    });
    let index = this.listeners[eventName].indexOf(listener);
    if (index !== -1) {
      this.listeners[eventName].splice(index, 1);
    }
  }
  // Unlike EventEmitter.once(), listener will call with global 'this' object.
  once(eventName, listener) {
    let func = () => {
      listener.apply(null, arguments);
      this.off(eventName, func);
    };
    this.on(eventName, func);
  }
  removeAllListeners(eventName) {
    this.connections.forEach((e) => {
      e.ssh.removeAllListeners(eventName);
    });
    this.listeners[eventName] = [];
  }

  async getConnection() {
    // search unused connection
    let index = this.connections.findIndex((e) => {
      return e.count === 0;
    });

    if (index === -1) {
      // create new connection if number of existing conections less than max connection
      if (this.connections.length < this.maxConnection) {
        let ssh = new Pssh(this.config);
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
    if (!await ssh.isConnected()) {
      try {
        await ssh.connect(this.config); // 1st try
      } catch (e) {
        parseError(e);
        if (e.reason !== "timeout occurred during connection process" && e.reason !== "unknown")
          return Promise.reject(e);
        debug("connection failed due to", e);
        try {
          await promiseRetry(ssh.connect.bind(ssh, this.config), {
            retries: this.connectionRetry,
            minTimeout: this.connectionRetryDelay
          });
        } catch (err) {
          parseError(err);
          return Promise.reject(err);
        }
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

module.exports = ConnectionManager;
