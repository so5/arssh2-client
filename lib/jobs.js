"use strict";
const debug = require("debug")("arssh2:jobs");
const { needReconnect, mustWaitBeforeRetry } = require("./errorParser");
const { sleep } = require("./utils");
const { sshExec } = require("./sshExec");

const delayTimeForChannelBusy = 3000;

async function onException(e, name, cm, conn) {
  debug(name, "failed with", e);

  if (needReconnect(e)) {
    cm.disconnect(conn);
  }

  if (mustWaitBeforeRetry(e)) {
    await sleep(delayTimeForChannelBusy);
  }
  throw e;
}

async function execJob(cm, ...args) {
  debug("start exec", ...args);
  let rt;
  const conn = cm.getConnection();
  await cm.connect(conn);

  try {
    debug("exec command via ssh");
    rt = await sshExec(conn, ...args);
  } catch (e) {
    onException(e, "exec", cm, conn);
  } finally {
    conn.done();
    debug("exec done");
  }
  return rt;
}

async function sftpJob(cm, func, ...args) {
  debug("start", func.name, ...args);
  let rt;
  const conn = cm.getConnection();
  await cm.connect(conn);
  debug("open sftp session");
  const sftp = await cm.getSftp(conn);

  try {
    debug("exec sftp command");
    rt = await func(sftp, ...args);
  } catch (e) {
    onException(e, `sftp ${func.name}`, cm, conn);
  } finally {
    debug("close sftp");
    sftp.end();
    conn.done();
    debug(func.name, "done");
  }
  return rt;
}

module.exports = {
  execJob,
  sftpJob
};
