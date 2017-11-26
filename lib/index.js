const EventEmitter = require('events').EventEmitter;

const ssh2Client=require('ssh2').Client;

class connection{
  constructor(){
    this.conn = new ssh2Client()
    this.numUsing=0;
    this.trying=false;
    this.p=Promise.reject();
  }
  /**
   * check if connected or not
   */
  isConnected(){
    try {
      this.conn.sftp(()=>{
        // console.log('connection test OK');
      });
    }
    catch(e) {
      if(e.message === 'Not connected'){
        return false;
      }
      console.log("isConnected: sftp throw", e);
    }
    return true;
  }

  /**
   * start connecting remote server and return promise
   */
  _connect(config){
      // console.log('DEBUG: num listener of ready, error=',
      //   this.conn.listenerCount('ready'),
      //   this.conn.listenerCount('error')
      //  );
    return new Promise((resolve, reject)=>{
      //DEBUG log end//
      let onReady = ()=>{
        this.proven=true;
        this.trying=false;
        // console.log('connected !');
        resolve();
        cleanUp();
      }
      let onError = (err)=>{
        reject(err);
        cleanUp();
      }
      let cleanUp = ()=>{
        this.conn.removeListener('ready', onReady);
        this.conn.removeListener('error', onError);
      }
      this.conn.on('ready', onReady)
      this.conn.on('error', onError);
      this.conn.connect(config)
    });
  }

  /**
   * try to connect repeatedly
   */
  connect(config, delay, maxRetry){
    if(this.trying) return this.p;
    this.trying=true;
    if(this.isConnected()) return Promise.resolve();
    let delayedReject = (err)=>{
      return new Promise((resolve, reject)=>{
        setTimeout(reject.bind(null, err), delay);
      });
    }
    for (let i=0; i<maxRetry; i++){
      this.p = this.p.catch(this._connect.bind(this, config)).catch(delayedReject);
    }
    return this.p;
  }
  decrease(){
    this.numUsing--;
    if(this.numUsing < 0) this.numUsing=0;
    // console.log('DEBUG: decrease() called numUsing = ', this.numUsing);
  }
  increase(){
    this.numUsing++;
    // console.log('DEBUG: increase() called numUsing = ', this.numUsing);
  }
}

class connectionManager{
  constructor(config, delay, maxRetryCount, maxConnection=4){
    this.config=config;
    this.connections=[];
    this.delay = delay;
    this.maxRetryCount = maxRetryCount;
    this.maxConnection = maxConnection;

    this.connections.push(new connection());
    this.connections[0].connect(this.config, this.delay, this.maxRetryCount)
  }
  async getConnection(){
    let index = this.connections.findIndex((conn)=>{
      return conn.numUsing === 0;
    });
    if(index === -1){
      if(this.connections.length < this.maxConnection){
        this.connections.push(new connection());
        index=this.connections.length-1;
      }else{
        index = 0;
        let minNumUsing=this.connections[index].numUsing;
        this.connections.forEach((e,i)=>{
          if(minNumUsing > e.numUsing){
            index=i;
            minNumUsing = e.numUsing;
          }
        })
      }
    }
    // console.log('DEBUG: index=', index);
    let rt = this.connections[index];
    await rt.connect(this.config, this.delay, this.maxRetryCount)
    .catch((e)=>{
      console.log('connection failed with', rt);
      console.log('reason:',e);
    });
    // console.log('DEBUG: current num connections',this.connections.length);
    // console.log('DEBUG: index, numUsing =', index, rt.numUsing);
    return rt;
  }
  disconnectAll(){
    this.connections.forEach((conn)=>{
      conn.conn.end();
    });
    this.connections.splice(0,this.connections.length);
  }
}

/** auto recovery ssh2 client wrapper library */
class ARssh2 extends EventEmitter{
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
   * please note you can pass any other original ssh2's option by config object
   */
  constructor (config){
    super();
    //initialization
    this.proven=false;

    let delay = config.delay || 1000; //msec;
    let maxRetryCount= config.maxRetryCount || 2;
    let maxParallelSession = config.maxParallelSession || 4;
    this.execRetryDelay=1000

    this.connectionManager = new connectionManager(config, delay, maxRetryCount, maxParallelSession);
    return this;
  }

  /**
   * execute command on remote host
   * @param {string} cmd - cmdline which will be executed
   * @param {Object} [ opt={} ] - ssh2's exec option object
   */
  async exec(cmd, opt={}){
    return new Promise(async (resolve, reject)=>{
      let _exec = async (cmd, opt)=>{
        let conn = await this.connectionManager.getConnection();
        conn.increase()
        let rt = conn.conn.exec(cmd, opt, (err, stream) =>{
          if (err) {
            conn.decrease();
            // console.log('DEBUG: exec failed',err.message);
            setTimeout(_exec.bind(this,cmd, opt), this.execRetryDelay);
            return
          }
          stream.on('exit', (rt, signal)=>{
            conn.decrease();
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
          })
            .on('data', (data)=>{
              this.emit('stdout', data.toString());
            })
            .stderr.on('data', (data)=>{
              this.emit('stderr', data.toString());
            });
        });
        if(! rt){
          //TODO should be tested with real sshd
          conn.increase();
          setTimeout(_exec.bind(this,cmd, opt), this.execRetryDelay);
        }
      }
      _exec(cmd, opt);
    });
  }

  send(src, dst){
    return new Promise(async (resolve, reject)=>{
      let conn = await this.connectionManager.getConnection()
        .catch((e)=>{
          console.log('error occurred while loading connection object')
          reject(e);
        });
      conn.increase()
      let rt = conn.conn.sftp((err, sftp)=>{
        if(err){
          conn.decrease();
          reject(err);
          return
        }
        sftp.fastPut(src, dst, (err)=>{
          conn.decrease();
          if(err){
            reject(err);
            return
          }
          resolve();
        });
      });
    })
  }

  recv(src, dst){
    console.log("not implemented!!");
  }

  disconnect(){
    this.connectionManager.disconnectAll();
  }
}

module.exports=ARssh2;
