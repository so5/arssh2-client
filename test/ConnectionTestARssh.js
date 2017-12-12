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

describe('ARsshClient connection test', function(){
  this.timeout(20000);
  let arssh;
  let sshout=sinon.stub();
  let ssherr=sinon.stub();
  before(async function(){
    let pssh = new PsshClient(config);
    await pssh.connect();
    sftpStream = await pssh.sftp();
    sftp = new SftpUtil(sftpStream);
    let promises=[]
    promises.push(clearRemoteTestFiles(pssh,sftp).then(createRemoteFiles.bind(null, pssh, sftp)));
    promises.push(clearLocalTestFiles().then(createLocalFiles));
    await Promise.all(promises);
    pssh.disconnect();
  });
  beforeEach(function(){
    arssh = new ARsshClient(config, {delay: 1000, connectionRetryDelay: 100});
    arssh.on('stdout', sshout)
    arssh.on('stderr', ssherr)
  });
  afterEach(function(){
    arssh.disconnect();
    sshout.reset();
    ssherr.reset();
  });
  after(async function(){
    let pssh = new PsshClient(config);
    await pssh.connect();
    sftpStream = await pssh.sftp();
    sftp = new SftpUtil(sftpStream);
    let promises=[]
    promises.push(clearRemoteTestFiles(pssh,sftp));
    promises.push(clearLocalTestFiles());
    await Promise.all(promises);
    pssh.disconnect();
  });

  describe('#canConnect', function(){
    it('should return true', function(){
      let rt = arssh.canConnect();
      return expect(rt).to.become(true);
    });
  });

  describe('#exec', function(){
    let testText = 'hoge';
    let numExec = 20;

    it('single command with stdout', async function(){
      let rt=await arssh.exec(`echo ${testText}`);
      expect(rt).to.equal(0);
      expect(sshout).to.be.calledOnce;
      expect(sshout).to.be.calledWith(Buffer.from(testText+'\n'));
      expect(ssherr).not.to.be.called;
    });
    it('single command with stderr', async function(){
      let rt=await arssh.exec(`echo ${testText} >&2`);
      expect(rt).to.equal(0);
      expect(sshout).not.to.be.called;
      expect(ssherr).to.be.calledOnce;
      expect(ssherr).to.be.calledWith(Buffer.from(testText+'\n'));
    });
    it(`${numExec} times command execution after 1sec sleep`,async function(){
      let promises=[];
      for(let i=0; i< numExec; i++){
        promises.push(arssh.exec(`sleep 1&& echo ${testText} ${i}`));
      }
      let rt=await Promise.all(promises);

      // check return value
      expect(rt).to.have.lengthOf(numExec);
      rt=Array.from(new Set(rt));
      expect(rt).to.have.lengthOf(1);
      expect(rt).to.include(0);

      // check output of ssh
      expect(ssherr).not.to.be.called;
      expect(sshout.args).to.have.lengthOf(numExec);
      let results=sshout.args.map((e)=>{
        return e[0].toString();
      });

      let expectedResults=[]
      for(let i=0; i< numExec; i++){
        expectedResults.push(`${testText} ${i}`+'\n');
      }
      expect(results).to.have.members(expectedResults);
    });
  });

  describe('#realpath', function(){
    let remoteHome = '/volume2/home/aics-hud/a05013/';
    it('should return absolute path of existing directory', function(){
      let rt=arssh.realpath(remoteRoot);
      return expect(rt).to.become(path.posix.join(remoteHome, remoteRoot));
    });
    it('should return absolute path of existing file', function(){
      let rt=arssh.realpath(remoteFiles[0]);
      return expect(rt).to.become(path.posix.join(remoteHome, remoteFiles[0]));
    });
    it('should return absolute path of not-existing file', function(){
      let rt=arssh.realpath(path.posix.join(remoteRoot, nonExisting));
      return expect(rt).to.become(path.posix.join(remoteHome, remoteRoot, nonExisting));
    });
  });

  describe('#ls', function(){
    [
      {args: path.join(remoteRoot,nonExisting), expected: []},
      {args: path.join(remoteRoot,'foo'),       expected: ["foo"]},
      {args: remoteRoot,                        expected: ["foo", "bar", "baz", "hoge", "huga"]}
    ].forEach(function(param){
      it('should return array of filenames', function(){
        let rt = arssh.ls( param.args);
        return rt.should.eventually.have.members(param.expected);
      });
    });
  });


  describe('test with file/directory operation', function(){
    let pssh;
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
      pssh.disconnect();
    });

    describe('#mkdir_p', function(){
      it('should make child of existing directory', function(){
        let rt=arssh.mkdir_p(remoteRoot+'/hogehoge');
        return rt.should.become(undefined);
      });
      it('should make child dir of non-existing directory with trailing pathsep', function(){
        let tmpDirname=`${remoteRoot}/${nonExisting}/hogehoge/foo/bar/baz/huga/`;
        let rt=arssh.mkdir_p(tmpDirname);
        return rt.should.become(undefined);
      });
      it('should make child dir of non-existing directory', function(){
        let tmpDirname=`${remoteRoot}/${nonExisting}/hogehoge/foo/bar/baz/huga`;
        let rt=arssh.mkdir_p(tmpDirname);
        return rt.should.become(undefined);
      });
      it('should resolve with undefined if making existing directory', function(){
        let rt=arssh.mkdir_p(remoteRoot);
        return rt.should.become(undefined);
      });
      it('should rejected if target path is existing file', function(){
        let rt=arssh.mkdir_p(remoteFiles[0]);
        return expect(rt).to.be.rejected;
      });
      it.skip('should cause error if making child dir of not-owned directory', function(){
      });
    });

    describe('#send', function(){
      [
        {src: localFiles[0], dst: remoteEmptyDir, expected: ['foo']},
        {src: localFiles[0], dst: path.join(remoteEmptyDir,'hoge'), expected: ['hoge']},
      ].forEach(function(param){
        it('should send single file to server', async function(){
          await arssh.send(param.src, param.dst)

          let rt = await sftp.ls(param.dst);
          expect(rt).to.have.members(param.expected);
        });
      });
      it('should send directory tree to server', async function(){
        await arssh.send(localRoot, remoteEmptyDir);

        let rt = await sftp.ls(remoteEmptyDir);
        expect(rt).to.have.members(['foo', 'bar', 'baz', 'hoge', 'huga']);
        let rt2 = await sftp.ls(path.join(remoteEmptyDir, 'hoge'));
        expect(rt2).to.have.members(['piyo', 'puyo', 'poyo']);
      });
    });

    describe('#recv', function(){
      it('should get single file into specific dir', async function(){
        await arssh.recv(remoteFiles[0], localEmptyDir)

        let rt = await promisify(fs.readdir)(localEmptyDir)
        expect(rt).to.have.members(['foo']);
      });
      it('should get single file from server with different rename', async function(){
        await arssh.recv(remoteFiles[0], path.join(localEmptyDir,'hoge'))

        let rt = await promisify(fs.readdir)(localEmptyDir)
        expect(rt).to.have.members(['hoge']);
      });
      it('should recv directory tree from server', async function(){
        await arssh.recv(remoteRoot, localEmptyDir);

        let rt = await promisify(fs.readdir)(localEmptyDir)
        expect(rt).to.have.members(['foo', 'bar', 'baz', 'hoge', 'huga']);
        rt = await promisify(fs.readdir)(path.join(localEmptyDir, 'hoge'));
        expect(rt).to.have.members(['piyo', 'puyo', 'poyo']);
      });
    });
  });
});
