const fs = require('fs');
const {promisify} = require('util');
const EventEmitter = require('events').EventEmitter;
const path = require('path');
const debug = require('debug')('arssh2: arssh2');
const Pssh = require('./PsshClient.js');
const SftpUtil = require('./sftpUtils.js');
const {isDirLocal, isFileLocal, retry} = require('./utils');

let overwriteDefaultValue = (variable, defaultValue)=>{
  if(! variable || typeof variable !== 'number' ){
    variable = defaultValue;
  }else{
    variable = parseInt(variable);
  }
  return variable;
}

class ConnectionManager extends EventEmitter {
  constructor(config, opt){
    super();
    this.config = config;
    this.connections=[]
    this.connectionRetry = overwriteDefaultValue(opt.connectionRetry, 5);
    this.delay = overwriteDefaultValue(opt.connectionRetryDelay, 1000);
    this.maxConnection = overwriteDefaultValue(opt.maxConnection, 4);
  }

  async getConnection(){
    // if there is no connection, create new and return
    if(this.connections.length <=0){
      let ssh = new Pssh(this.config);
      ssh.on('stdout', (data)=>{
        this.emit('stdout', data);
      });
      ssh.on('stderr',  (data)=>{
        this.emit('stderr', data);
      });
      await retry(ssh.connect.bind(ssh, this.config), this.maxRetry, this.delay);
      this.connections.push({ssh: ssh, count:0});
      return this.connections[0];
    }

    let index = 0;
    let minCount = this.connections[0].count;
    this.connections.forEach((e,i)=>{
      if(minCount > e.count){
        index = i;
        minCount = e.count;
      }
      if(minCount === 0){
        return false;
      }
    });
    debug('returning existing ssh instance :', index);
    let rt =this.connections[index];
    let ssh=rt.ssh;
    if(ssh.isConnected()){
      await retry(ssh.connect.bind(ssh, this.config), this.maxRetry, this.delay);
    }
    return rt;
  }
  disconnectAll(){
    this.connections.forEach((conn)=>{
      conn.ssh.end();
    });
    this.connections.splice(0, this.connections.length);
  }
}

class Executer extends EventEmitter {
  constructor(cm, delay){
    super();
    this.cm = cm;
    this.delay = overwriteDefaultValue(delay, 1000);
    this.queue=[];
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
  _executer(delay){
    debug('_executer called');
    if(this.queue.length <= 0){
      this.once('go', this._executer);
      return;
    }
    this.cm.getConnection()
      .then((conn)=>{
        conn.count +=1;
        let order = this.queue[0];
        return this._getCmd(order.type)(conn.ssh, order)
          .then((rt)=>{
            debug(order.type, 'cmd successed with', rt);
            this.queue[0].resolve(rt);
          })
          .catch((err)=>{
            //TODO if recoverable error, just re-call this._executer after delay msec waiting
            // setTimeout(()=>{
            //   this._executer();
            // }, delay);
            debug(order.type, 'cmd failed due to', err);
            this.queue[0].reject(err);
          })
          .then(()=>{
            let head = this.queue.shift();
            conn.count -= 1;
            if(conn.count <= 0) conn.count = 0;
            this.once('go', this._executer);
          });
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

/** auto recovery ssh2 client wrapper library */
class ARsshClient extends EventEmitter {
  /**
   * constructor
   *
   * @param { Object } [ config ] - ssh2's connection setting
   * @param { Object } [ opt ] - arssh2's own option object
   * @param { string } [ opt.delay=1000 ] - delay between each cmd execution
   * @param { string } [ opt.connectionRetry=5] - max number of retry connection
   * @param { string } [ opt.connectionRetryDelay=1000] - delay between each connection try (msec)
   * @param { string } [ opt.maxConnection=4] - max number of parallel connection
   * @param { string } [ opt.delay=1000] - delay between each cmd execution (msec)
   *
   * please note you can pass any other original ssh2's option by config object
   */
  constructor (config, opt={}){
    super();
    this.cm = new ConnectionManager(config, opt);
    // re-emit Pssh's stdout/err message throuh ConnectionManager
    this.cm.on('stdout', (data)=>{
      this.emit('stdout', data);
    });
    this.cm.on('stderr',  (data)=>{
      this.emit('stderr', data);
    });

    this.executer = new Executer(this.cm, opt.delay);
  }

  /**
   * execute command on remote host
   * @param {string} cmd - cmdline which will be executed
   * @param {Object} [ opt={} ] - ssh2's exec option object
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

  disconnect(){
    return this.cm.disconnectAll();
  }
}

module.exports=ARsshClient;
