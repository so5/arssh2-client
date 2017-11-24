/** yet another ssh2 client wrapper library */
class yassh2Client{
  /**
   * constructor
   *
   * @param { Object } [ config ] - connection setting file
   * @param { string } [ config.host='localhost' ] - hostname
   * @param { string } [ config.port=22 ] - port number
   * @param { string } [ config.username=null ] - user id on remote host
   * @param { string } [ config.privateKey=null ] - private key for pub-key and hostbased authentication
   * @param { string } [ config.passphrase=null ] - passphrase for encripted privateKey
   * @param { string } [ config.password=null ]   - password for password-based authentication
   *
   * @returns { Object } - yassh2 returns null if invalid config settings are spacified,
   *
   * please note you can pass any other original ssh2's option by config object
   */
  constructor (config){
    //initialization
    this.cmd_queue=[];
    this.config=config;

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

  exec(cmd, callback){
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

  send(src, dst){
    console.log("not implemented!!");
  }

  recv(src, dst){
    console.log("not implemented!!");
  }

  test(){
    console.log("not implemented!!");
  }
  discoonect(){
    console.log('disconnect ssh session');
    this.conn.close();
  }
  reconnect(){
    console.log("not implemented!!");
  }
}

module.exports=yassh2Client;
