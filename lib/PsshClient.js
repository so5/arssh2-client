const { EventEmitter } = require("events");
const debug = require("debug")("arssh2:pssh");
const ssh2Client = require("ssh2").Client;

const waitContinue = "You should wait continue event before sending any more traffic";

/**
 * promisified ssh2 client method bridge class
 *
 */
class PsshClient extends EventEmitter {
  /**
   * @param {Object} config - ssh2's config object
   */
  constructor(config) {
    super();
    this.config = config;
    this.conn = new ssh2Client();
    // define disconnect() as alias of end()
    this.disconnect = this.end;
  }

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

  /**
   * initiate session
   */
  connect() {
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
        this.conn.removeListener("ready", onReady);
        this.conn.removeListener("error", onError);
      };

      debug("try to connect to", this.config.host);
      this.conn.on("ready", onReady);
      this.conn.on("error", onError);
      this.conn.connect(this.config);
    });
  }

  /**
   * execute command on remote host
   * @param {string} cmd - cmdline which will be executed
   * @param {Object} opt - ssh2's exec option object
   */
  async exec(cmd, opt = {}, stdout = null, stderr = null) {
    return new Promise((resolve, reject) => {
      const rt = this.conn.exec(cmd, opt, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }
        stream.on("exit", (rt, signal) => {
          if (rt != null) {
            resolve(rt);
          } else if (signal != null) {
            reject(new Error(`remote process is interrupted by signal ${signal}`));
          } else {
            const err = new Error("unknown error occurred");
            err.cmd = cmd;
            err.opt = opt;
            err.rt = rt;
            err.signal = signal;
            reject(err);
          }
        });
        if (typeof stdout === "function") {
          stream.on("data", stdout);
        } else {
          stream.on("data", (data) => {
            this.emit("stdout", data);
            if (Array.isArray(stdout)) {
              if (stdout.length > 10) stdout.shift();
              stdout.push(data.toString());
            }
          });
        }
        if (typeof stderr === "function") {
          stream.stderr.on("data", stderr);
        } else {
          stream.stderr.on("data", (data) => {
            this.emit("stderr", data);
            if (Array.isArray(stderr)) {
              if (stderr.length > 10) stderr.shift();
              stderr.push(data.toString());
            }
          });
        }
      });
      if (!rt) reject(new Error(waitContinue));
    });
  }

  /**
   * start sftp session
   */
  async sftp() {
    return new Promise((resolve, reject) => {
      let rt = this.conn.sftp((err, sftp) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(sftp);
      });
      if (!rt) reject(new Error(waitContinue));
    });
  }

  /**
   * disconnect session
   */
  end() {
    this.conn.end();
  }
}

module.exports = PsshClient;
