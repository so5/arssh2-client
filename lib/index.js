/**
 * auto recovery ssh2 client wrapper library
 */
const {EventEmitter} = require('events');

const debug = require('debug')('arssh2: arssh2');

const Pssh = require('./PsshClient');
const SftpUtil = require('./SftpUtils');
const ConnectionManager = require('./ConnectionManager');
const {isDirLocal, isFileLocal} = require('./utils');
const {overwriteDefaultValue} = require('./utils');

class Executer extends EventEmitter {
  constructor(cm, opt){
    super();
    this.cm = cm;
    this.delay = overwriteDefaultValue(opt.delay, 1000);
    this.maxConnection = overwriteDefaultValue(opt.maxConnection, 4);
    this.queue=[];
    this.numRunning=0;
    this.once('go', this._executer);
  }
  enqueue(order){
    debug('enqueue', order);
    this.queue.push(order);
    this.emit('go')
  }
  async _exec(ssh, order){
    return ssh.exec(order.cmd);
  }
  async _put(ssh, order){
    let sftpStream = await ssh.sftp();
    let sftp = new SftpUtil(sftpStream);
    return sftp.put(order.src, order.dst);
  }
  async _rput(ssh, order){
    let sftpStream = await ssh.sftp();
    let sftp = new SftpUtil(sftpStream);
    return sftp.put_R(order.src, order.dst);
  }

  async _get(ssh, order){
    let sftpStream = await ssh.sftp();
    let sftp = new SftpUtil(sftpStream);
    let srcIsFile = await sftp.isFile(order.src);
    let srcIsDir = await sftp.isDir(order.src);
    if(!srcIsFile && ! srcIsDir){
      return Promise.reject(new Error('src must be existing file or directory'));
    }else if (srcIsDir){
      return sftp.get_R(order.src, order.dst);
    }
    return sftp.get(order.src, order.dst);
  }
  async _executer(){
    debug('_executer called');
    if(this.queue.length<= 0){
      this.once('go', this._executer);
      return
    }

    let order = this.queue.shift();
    let conn = await this.cm.getConnection()
    ++conn.count;

    ++this.numRunning;
    let maxRunning = this.maxConnection*2;
    if(this.numRunning < maxRunning && this.queue.length > 0){
      setImmediate(()=>{
        this.emit('go');
      });
    }

    this.once('go', this._executer);
    await this._getCmd(order.type)(conn.ssh, order)
      .then((rt)=>{
        debug(order.type, 'cmd successed. rt=',rt);
        order.resolve(rt);
        if( this.queue.length > 0){
          setImmediate(()=>{
            this.emit('go');
          });
        }
      })
      .catch((err)=>{
        console.log(err);
        // error message is defined around lin 1195 of ssh2/lib/client.js
        if(err.message.startsWith('(SSH) Channel open failure:')
        || err.message === 'You should wait continue event before sending any more traffic'){
          debug('channel open failure');
          this.queue.unshift(order);
          return
        }
        debug(order.type, 'cmd failed due to', err);
        order.reject(err);
      })
      .then(()=>{
        --conn.count;
        --this.numRunning;
        if(conn.count < 0) conn.count = 0;
      });
  }
  _getCmd(type){
    if(type === 'exec'){
      return this._exec;
    }else if(type === 'put'){
      return this._put;
    }else if(type === 'rput'){
      return this._rput;
    }else if(type === 'get'){
      return this._get;
    }
  }
}

/**
 * arssh2 facade class
 */
class ARsshClient {
  /**
   * constructor
   * @param { object } [ config ] - ssh2's connection setting
   * @param { object } [ opt ] - arssh2's own option object
   * @param { string } [ opt.delay=1000 ] - delay between each cmd execution
   * @param { string } [ opt.connectionRetry=5] - max number of retry connection
   * @param { string } [ opt.connectionRetryDelay=1000] - delay between each connection try (msec)
   * @param { string } [ opt.maxConnection=4] - max number of parallel connection
   * @param { string } [ opt.delay=1000] - delay between each cmd execution (msec)
   *
   * please note you can pass any other original ssh2's option by config object
   */
  constructor (config, opt={}){
    this.config=config;
    this.opt=opt;
    this.cm = new ConnectionManager(config, opt);
    this.executer = new Executer(this.cm, opt);

    this.addListener=this.on;
  }

  /**
   * execute command on remote host
   * @param {string} cmd - cmdline which will be executed
   * @param {object} [ opt={} ] - ssh2's exec option object
   */
  exec(cmd, opt={}){
    if(typeof cmd !== 'string'){
      return Promise.reject(new Error('cmd must be string'));
    }
    debug('exec',cmd);
    return new Promise((resolve, reject)=>{
      this.executer.enqueue({
        type: 'exec',
        cmd: cmd,
        opt: opt,
        resolve: resolve,
        reject: reject,
      });
    });
  }

  /**
   * send file or directory and its child to server
   * @param {string} src - file or directory name which to be send
   * @param {string} dst - destination path
   */
  async send(src, dst){
    //quick return if argument are illegal
    let srcIsFile = await isFileLocal(src);
    let srcIsDir  = await isDirLocal(src);
    if(!srcIsFile && ! srcIsDir){
      return Promise.reject(new Error('src must be existing file or directory'));
    }
    if(typeof dst !== 'string'){
      return Promise.reject(new Error('dst must be string'));
    }
    debug('send',src,'to',dst);

    return new Promise((resolve, reject)=>{
      let type = srcIsFile ? 'put':'rput';
      this.executer.enqueue({
        type: type,
        src: src,
        dst: dst,
        resolve: resolve,
        reject: reject,
      });
    })
  }

  /**
   * get file or directory and its child from server
   * @param {string} src - file or directory name which to be retrieve
   * @param {string} dst - destination path
   */
  async recv(src, dst){
    //quick return if argument are illegal
    if(await isFileLocal(dst)){
      return Promise.reject(new Error('dst must not be existing file'));
    }
    if(typeof src !== 'string'){
      return Promise.reject(new Error('src must be string'));
    }
    debug('recv',src,'to',dst);
    return new Promise((resolve, reject)=>{
      this.executer.enqueue({
        type: 'get',
        src: src,
        dst: dst,
        resolve: resolve,
        reject: reject,
      });
    });
  }

  /**
   * check if you can connect to specified server
   */
  async canConnect(){
    let conn = await this.cm.getConnection()
    this.disconnect();
    return Promise.resolve(true);
  }
  /**
   * disconnect all existing connections
   */
  disconnect(){
    return this.cm.disconnectAll();
  }

  // mimic some EventEmitter's method to pass listeners to ConnectionManager
  on(eventName, listener){
    return this.cm.on(eventName, listener);
  }
  once (eventName, listener){
    return this.cm.once(eventName, listener);
  }
  removeListener (eventName, listener){
    return this.cm.removeListener(eventName, listener);
  }
  removeAllListeners(eventName){
    return this.cm.removeAllListeners(eventName);
  }
}

module.exports=ARsshClient;
