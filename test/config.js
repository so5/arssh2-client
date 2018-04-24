const fs = require("fs-extra");

async function readConfig(configFile, keyFile) {
  let config = {};
  try {
    config = await fs.readJson(configFile);
    if (!config.hasOwnProperty("privateKey")) {
      if (keyFile === undefined) {
        if (config.hasOwnProperty("keyFile")) {
          keyFile = config.keyFile;
        } else {
          keyFile = `${process.env.HOME}/.ssh/id_rsa`;
        }
      }
      config.privateKey = (await fs.readFile(keyFile)).toString();
    }
  } catch (e) {
    console.log("test setting file load failed", e); // eslint-disable-line no-console
  }
  return config;
}

module.exports = readConfig;
