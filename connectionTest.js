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

async function test(config){
  config.privateKey = await readPrivateKeyFile();
//  config.debug=console.log; // enable DEBUG output from ssh2

  let ssh = new sshClient(config);
  ssh
    .on('stdout', (data)=>{
      console.log('stdout:', data);
    })
    .on('stderr', (data)=>{
      console.log('stderr:', data);
    });

  let promisess=[];
  for(let i = 0; i<80; i++){
    promisess.push(ssh.exec('sleep 1 && echo \`hostname\` :'+i));
  }
  promisess.push(ssh.exec('date'));
  await Promise.all(promisess)
  .catch((err)=>{
    console.log(err);
  });
  ssh.disconnect();
}

async function main(){
  let data = await util.promisify(fs.readFile)('ARsshTestSettings.json')
    .catch((err)=>{
      console.log('config setting file read error', err);
    });
  let configs = JSON.parse(data);
  configs.forEach((config)=>{
    test(config);
  });
}

main();
