// error messages from upstream
const waitContinue = "You should wait continue event before sending any more traffic";
const invalidUsername = "Invalid username";
const illegalPrivateKey = "privateKey value does not contain a (valid) private key";
const noPassphrase = "Encrypted private key detected, but no passphrase given";
const privateKeyParseError = "Cannot parse privateKey";
const unsupportedKeyExchange = "Unsupported key exchange algorithm:";
const unsupportedCipher = "Unsupported cipher algorithm: ";
const unsupportedHostKey = "Unsupported server host key algorithm: ";
const unsupportedHMAC = "Unsupported HMAC algorithm: ";
const unsupportedCompress = "Unsupported compression algorithm: ";
const sftpToClosedSocket = "rcvd type 90";
const noResponse = "No response from server";
const notConnected = "Not connected";
const channelNotOpen = "Channel is not open";
const channelOpenError = "(SSH) Channel open failure";

// fatal errors on ssh.connect
function canNotConnect(err) {
  let canNotConnect = true;
  if (err.name === "InvalidAsn1Error" || err.message.trim() === noPassphrase) {
    err.reason = "invalid passphrase";
  } else if (err.name.startsWith("RangeError")) {
    err.reason = "illegal port number";
  } else if (err.code === "ENOTFOUND" || err.level === "client-dns") {
    err.reason = "name resolution failure";
  } else if (err.code === "ETIMEDOUT" || err.level === "client-timeout") {
    err.reason = "timeout occurred during connection process";
  } else if (err.code === "ECONNREFUSED") {
    err.reason = "connection refused";
  } else if (err.level === "client-authentication") {
    err.reason = "authentication failure";
  } else if (err.message.trim() === invalidUsername) {
    err.reason = "invalid username";
  } else if (err.message.trim() === illegalPrivateKey || err.message.startsWith(privateKeyParseError)) {
    err.reason = "invalid private key";
  } else if (
    err.message.startsWith(unsupportedKeyExchange) ||
    err.message.startsWith(unsupportedCipher) ||
    err.message.startsWith(unsupportedHostKey) ||
    err.message.startsWith(unsupportedHMAC)
  ) {
    err.reason = "invalid cipher algorithm";
  } else if (err.message.startsWith(unsupportedCompress)) {
    err.reason = "invalid compression algorithm";
  } else {
    canNotConnect = false;
  }
  return canNotConnect;
}

function isFatal(err) {
  return (
    err.message === "No such file" ||
    err.message === "Permission denied" ||
    err.message === "destination path must not be existing file" ||
    err.message === "src must be existing file or directory" ||
    err.code === "EEXIST" ||
    err.code === "EDQUOT" ||
    err.code === "EISDIR" ||
    err.code === "EMFILE" ||
    err.code === "EMLINK" ||
    err.code === "ENFILE" ||
    err.code === "ENOENT" ||
    err.code === "ENOEXEC" ||
    err.code === "ENOLINK" ||
    err.code === "ENOMEM" ||
    err.code === "ENOSPC" ||
    err.code === "EPERM" ||
    err.code === "ESTALE"
  );
}

function needReconnect(err) {
  return (
    err.error === sftpToClosedSocket ||
    err.message.trim() === noResponse ||
    err.message.trim() === notConnected ||
    err.message.trim() === channelNotOpen ||
    err.code === "ECONNRESET" ||
    err.code === "ETIMEDOUT"
  );
}

function mustWaitBeforeRetry(err) {
  return err.message.startsWith(channelOpenError);
}

module.exports.isFatal = isFatal;
module.exports.needReconnect = needReconnect;
module.exports.mustWaitBeforeRetry = mustWaitBeforeRetry;
module.exports.canNotConnect = canNotConnect;
module.exports.waitContinue = waitContinue;
