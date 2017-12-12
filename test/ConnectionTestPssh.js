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
const SftpUtil  = require('../lib/SftpUtils.js');

let config = require('./config');

const {nonExisting, clearLocalTestFiles, clearRemoteTestFiles} = require('./testFiles');
const {createLocalFiles, localRoot, localEmptyDir, localFiles} = require('./testFiles');
const {createRemoteFiles, remoteRoot,remoteEmptyDir,remoteFiles} = require('./testFiles');

process.on('unhandledRejection', console.dir);

describe.skip('connection test', function(){
  this.timeout(20000);
  describe('PsshClient', function(){
    let pssh;
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

  describe('SftpUtil', function(){
    let pssh;
    let sftp;

    beforeEach(async function(){
      pssh = new PsshClient(config);
      await pssh.connect();
      sftpStream = await pssh.sftp();
      sftp = new SftpUtil(sftpStream);

      let promises=[]
      promises.push(clearRemoteTestFiles(pssh,sftp).then(createRemoteFiles.bind(null, pssh, sftp)));
      promises.push(clearLocalTestFiles().then(createLocalFiles));
      await Promise.all(promises);
    });
    afterEach(async function(){
      let promises=[]
      promises.push(clearRemoteTestFiles(pssh,sftp));
      promises.push(clearLocalTestFiles());
      await Promise.all(promises);
      await pssh.disconnect();
    });

    describe('#isDir', function(){
      [
        {arg: remoteRoot, expected: true},
        {arg: path.join(remoteRoot, 'foo'), expected: false},
        {arg: nonExisting, expected: false}
      ].forEach(function (param){
        it('should return true with dir', function(){
          let rt = sftp.isDir(param.arg);
          return rt.should.become(param.expected)
        });
      });
    });

    describe('#isFile', function(){
      [
        {arg: remoteRoot, expected: false},
        {arg: path.join(remoteRoot, 'foo'), expected: true},
        {arg: nonExisting, expected: false}
      ].forEach(function (param){
        it('should return true with file', function(){
          let rt = sftp.isFile(param.arg);
          return rt.should.become(param.expected)
        });
      });
    });

    describe('#getSize', function(){
      [
        {arg: remoteRoot, expected: false},
        {arg: path.join(remoteRoot, 'foo'), expected: path.join(remoteRoot, 'foo').length+1},
        {arg: nonExisting, expected: false}
      ].forEach(function (param){
        it('should return size with file', function(){
          let rt = sftp.getSize(param.arg);
          return rt.should.become(param.expected)
        });
      });
    });

    describe('#ls', function(){
      [
        {args: path.join(remoteRoot,nonExisting), expected: []},
        {args: path.join(remoteRoot,'foo'),       expected: ["foo"]},
        {args: remoteRoot,                        expected: ["foo", "bar", "baz", "hoge", "huga"]}
      ].forEach(function(param){
        it('should return array of filenames', function(){
          let rt = sftp.ls( param.args);
          return rt.should.eventually.have.members(param.expected);
        });
      });
    });

    describe('#get', function(){
      [
        {
          src: path.join(remoteRoot, 'foo'),
          dst: path.join(localRoot, 'foobar'),
          rt: ['foobar'],
          message: 'get file and rename'
        },
        {
          src: path.join(remoteRoot, 'foo'),
          dst: localEmptyDir,
          rt: ['foo'],
          message: 'get file to directory'
        }
      ].forEach(function(param){
        it('should get file from server', function(){
          let promise = sftp.get( param.src, param.dst)
            .then(async ()=>{
              let rt;
              let stats = await promisify(fs.stat)(param.dst);
              if(stats.isDirectory()){
                rt = await promisify(fs.readdir)(param.dst);
              }else{
                rt = [path.basename(param.dst)];
              }
              rt.should.have.members(param.rt, param.message)
            });
          return promise.should.be.fulfilled
        });
      });
      [
        {src: nonExisting, error: 'src must be file'},
        {src: remoteRoot, error: 'src must be file'},
      ].forEach(function(param){
        it('should reject when getting non existing file', function(){
          let promise = sftp.get(param.src, remoteRoot)
          return promise.should.be.rejectedWith(param.error);
        });
      });
    });

    describe('#put', function(){
      [
        {
          src: path.join(localRoot, 'foo'),
          dst: path.join(remoteRoot, 'foobar'),
          rt: ['foobar'],
          message: 'put file and rename'
        },
        {
          src: path.join(localRoot, 'foo'),
          dst: remoteEmptyDir,
          rt: ['foo'],
          message: 'put file to directory'
        },
        {
          src: path.join(localRoot, 'foo'),
          dst: path.join(remoteEmptyDir, nonExisting)+'/',
          rt: ['foo'],
          message: 'put file to nonExisting directory'
        }
      ].forEach(function(param){
        it('should put file to server', function(){
          let promise = sftp.put( param.src, param.dst)
            .then(async ()=>{
              let rt = await sftp.ls(param.dst);
              rt.should.have.members(param.rt, param.message)
            });
          return promise.should.be.fulfilled
        });
      });
      [
        {src: nonExisting, error: 'src must be file'},
        {src: localRoot, error: 'src must be file'}
      ].forEach(function(param){
        it('should reject when sending non existing file', function(){
          let promise = sftp.put(param.src, remoteRoot)
          return promise.should.be.rejectedWith(param.error);
        });
      });
    });

    describe('#mkdir_p', function(){
      it('should make child of existing directory', function(){
        let rt=sftp.mkdir_p(remoteRoot+'/hogehoge');
        return rt.should.become(undefined);
      });
      it('should make child dir of non-existing directory with trailing pathsep', function(){
        let tmpDirname=`${remoteRoot}/${nonExisting}/hogehoge/foo/bar/baz/huga/`;
        let rt=sftp.mkdir_p(tmpDirname);
        return rt.should.become(undefined);
      });
      it('should make child dir of non-existing directory', function(){
        let tmpDirname=`${remoteRoot}/${nonExisting}/hogehoge/foo/bar/baz/huga`;
        let rt=sftp.mkdir_p(tmpDirname);
        return rt.should.become(undefined);
      });
      it('should resolve with undefined if making existing directory', function(){
        let rt=sftp.mkdir_p(remoteRoot);
        return rt.should.become(undefined);
      });
      it.skip('should cause error if making child dir of not-owned directory', function(){
      });
    });
  });
});
