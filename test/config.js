const fs = require('fs');
let config={};

try{
  config = require('./ARsshTestSettings.json');
  if(! config.hasOwnProperty('privateKey')){
    const keyFile = `${process.env.HOME}/.ssh/id_rsa`;
    config.privateKey = fs.readFileSync(keyFile).toString();
  }
  //config.debug=console.log  // to output ssh2's debug log

}catch(e){
  console.log('test setting file load failed'); // eslint-disable-line no-console
}

module.exports=config;
