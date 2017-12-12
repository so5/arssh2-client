const {EventEmitter} = require('events');

const debug = require('debug')('arssh2: connection-manager');

const Pssh = require('./PsshClient');
const {overwriteDefaultValue, retry} = require('./utils');

class ConnectionManager extends EventEmitter{
  constructor(config, opt){
    super();
    this.config = config;
    this.connections=[]
    this.connectionRetry = overwriteDefaultValue(opt.connectionRetry, 5);
    this.delay = overwriteDefaultValue(opt.connectionRetryDelay, 1000);
    this.maxConnection = overwriteDefaultValue(opt.maxConnection, 4);
  }

  async getConnection(){
    // search unused connection
    let index = this.connections.findIndex((e)=>{
      return e.count=== 0;
    });

    if(index === -1){
      // create new connection if number of existing conections less than max connection
      if(this.connections.length < this.maxConnection){
        let ssh = new Pssh(this.config);
        this.eventNames().forEach((eventName)=>{
          this.listeners(eventName).forEach((listener)=>{
            ssh.on(eventName, listener);
          });
        });

        index = this.connections.length;
        this.connections.push({ssh: ssh, count:0});
      }else{
        // search connection which have least task
        let minCount = this.connections[0].count;
        index = 0;
        this.connections.forEach((e,i)=>{
          if(minCount > e.count){
            index = i;
            minCount = e.count;
          }
        });
      }
    }

    debug('returning ssh connection:', index);
    let ssh=this.connections[index].ssh;
    if(! await ssh.isConnected()){
      try{
        await ssh.connect(this.config);  // 1st try
      }catch(e){
        if(e.name === 'InvalidAsn1Error'){
          e.message='invalid passphrase'
        }
        if(e.level === 'client-authentication' || e.name === 'InvalidAsn1Error'){
          return Promise.reject(e);
        }
        debug('connection failed due to', e);
        await retry(ssh.connect.bind(ssh, this.config), this.maxRetry, this.delay);
      }
    }
    return this.connections[index];
  }
  disconnectAll(){
    this.connections.forEach((conn)=>{
      conn.ssh.end();
    });
    this.connections.splice(0, this.connections.length);
  }
}

module.exports=ConnectionManager;
