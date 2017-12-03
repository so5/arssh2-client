const fs = require('fs');
const {promisify} = require('util');
const EventEmitter = require('events').EventEmitter;
const path = require('path');
const Pssh = require('./PsshClient.js');
const SftpUtil = require('./sftpUtils.js');
const {isDirLocal, isFileLocal, getSizeLocal, retry} = require('./utils');

let overwriteDefaultValue = (variable, defaultValue)=>{
  if(! variable || typeof variable !== 'number' ){
    variable = defaultValue;
  }else{
    variable = parseInt(variable);
  }
  return variable;
}

let walk = async (root, readdir, stat, onDirCB, onFileCB) =>{
  onDirCB(root);
  let files = await readdir(root)
  let pWalk = [];
  files.forEach(async(e)=>{
    let filepath = path.join(root, e);
    let stats = await stat(filepath)
    if(stats.isFile()) pWalk.push(onFileCB(filepath));
    if(stats.isDirectory()) pWalk.push(walk(filepath, readdir, stat, onDirCB, onFileCB));
  });
  Promise.all(pWalk);
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
    // console.log('DEBUG: returning existing ssh instance :', index);
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
    // console.log('DEBUG: enqueue() called');
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
    if(await sftp.isFile(order.dst)){
      order.reject(new Error('dstination path is existing file'));
    }

    await sftp.mkdir_p(order.dst);

    //TODO onFileはPromiseを返してないけどOK?
    let pFile=[]
    let onFile = (target)=>{
      let dst = path.join(order.dst, path.relative(order.src, target));
      pFile.push(sftp.put(target, dst));
    }

    let isNotDirAdaptor = (target)=>{
      return sftp.isDir(target)
        .then((result)=>{
          return !result ? Promise.resolve(target):Promise.reject();
        });
    }
    let isDirAdaptor2 = (target)=>{
      return sftp.isDir(target)
        .then((result)=>{
          return result ? Promise.resolve(target):Promise.reject();
        });
    }
    let pDir=[]
    let onDir = (target)=>{
      let dst = path.join(order.dst, path.relative(order.src, target));
      pDir.push(isNotDirAdaptor(dst)
        .then(sftp.mkdir.bind(sftp,dst))
        .then(retry.bind(this, isDirAdaptor2, 10, 100))
      );
    }
    await walk(order.src, promisify(fs.readdir), promisify(fs.stat), onDir, onFile);

    let promise = pDir.reduce((p, mkdir)=>{
      return p.then(mkdir)
    }, Promise.resolve());

    return promise
      .then(Promise.all.bind(Promise,pFile));
  }

  async _get(ssh, order){
    //
    let sftpStream = await ssh.sftp();
    let sftp = new SftpUtil(sftpStream);
    return sftp.get(order.src, order.dst);
  }
  _executer(delay){
    // console.log('DEBUG: _executer called');
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
            this.queue[0].resolve(rt);
          })
          .catch((err)=>{
            //TODO if recoverable error, just re-call this._executer after delay msec waiting
            // setTimeout(()=>{
            //   this._executer();
            // }, delay);
            // console.log('DEBUG rejected:', err);
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
  async exec(cmd, opt={}){
    // console.log('DEBUG: ARsshClient.exec() called');
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
    // console.log('DEBUG: ARsshClient.send() called');
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
    // console.log('DEBUG: ARsshClient.recv() called');
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
    return this.cm.disconnectAll();
  }
}

module.exports=ARsshClient;
