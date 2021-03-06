"use strict";
const debug = require("debug")("arssh2:sshExec");
const waitContinue = "You should wait continue event before sending any more traffic";

/**
 * Execute command on remote host.
 * @param {Object} conn - Connection object from ConnectionManager.
 * @param {string} cmd - Cmdline which will be executed.
 * @param {Object} opt - Ssh2's exec option object.
 * @param { Function|Array} stdout - Callback routine or array to store stdout.
 * @param { Function|Array} stderr - Callback routine or array to store stderr.
 */
async function sshExec(conn, cmd, opt = {}, stdout = null, stderr = null) {
  return new Promise((resolve, reject)=>{
    debug("exec", cmd, "on remote server");
    const ssh = conn.ssh;
    const rt2 = ssh.exec(cmd, opt, (err, stream)=>{
      if (err) {
        reject(err);
        return;
      }
      const bytesSentBefore = stream.bytesSent;
      const bytesReceivedBefore = stream.bytesReceived;
      stream.on("exit", (rt, signal)=>{
        conn.bytesSend = stream.bytesSent - bytesSentBefore;
        conn.bytesReceived = stream.bytesReceived - bytesReceivedBefore;

        if (rt != null) {
          debug(cmd, "done");
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
      stream.on("error", (err)=>{
        debug("error raised from stream", err);
        err.needRecconect = true;
        reject(err);
      });

      //stdout handler
      if (typeof stdout === "function") {
        stream.on("data", (data)=>{
          stdout(data.toString());
        });
      } else if (Array.isArray(stdout)) {
        stream.on("data", (data)=>{
          if (stdout.length > 5) {
            stdout.shift();
          }
          stdout.push(data.toString());
        });
      }

      //stderr handler
      if (typeof stderr === "function") {
        stream.stderr.on("data", (data)=>{
          stderr(data.toString());
        });
      } else if (Array.isArray(stderr)) {
        stream.stderr.on("data", (data)=>{
          if (stderr.length > 5) {
            stderr.shift();
          }
          stderr.push(data.toString());
        });
      }
    });

    if (!rt2) {
      reject(new Error(waitContinue));
    }
  });
}

module.exports.sshExec = sshExec;
