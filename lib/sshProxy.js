function sshProxy(config){
  //initialization
  this.cmd_queue=[];
  this.config=config;
  //this.config.debug=console.log

  // overeide sshkey if conf.privatekey seems filename;
  var fs = require('fs');
  if("privateKey" in config){
    try{
      var private_key_string=fs.readFileSync(config.privateKey);
    }catch(err){
      if(err.code != 'ENOENT'){
        console.log("could not read privateKey!");
      }
    }
    this.config.privateKey=private_key_string;
  }

  var client=require('ssh2').Client;
  this.conn=new client();
  this.conn.on('error', function(){
    console.log('connection error');
  });
  this.conn.on('end', function(){
    console.log('connection closed');
  });
  this.conn.on('ready', function(){
    console.log('ready to execute cmd');
  });
  this.conn.connect(this.config);
  return this;
}

sshProxy.prototype.exec = function(cmd, callback){
  this.cmd_queue.push(cmd);
  try{
    while(this.cmd_queue.length>0){
      this.conn.exec(this.cmd_queue[0], function(err, stream) {
        if (err) throw err;
        stream.on('data', function(data) {
          console.log('STDOUT: ' + data);
          callback('ssh_stdout', data.toString());
        }).stderr.on('data', function(data) {
          console.log('STDERR: ' + data);
          callback('ssh_stderr', data.toString());
        });
      });
      this.cmd_queue.shift();
    }
  } catch (err){
    console.log('ssh connection not ready');
  }
}

sshProxy.prototype.send= function(src, dst){
  console.log("not implemented!!");
}

sshProxy.prototype.recv= function(src, dst){
  console.log("not implemented!!");
}

sshProxy.prototype.discoonect=function(){
  console.log('disconnect ssh session');
  this.conn.close();
}

module.exports=sshProxy;
