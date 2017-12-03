const fs = require('fs');
const util = require('util');
const path = require('path');

// setup test framework
const chai = require('chai');
const chaiAsPromised = require("chai-as-promised");
chai.use(chaiAsPromised);
const should = chai.should();
const sinon = require('sinon');

// testee
const ARsshClient = require('../lib/index.js');
let arssh;

// test data
let config = require('./config');
let existingFile = 'ARSSH_TEST_DUMMY_EXISTING_FILE'
let existingDir  = 'ARSSH_TEST_DUMMY_EXISTING_DIR'
let nonExisting  = 'ARSSH_TEST_DUMMY_NON_EXISTING_FILE'
describe('ARsshClient', function(){
  this.timeout(10000);
  before(async function(){
    try{
      await util.promisify(fs.writeFile)(existingFile, existingFile);
      await util.promisify(fs.mkdir)(existingDir);
    }catch(e){
      console.log(e);
    }
    await util.promisify(fs.rmdir)(nonExisting)
      .catch(()=>{
        return util.promisify(fs.unlink)(nonExisting)
      })
      .catch((err)=>{
        if(err.code!=='ENOENT') console.log(err);
      });
  });
  after(async function(){
    try{
      await util.promisify(fs.unlink)(existingFile);
      await util.promisify(fs.rmdir)(existingDir);
    }catch(e){
      console.log(e);
    }
  });
  beforeEach(function(){
    arssh = new ARsshClient(config, {delay: 1000, connectionRetryDelay: 100});

    sinon.stub(arssh.executer, '_exec').resolves();
    sinon.stub(arssh.executer, '_put').resolves();
    sinon.stub(arssh.executer, '_rput').resolves();
    sinon.stub(arssh.executer, '_get').resolves();
  });
  afterEach(function(){
    arssh.disconnect();
  });

  describe('#exec', function(){
    it('should enqueue exec cmd', function(){
      return arssh.exec('hoge').should.be.fulfilled;
    });
    it('should reject if cmd is not string', async function(){
      return arssh.exec(1).should.be.rejectedWith('cmd must be string');
    });
  });

  describe('#send', function(){
    it('should enqueue put cmd if src is existing file', function(){
      return arssh.send(existingFile,'hoge').should.be.fulfilled;
    });
    it('should enqueue rput cmd if src is existing directory', function(){
      return arssh.send(existingDir,'hoge').should.be.fulfilled;
    });
    it('should reject if src is not existing', async function(){
      return arssh.send(nonExisting,'hoge').should.be.rejectedWith('src must be existing file or directory');
    });
    it('should reject if src is not string', async function(){
      return arssh.send(1,'hoge').should.be.rejectedWith('path must be a string or Buffer');
    });
    it('should reject if dst is not string', async function(){
      return arssh.send(existingFile, 2).should.be.rejectedWith('dst must be string');
    });
  });

  describe('#recv', function(){
    it('should enqueue recv cmd', function(){
      return arssh.recv('hoge','hoge').should.be.fulfilled;
    });
    it('should reject if dst is existing file', async function(){
      return arssh.recv('hoge', existingFile).should.be.rejectedWith('dst must not be existing file');
    });
    it('should reject if dst is not string', async function(){
      return arssh.recv('hoge', 1).should.be.rejectedWith('path must be a string or Buffer');
    });
    it('should reject if src is not string', async function(){
      return arssh.recv(1, 'hoge').should.be.rejectedWith('src must be string');
    });
  });
});
