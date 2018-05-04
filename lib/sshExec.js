const debug = require("debug")("arssh2:sshExec");
const waitContinue = "You should wait continue event before sending any more traffic";

/**
 * execute command on remote host
 * @param {string} cmd - cmdline which will be executed
 * @param {Object} opt - ssh2's exec option object
 */
async function sshExec(ssh, cmd, opt = {}, stdout = null, stderr = null) {
  return new Promise((resolve, reject) => {
    debug(`exec ${cmd} on remote server`);
    const rt2 = ssh.exec(cmd, opt, (err, stream) => {
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

      // stdout handler
      if (typeof stdout === "function") {
        stream.on("data", stdout);
      }
      if (Array.isArray(stdout)) {
        stream.on("data", (data) => {
          if (stdout.length > 5) stdout.shift();
          stdout.push(data.toString());
        });
      }

      // stderr handler
      if (typeof stderr === "function") {
        stream.stderr.on("data", stderr);
      }
      if (Array.isArray(stderr)) {
        stream.stderr.on("data", (data) => {
          if (stderr.length > 5) stderr.shift();
          stderr.push(data.toString());
        });
      }
    });
    if (!rt2) reject(new Error(waitContinue));
  });
}

module.exports.sshExec = sshExec;
