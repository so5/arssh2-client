const fs = require('fs');

const configs = require('./ARsshTestSettings.json');

const configNo = 1;
const config = configs[configNo];

if(! config.hasOwnProperty('privateKey')){
  const keyFile = `${process.env.HOME}/.ssh/id_rsa`;
  config.privateKey = fs.readFileSync(keyFile).toString();
}

//config.debug=console.log  // to output ssh2's debug log

module.exports=config;
