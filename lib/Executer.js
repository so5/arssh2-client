const {EventEmitter} = require('events');

const debug = require('debug')('arssh2: executer');

const Pssh = require('./PsshClient');
const SftpUtil = require('./sftpUtils');
const ConnectionManager = require('./ConnectionManager');
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

module.exports=Executer;
