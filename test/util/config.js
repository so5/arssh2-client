const fs = require("fs-extra");

async function getConfig() {
  const config = {
    hostname: process.env.ARSSH_TEST_HOSTNAME || process.env.HOSTNAME,
    username: process.env.ARSSH_TEST_USER || process.env.USER,
    port: process.env.ARSSH_TEST_PORT || 22
  };

  if (process.env.hasOwnProperty("ARSSH_TEST_KEYFILE")) {
    const keyFile = process.env.ARSSH_TEST_KEYFILE;
    config.privateKey = (await fs.readFile(keyFile)).toString();
    config.passphrase = process.env.ARSSH_TEST_PW || "";
  } else {
    config.password = process.env.ARSSH_TEST_PW || "";
  }

  return config;
}

module.exports = getConfig;
