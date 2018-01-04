const {EventEmitter} = require('events');
const debug = require('debug')('arssh2:pssh');
const ssh2Client=require('ssh2').Client;

const waitContinueMessage='You should wait continue event before sending any more traffic';
// following 2 messages are hard corded in ssh2 lib
const notConnectedMessage='Not connected';
const noResponseMessage='No response from server';
const channelOpenErrorMessage='(SSH) Channel open failure';

/**
 * promisified ssh2 client method bridge class
 *
 */
class PsshClient extends EventEmitter{
  /**
   * @param {Object} config - ssh2's config object
   */
  constructor(config){
    super();
    this.config = config
    this.conn = new ssh2Client()
    // define disconnect() as alias of end()
    this.disconnect = this.end;
  }

  isConnected(){
    return new Promise((resolve, reject)=>{
      this.sftp()
      .then(()=>{
        resolve(true);
      })
      .catch((err)=>{
        if(err.message.trim() === noResponseMessage){
          resolve(false);
        }else if(err.message.trim() === notConnectedMessage){
          resolve(false);
        }else if(err.message.trim() === waitContinueMessage){
          resolve(false);
        }else if(err.message.startsWith(channelOpenErrorMessage)){
          resolve(false);
        }else{
          reject(err);
        }
      });
    });
  }

  /**
   * initiate session
   */
  connect(){
    return new Promise((resolve, reject)=>{
      let onReady = ()=>{
        debug('connection ready');
        resolve();
        cleanUp();
      }
      let onError = (err)=>{
        debug('connection failed');
        reject(err);
        cleanUp();
      }
      let cleanUp = ()=>{
        this.conn.removeListener('ready', onReady);
        this.conn.removeListener('error', onError);
      }

      debug('try to connect to',this.config.hostname);
      this.conn.on('ready', onReady)
      this.conn.on('error', onError);
      this.conn.connect(this.config)
    });
  }

  /**
   * execute command on remote host
   * @param {string} cmd - cmdline which will be executed
   * @param {Object} opt - ssh2's exec option object
   */
  async exec(cmd, opt={}){
    return new Promise((resolve, reject)=>{
      let rt = this.conn.exec(cmd, opt, (err, stream) =>{
        if (err) reject(err);
        stream
          .on('exit', (rt, signal)=>{
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
          });
        this.listeners('stdout').forEach((listener)=>{
          stream.on('data', listener);
        });
        this.listeners('stderr').forEach((listener)=>{
          stream.stderr.on('data', listener);
        });
      });
      if(! rt) reject(new Error(waitContinueMessage));
    });
  }

  /**
   * start sftp session
   */
  async sftp(){
    return new Promise((resolve, reject)=>{
      let rt = this.conn.sftp((err, sftp)=>{
        if(err){
          reject(err);
          return
        }
        resolve(sftp);
      });
      if(! rt) reject(new Error(waitContinueMessage));
    });
  }

  /**
   * disconnect session
   */
  end(){
    this.conn.end();
  }
}

module.exports=PsshClient;
