const EventEmitter = require('events').EventEmitter;
const path = require('path');
const Pssh = require('./PsshClient.js');
const sftpUtil = require('./sftpUtils.js');
const {isDirLocal, isFileLocal, getSizeLocal} = require('../lib/utils');

class ConnectionManager{
  constructor(config){
    this.config = config;
    this.connections=[]
  }

  async getConnection(){
    let index = this.connections.findIndex((conn)=>{
      return conn.numUsing === 0;
    });
    if(index === -1){
      if(this.connections.length < this.maxConnection){
        this.connections.push(new connection(this.config));
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
    if(! await rt.isConnected()){
      await rt.connect(this.maxRetryCount, this.delay);
    }
    // console.log('DEBUG: current num connections',this.connections.length);
    // console.log('DEBUG: index, numUsing =', index, rt.numUsing);
    return rt;
  }
}

class Executer extends EventEmitter {
  constructor(cm, delay){
    super();
    this.queue=[];
    this.delay=delay
    this.cm = cm;

    this.on('waiting', this._executer);
    this.on('clear', this._stop);
  }
  enqueue(order){
    this.queue.push(order);
    this.emit('waiting')
  }
  _exec(order){
    let con = this.cm.getConnection();
  }
  _put(order){
    let con = this.cm.getConnection();
  }
  _rput(order){
    let con = this.cm.getConnection();
  }
  _get(order){
    let con = this.cm.getConnection();
  }
  _done(){
    this.queue.pop();
    if(this.queue.length <= 0) this.emit('clear');
  }
  _stop(){
    clearInterval(this.timeout);
  }
  _executer(delay){
    if(this.queue.length <= 0) return;
      let order = this.queue[0];
      let rt = this._getCmd(order.type)(order);
      if(rt){
        this._done();
      }else{
        setTimeout(()=>{
          this.emit('waiting');
        }, delay);
      }
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
class ARssh2 {
  /**
   * constructor
   *
   * @param { Object } [ config ] - ssh2's connection setting
   * @param { Object } [ opt ] - arssh2's own option object
   * @param { string } [ opt.delay=1000 ] - delay between each cmd execution
   *
   * please note you can pass any other original ssh2's option by config object
   */
  constructor (config, opt={}){
    this.maxRetryCount = opt.maxRetryCount || 2;
    this.maxParallelSession = opt.maxParallelSession || 4;
    this.cm = new ConnectionManager(config);

    let delay = opt.delay || 1000; //msec;
    this.executer = new Executer(this.cm, delay);

    return this;
  }


  /**
   * execute command on remote host
   * @param {string} cmd - cmdline which will be executed
   * @param {Object} [ opt={} ] - ssh2's exec option object
   */
  async exec(cmd, opt={}){
    if(typeof cmd !== 'string'){
      throw new Error('cmd must be string');
    }
    return new Promise(async (resolve, reject)=>{
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
      throw new Error('src must be existing file or directory');
    }
    if(typeof dst !== 'string'){
      throw new Error('dst must be string');
    }

    return new Promise(async (resolve, reject)=>{
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
      throw new Error('dst must not be existing file');
    }
    if(typeof src !== 'string'){
      throw new Error('src must be string');
    }
    return new Promise(async (resolve, reject)=>{
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
    return this.cm.disconnect();
  }
}

module.exports=ARssh2;
