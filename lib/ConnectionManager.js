const debug = require("debug")("arssh2:connection-manager");

const Pssh = require("./PsshClient");
const { overwriteDefaultValue, retry } = require("./utils");

class ConnectionManager {
  constructor(config, opt) {
    this.config = config;
    this.connections = [];
    this.connectionRetry = overwriteDefaultValue(opt.connectionRetry, 5);
    this.delay = overwriteDefaultValue(opt.connectionRetryDelay, 1000);
    this.maxConnection = overwriteDefaultValue(opt.maxConnection, 4);
    this.listeners = {};
  }

  // mimic some EventEmitter's method to pass listeners to ssh
  on(eventName, listener) {
    if (!Array.isArray(this.listeners[eventName])) {
      this.listeners[eventName] = [];
    }
    this.listeners[eventName].push(listener);
    this.connections.forEach(e => {
      e.ssh.on(eventName, listener);
    });
  }
  off(eventName, listener) {
    this.connections.forEach(e => {
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
    this.connections.forEach(e => {
      e.ssh.removeAllListeners(eventName);
    });
    this.listeners[eventName] = [];
  }

  async getConnection() {
    // search unused connection
    let index = this.connections.findIndex(e => {
      return e.count === 0;
    });

    if (index === -1) {
      // create new connection if number of existing conections less than max connection
      if (this.connections.length < this.maxConnection) {
        let ssh = new Pssh(this.config);
        for (let eventName in this.listeners) {
          this.listeners[eventName].forEach(listener => {
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

    const privateKeyParseError = "Cannot parse privateKey";
    const fatalErrorMessages = [
      "privateKey value does not contain a (valid) private key",
      "Invalid username",
      "Encrypted private key detected, but no passphrase given"
    ];
    const fatalErrorLevel = ["client-authentication", "client-timeout"];
    debug("returning ssh connection:", index);
    let ssh = this.connections[index].ssh;
    if (!await ssh.isConnected()) {
      try {
        await ssh.connect(this.config); // 1st try
      } catch (e) {
        let quickReturn = false;
        if (e.name === "InvalidAsn1Error") {
          e.message = "invalid passphrase";
          quickReturn = true;
        } else if (e.name === "RangeError") {
          quickReturn = true;
        } else if (e.code === "ENOTFOUND") {
          quickReturn = true;
        } else if (fatalErrorMessages.includes(e.message)) {
          quickReturn = true;
        } else if (fatalErrorLevel.includes(e.level)) {
          quickReturn = true;
        } else if (e.message.startsWith(privateKeyParseError)) {
          quickReturn = true;
        }
        if (quickReturn) return Promise.reject(e);
        debug("connection failed due to", e);
        try {
          await retry(
            ssh.connect.bind(ssh, this.config),
            this.connectionRetry,
            this.delay
          );
        } catch (e) {
          return Promise.reject(e);
        }
      }
    }
    return this.connections[index];
  }
  disconnectAll() {
    this.connections.forEach(conn => {
      conn.ssh.end();
    });
    this.connections.splice(0, this.connections.length);
  }
}

module.exports = ConnectionManager;
