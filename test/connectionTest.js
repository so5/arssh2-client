const {promisify} = require('util');
const fs = require('fs');
const path = require('path');

const chai = require('chai');
const chaiAsPromised = require("chai-as-promised");
chai.use(chaiAsPromised);
const assert = chai.assert; //TODO should be removed
const should = chai.should();
const sinon = require('sinon');

const ARsshClient = require('../lib/index.js');
const PsshClient = require('../lib/PsshClient.js');
const SftpUtil  = require('../lib/sftpUtils.js');

let config = require('./config');

const {nonExisting, clearLocalTestFiles, clearRemoteTestFiles} = require('./testFiles');
const {createLocalFiles, localRoot, localEmptyDir, localFiles} = require('./testFiles');
const {createRemoteFiles, remoteRoot,remoteEmptyDir,remoteFiles} = require('./testFiles');

let ssh;

process.on('unhandledRejection', console.dir);

describe('connection test', function(){
  describe('PsshClient', function(){
    before(function(){
      ssh = new PsshClient(config);
    })
    beforeEach(async function(){
      await ssh.connect();
    });
    afterEach(function(){
      ssh.disconnect();
    });


    describe('#isConnect', function(){
      it('should be true after connect() called', function(){
        return ssh.isConnected().should.become(true);
      });
      it('should be disconnected after disconnect() called', function(){
        ssh.disconnect();
        return ssh.isConnected().should.become(false);
      });
    });

    describe('#exec', function(){
      let testText = 'hoge';
      it.skip('should be rejected if signal intrupted', function(){
      });
      it('should return zero without error', function(){
        return ssh.exec('hostname').should.become(0);
      });
      it('should return non-zero value with error', function(){
        return ssh.exec('ls hoge').should.not.become(0);
      });
      it('should fire stdout event if command produce output to stdout', function(){
        ssh.once('stdout',(data)=>{
          data.should.equal(testText+'\n');
        });
        return ssh.exec(`echo ${testText}`).should.become(0);
      });
      it('should fire stderr event if command produce output to stderr', function(){
        ssh.once('stderr',(data)=>{
          data.should.equal(testText+'\n');
        });
        return ssh.exec(`echo ${testText} >&2`).should.become(0);
      });
    });
  });

  describe('SftpUtil', function(){
    let sftp;

    before(function(){
      ssh = new PsshClient(config);
    })
    beforeEach(async function(){
      this.timeout(10000);
      await ssh.connect();
      sftpStream = await ssh.sftp();
      sftp = new SftpUtil(sftpStream);

      let promises=[]
      promises.push(clearRemoteTestFiles(ssh,sftp).then(createRemoteFiles.bind(null, ssh, sftp)));
      promises.push(clearLocalTestFiles().then(createLocalFiles));
      await Promise.all(promises);
    });
    afterEach(function(){
      ssh.disconnect();
    });

    after(async function(){
      await ssh.connect()
      sftpStream = await ssh.sftp();
      sftp = new SftpUtil(sftpStream);
      let promises=[]
      promises.push(clearRemoteTestFiles(ssh,sftp));
      promises.push(clearLocalTestFiles());
      await Promise.all(promises);
      await ssh.disconnect()
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

  describe('ARssh2', function(){
    let pssh;
    before(async function(){
      pssh = new PsshClient(config);
      await pssh.connect();
      sftpStream = await pssh.sftp();
      sftp = new SftpUtil(sftpStream);
    });
    beforeEach(function(){
      ssh = new ARsshClient(config, {delay: 1000, connectionRetryDelay: 100});
    });
    afterEach(function(){
      ssh.disconnect();
    });
    after(function(){
      pssh.disconnect();
    });

    describe('#exec', function(){
      let testText = 'hoge';
      let numExec = 20;

      it('single command with stdout',function(){
        ssh.on('stdout',(data)=>{
          data.trim().should.equal(testText);
        });
        return ssh.exec(`echo ${testText}`).should.become(0);
      });
      it('single command with stderr',function(){
        ssh.on('stderr',(data)=>{
          data.trim().should.equal(testText);
        });
        return ssh.exec(`echo ${testText} >&2`).should.become(0);
      });
      it(`${numExec} times command execution after 1sec sleep`,async function(){
        this.timeout(0);
        let sshout=sinon.stub();
        let ssherr=sinon.stub();
        ssh.on('stdout', console.log);
        ssh.on('stderr', console.log);

        let promises=[];
        for(let i=0; i< numExec; i++){
          promises.push(ssh.exec(`sleep 1&& echo ${testText} ${i}`));
        }
        await Promise.all(promises);
        sshout.callCount.should.equal(numExec);
        sshout.callCount.should.equal(0);
      });
    });
    describe('file transfer', function(){
      this.timeout(10000);
      beforeEach(async function(){
        let promises=[]
        promises.push(clearRemoteTestFiles(pssh,sftp).then(createRemoteFiles.bind(null, pssh, sftp)));
        promises.push(clearLocalTestFiles().then(createLocalFiles));
        await Promise.all(promises);
      });
      after(async function(){
        let promises=[]
        promises.push(clearRemoteTestFiles(pssh,sftp));
        promises.push(clearLocalTestFiles());
        await Promise.all(promises);
      });

      describe('#send', function(){
        [
          {src: localFiles[0], dst: remoteEmptyDir, expected: ['foo']},
          {src: localFiles[0], dst: path.join(remoteEmptyDir,'hoge'), expected: ['hoge']},
        ].forEach(function(param){
          it('should send single file to server', async function(){
            await ssh.send(param.src, param.dst)
            let rt = await sftp.ls(param.dst);
            rt.should.have.members(param.expected);
          });
        });
        it('should send directory tree to server', async function(){
          await ssh.send(localRoot, remoteEmptyDir);
          let rt = await sftp.ls(remoteEmptyDir);
          rt.should.have.members(['foo', 'bar', 'baz', 'hoge', 'huga']);
          let rt2 = await sftp.ls(path.join(remoteEmptyDir, 'hoge'));
          rt2.should.have.members(['piyo', 'puyo', 'poyo']);
        });
      });
      describe('#recv', function(){
        this.timeout(10000);
        [
          {src: remoteFiles[0], dst: localEmptyDir, expected: ['foo']},
          {src: remoteFiles[0], dst: path.join(localEmptyDir,'hoge'), expected: ['hoge']},
        ].forEach(function(param){
          it('should recv single file from server', async function(){
            await ssh.recv(param.src, param.dst)
            debugger;
            let rt = await promisify(fs.readdir)(param.dst)
            rt.should.have.members(param.expected);
          });
        });
        it('should recv directory tree from server', async function(){
        });
      });
    });
  });
});
