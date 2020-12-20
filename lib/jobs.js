"use strict";
const debug = require("debug")("arssh2:jobs");
const { needReconnect, mustWaitBeforeRetry } = require("./errorParser");
const { sleep } = require("./utils");
const { sshExec } = require("./sshExec");
const { waitContinue } = require("./utils");
const delayTimeForChannelBusy = 3000;

/**
 * get sftp-stream object from cnnection object
 * @param {Object} conn - connection object
 * @returns {Object} - sftp-stream object from ssh2
 */
async function getSftp(conn) {
  return new Promise((resolve, reject)=>{
    const rt = conn.ssh.sftp((err, sftp)=>{
      if (err) {
        reject(err);
        return;
      }
      sftp.on("error", (e)=>{
        debug("error raised from stream", e);
        err.needRecconect = true;
        reject(e);
      });
      resolve(sftp);
    });

    if (!rt) {
      reject(new Error(waitContinue));
    }
  });
}

/**
 * Excption handler
 * @param {Error} e - Error object.
 * @param {string} name - Function name.
 * @param {Object} cm - Instance of ConnectionManager.
 * @param {Object} conn - Connection object.
 */
async function onException(e, name, cm, conn) {
  debug(name, "failed with", e);

  if (needReconnect(e)) {
    cm.disconnect(conn);
  }

  if (mustWaitBeforeRetry(e)) {
    await sleep(delayTimeForChannelBusy);
  }
}

/**
 * exec adaptor
 * @param {Object} cm - Instance of ConnectionManager.
 * @param {Object} args - Original arguments.
 */
async function execJob(cm, ...args) {
  debug("start exec", ...args);
  let rt;
  let error = null;
  const conn = cm.getConnection();
  await cm.connect(conn);

  try {
    debug("exec command via ssh");
    rt = await sshExec(conn, ...args);
  } catch (e) {
    onException(e, "exec", cm, conn);
    error = e;
  } finally {
    conn.done();
    debug("exec done");
  }
  if (error) {
    throw error;
  }
  return rt;
}

/**
 * sftp adaptor
 * @param {Object} cm - Instance of ConnectionManager.
 * @param {Function} func - Function.
 * @param {Object} args - Original arguments.
 */
async function sftpJob(cm, func, ...args) {
  debug("start", func.name, ...args);
  let rt;
  let error = null;
  const conn = cm.getConnection();
  await cm.connect(conn);
  debug("open sftp session");
  const sftp = await getSftp(conn);

  try {
    debug("exec sftp command");
    rt = await func(sftp, ...args);
  } catch (e) {
    onException(e, `sftp ${func.name}`, cm, conn);
    error = e;
  } finally {
    debug("close sftp");
    sftp.end();
    conn.done();
    debug(func.name, "done");
  }
  if (error) {
    throw error;
  }
  return rt;
}

/**
 * sftp streamIO adaptor
 * @param {Object} cm - Instance of ConnectionManager.
 * @param {Function} func - Function.
 * @param {Object} args - Original arguments.
 */
async function sftpStreamJob(cm, func, ...args) {
  debug("start", func.name, ...args);
  let rt;
  const conn = cm.getConnection();
  await cm.connect(conn);
  debug("open sftp session");
  const sftp = await getSftp(conn);

  try {
    debug("exec sftp command");
    rt = await func(sftp, ...args);
  } catch (e) {
    sftp.end();
    onException(e, `sftp ${func.name}`, cm, conn);
    throw (e);
  }
  rt.on("error", (e)=>{
    sftp.end();
    conn.done();
    debug(func.name, "failed");
    throw (e);
  });

  const cleanup = ()=>{
    debug("close sftp");
    sftp.end();
    conn.done();
    debug(func.name, "done");
  };
  //to be checked !!
  //is it OK if writeble stream called both end() and close() ?
  rt.on("end", cleanup);
  rt.on("close", cleanup);
  return rt;
}

module.exports = {
  execJob,
  sftpJob,
  sftpStreamJob
};
