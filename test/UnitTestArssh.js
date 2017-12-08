const fs = require('fs');
const util = require('util');
const path = require('path');
const del = require('del');

// setup test framework
const chai = require('chai');
const should = chai.should();
const chaiAsPromised = require("chai-as-promised");
chai.use(chaiAsPromised);
const sinon = require('sinon');
const sinonChai = require("sinon-chai");
chai.use(sinonChai);

// testee
const ARsshClient = require('../lib/index.js');
let arssh;

// test data
const {clearLocalTestFiles, createLocalFiles, localRoot, localEmptyDir, localFiles, nonExisting} = require('./testFiles');
let config = require('./config');

describe('arssh UT', function(){
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

  describe('exec', function(){
    describe('#exec', function(){
      this.timeout(0);
      it('should enqueue exec cmd', function(){
        return arssh.exec('hoge').should.be.fulfilled;
      });
      it('should reject if cmd is not string', async function(){
        return arssh.exec(1).should.be.rejectedWith('cmd must be string');
      });
      it('should enqueue exec cmd', function(){
        let promises=[];
        for(let i=0; i< 80; i++){
          promises.push(arssh.exec('hoge'));
        }
        return Promise.all(promises).should.be.fulfilled;
      });
    });
  });

  describe('fileTransfer', function(){
    beforeEach(async function(){
      await clearLocalTestFiles().then(createLocalFiles)
    });
    after(async function(){
      await clearLocalTestFiles();
    });
    describe('#send', function(){
      it('should enqueue put cmd if src is existing file', function(){
        return arssh.send(localFiles[0],'hoge').should.be.fulfilled;
      });
      it('should enqueue rput cmd if src is existing directory', function(){
        return arssh.send(localEmptyDir,'hoge').should.be.fulfilled;
      });
      it('should reject if src is not existing', async function(){
        return arssh.send(nonExisting,'hoge').should.be.rejectedWith('src must be existing file or directory');
      });
      it('should reject if src is not string', async function(){
        return arssh.send(1,'hoge').should.be.rejectedWith('path must be a string or Buffer');
      });
      it('should reject if dst is not string', async function(){
        return arssh.send(localFiles[0], 2).should.be.rejectedWith('dst must be string');
      });
    });

    describe('#recv', function(){
      it('should enqueue recv cmd', function(){
        return arssh.recv('hoge','hoge').should.be.fulfilled;
      });
      it('should reject if dst is existing file', async function(){
        return arssh.recv('hoge', localFiles[0]).should.be.rejectedWith('dst must not be existing file');
      });
      it('should reject if dst is not string', async function(){
        return arssh.recv('hoge', 1).should.be.rejectedWith('path must be a string or Buffer');
      });
      it('should reject if src is not string', async function(){
        return arssh.recv(1, 'hoge').should.be.rejectedWith('src must be string');
      });
    });
  });
});
