const EventEmitter = require('events').EventEmitter;

const ssh2Client=require('ssh2').Client;

/** yet another ssh2 client wrapper library */
class yassh2Client extends EventEmitter{
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
    super();
    //initialization
    this.config=config;
    this.proven=false;

    this.delay = config.delay || 1000; //msec;
    this.maxRetryCount= config.maxRetryCount || 2;

    this.conn=new ssh2Client();
    return this;
  }

  /**
   * start connecting remote server and return promise
   */
  connect(){
    return new Promise((resolve, reject)=>{
      this.conn
        .on('ready', ()=>{
          this.proven=true;
          resolve();
        })
        .on('error', (err)=>{
          reject(err);
        });
      this.conn.connect(this.config)
    });
  }

  /**
   * try to connect repeatedly
   */
  _tryConnect(){
    let p = Promise.reject();
    for (let i=0; i<this.maxRetryCount; i++){
      p = p.catch(this.connect.bind(this))
        .catch((err)=>{
          return new Promise((resolve, reject)=>{
            setTimeout(reject.bind(null, err), this.delay);
          });
        });
    }
    return p;
  }

  /**
   * check if connected or not
   */
  isConnected(){
    let rt;
    try{
      rt = this.conn.sftp((err)=>{
        if(err){
          return false
        }else{
          return true;
        }
      });
    }
    catch(e){
      return  false;
    }
    return rt;
  }

  /**
   * execute command on remote host
   * @param {string} cmd - cmdline which will be executed
   * @param {Object} [ opt={} ] - ssh2's exec option object
   */
  async exec(cmd, opt={}){
    return new Promise(async (resolve, reject)=>{
      if(! this.isConnected()){
        await this._tryConnect()
          .catch((err)=>{
            console.log(err);
            reject(err);
          });
      }
      this.conn.exec(cmd, opt, (err, stream)=>{
        if (err) reject(err);
        stream.on('exit', (rt, signal)=>{
          if(rt != null){
            resolve(rt)
          } else if(signal != null){
            reject(new Error(`remote process is interrupted by signal ${signal}`));
          }else{
            let err = new Error('unknown error occurred');
            err.cmd = cmd;
            err.opt = opt;
            err.rt = rt;
            err.signal = signal;
            reject(err);
          }
        }).on('data', (data)=>{
          this.emit('stdout', data.toString());
        }).stderr.on('data', (data)=>{
          this.emit('stderr', data.toString());
        });
      });
    });
  }

  disconnect(){
    this.conn.end();
  }

  send(src, dst){
    console.log("not implemented!!");
  }

  recv(src, dst){
    console.log("not implemented!!");
  }

}

module.exports=yassh2Client;
