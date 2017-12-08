const {promisify} = require('util');
const fs = require('fs');
const path = require('path');

// setup test framework
const chai = require('chai');
const {expect} = require('chai');
const should = chai.should();
const chaiAsPromised = require("chai-as-promised");
chai.use(chaiAsPromised);
const sinon = require('sinon');
const sinonChai = require("sinon-chai");
chai.use(sinonChai);

const ARsshClient = require('../lib/index.js');
const PsshClient = require('../lib/PsshClient.js');
const SftpUtil  = require('../lib/sftpUtils.js');

let config = require('./config');

const {nonExisting, clearLocalTestFiles, clearRemoteTestFiles} = require('./testFiles');
const {createLocalFiles, localRoot, localEmptyDir, localFiles} = require('./testFiles');
const {createRemoteFiles, remoteRoot,remoteEmptyDir,remoteFiles} = require('./testFiles');


process.on('unhandledRejection', console.dir);

describe('pssh connection test', function(){
  let pssh;
  describe('pssh ', function(){
    beforeEach(async function(){
      pssh = new PsshClient(config);
      await pssh.connect();
    });
    afterEach(function(){
      pssh.disconnect();
    });


    describe('#isConnect', function(){
      it('should be true after connect() called', function(){
        return pssh.isConnected().should.become(true);
      });
      it('should be disconnected after disconnect() called', function(){
        pssh.disconnect();
        return pssh.isConnected().should.become(false);
      });
    });

    describe('#exec', function(){
      let testText = 'hoge';
      it.skip('should be rejected if signal intrupted', function(){
      });
      it('should return zero without error', function(){
        return pssh.exec('hostname').should.become(0);
      });
      it('should return non-zero value with error', function(){
        return pssh.exec('ls hoge').should.not.become(0);
      });
      it('should fire stdout event if command produce output to stdout', function(){
        pssh.once('stdout',(data)=>{
          data.toString().should.equal(testText+'\n');
        });
        return pssh.exec(`echo ${testText}`).should.become(0);
      });
      it('should fire stderr event if command produce output to stderr', function(){
        pssh.once('stderr',(data)=>{
          data.toString().should.equal(testText+'\n');
        });
        return pssh.exec(`echo ${testText} >&2`).should.become(0);
      });
    });
  });
});
