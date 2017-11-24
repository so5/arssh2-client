const util = require('util');
const fs = require('fs');

const sshClient = require('./lib/index.js');

async function readPrivateKeyFile(keyFile){
  keyFile = keyFile || `${process.env.HOME}/.ssh/id_rsa`;
  let privateKey = await util.promisify(fs.readFile)(keyFile)
  .catch((err)=>{
    console.log('private key file read error', err);
  });
  return privateKey.toString();
}

async function main(){
  let data = await util.promisify(fs.readFile)('yasshTestSettings.json')
    .catch((err)=>{
      console.log('config setting file read error', err);
    });
  let configs = JSON.parse(data);
  configs.forEach((config)=>{
    config.privateKey = `${process.env.HOME}/.ssh/id_rsa`;
    ssh = new sshClient(config);
    setInterval(()=>{
    ssh.exec('hostname',(stdout, stderr)=>{
      console.log('stdout:', stdout);
      console.log('stderr:', stderr);
    });
    },2000);
  });
}

main();
