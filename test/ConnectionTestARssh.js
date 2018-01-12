const {promisify} = require('util');
const fs = require('fs');
const path = require('path');

// setup test framework
const chai = require('chai');
const {expect} = require('chai');
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

//process.on('unhandledRejection', console.dir);

describe.skip('ARsshClient connection test', function(){
  this.timeout(20000);
  let arssh;
  let sshout=sinon.stub();
  let ssherr=sinon.stub();
  before(async function(){
    let pssh = new PsshClient(config);
    await pssh.connect();
    let sftpStream = await pssh.sftp();
    let sftp = new SftpUtil(sftpStream);
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
    let sftpStream = await pssh.sftp();
    let sftp = new SftpUtil(sftpStream);
    let promises=[]
    promises.push(clearRemoteTestFiles(pssh,sftp));
    promises.push(clearLocalTestFiles());
    await Promise.all(promises);
    pssh.disconnect();
  });

  describe('#canConnect', function(){
    it('should be resolved with true', function(){
      let rt = arssh.canConnect();
      return expect(rt).to.become(true);
    });
    it('should be rejected if connection failed', function(){
      let config2 = Object.assign({}, config);
      config2.username='xxxxx';
      let arssh2 = new ARsshClient(config2, {delay: 1000, connectionRetryDelay: 100});
      let rt = arssh2.canConnect();
      return expect(rt).to.be.rejected;
    });
  });

  describe('#exec', function(){
    let testText = 'hoge';
    let numExec = 50;

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
      this.timeout(0);
      let promises=[];
      for(let i=0; i< numExec; i++){
        promises.push(arssh.exec(`sleep 1&& echo ${testText} ${i}`));
      }
      let rt=await Promise.all(promises);

      // check if all return value is 0
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
    it.skip(`${numExec} times command execution after 10sec sleep`,async function(){
      this.timeout(0);
      let promises=[];
      for(let i=0; i< numExec; i++){
        promises.push(arssh.exec(`sleep 10&& echo ${testText} ${i}`));
      }
      let rt=await Promise.all(promises);

      // check if all return value is 0
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
    it('should return absolute path of existing directory', async function(){
      let remoteHome = await arssh.realpath('.');
      let rt=arssh.realpath(remoteRoot);
      return expect(rt).to.become(path.posix.join(remoteHome, remoteRoot));
    });
    it('should return absolute path of existing file', async function(){
      let remoteHome = await arssh.realpath('.');
      let rt=arssh.realpath(remoteFiles[0]);
      return expect(rt).to.become(path.posix.join(remoteHome, remoteFiles[0]));
    });
    it('should return absolute path of not-existing file', async function(){
      let remoteHome = await arssh.realpath('.');
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
        return expect(rt).to.eventually.have.members(param.expected);
      });
    });
  });


  describe('test with file/directory operation', function(){
    let sftp;
    let pssh;
    beforeEach(async function(){
      pssh = new PsshClient(config);
      await pssh.connect();
      let sftpStream = await pssh.sftp();
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

    describe('#chmod', function(){
      it('should change file mode', async function(){
        await arssh.chmod(remoteFiles[0], '700');
        let tmp = await sftp.readdir(remoteRoot);
        let tmp2 = tmp.find((e)=>{
          return e.filename === path.posix.basename(remoteFiles[0]);
        });
        expect(tmp2.longname.startsWith('-rwx------ ')).to.be.true;
      });
    });
    describe('#mkdir_p', function(){
      it('should make child of existing directory', function(){
        let rt=arssh.mkdir_p(remoteRoot+'/hogehoge');
        return expect(rt).to.become(undefined);
      });
      it('should make child dir of non-existing directory with trailing pathsep', function(){
        let tmpDirname=`${remoteRoot}/${nonExisting}/hogehoge/foo/bar/baz/huga/`;
        let rt=arssh.mkdir_p(tmpDirname);
        return expect(rt).to.become(undefined);
      });
      it('should make child dir of non-existing directory', function(){
        let tmpDirname=`${remoteRoot}/${nonExisting}/hogehoge/foo/bar/baz/huga`;
        let rt=arssh.mkdir_p(tmpDirname);
        return expect(rt).to.become(undefined);
      });
      it('should resolve with undefined if making existing directory', function(){
        let rt=arssh.mkdir_p(remoteRoot);
        return expect(rt).to.become(undefined);
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
        {src: localFiles[0], dst: path.posix.join(remoteEmptyDir,'hoge'), expected: ['hoge']},
      ].forEach(function(param){
        it('should send single file to server', async function(){
          await arssh.send(param.src, param.dst);

          let rt = await sftp.ls(param.dst);
          expect(rt).to.have.members(param.expected);
        });
      });
      it.skip('should send single file to server with keep file permission(can not work on windows)', async function(){
        let perm='633';
        await promisify(fs.chmod)(localFiles[0], perm);
        await arssh.send(localFiles[0], remoteEmptyDir);

        let rt = await sftp.stat(path.posix.join(remoteEmptyDir, 'foo'));
        let permission = (rt.mode & parseInt(777,8)).toString(8);
        expect(permission).to.be.equal(perm);
      });
      it('should send directory tree to server', async function(){
        await arssh.send(localRoot, remoteEmptyDir);

        let rt = await sftp.ls(remoteEmptyDir);
        expect(rt).to.have.members(['foo', 'bar', 'baz', 'hoge', 'huga']);
        let rt2 = await sftp.ls(path.posix.join(remoteEmptyDir, 'hoge'));
        expect(rt2).to.have.members(['piyo', 'puyo', 'poyo']);
      });
      it.skip('should send directory tree to server with keep file permission(can not work on windows)', async function(){
        let perm='633';
        await promisify(fs.chmod)(localFiles[0], perm);
        await arssh.send(localRoot, remoteEmptyDir);

        let rt = await sftp.ls(remoteEmptyDir);
        expect(rt).to.have.members(['foo', 'bar', 'baz', 'hoge', 'huga']);
        let rt2 = await sftp.ls(path.posix.join(remoteEmptyDir, 'hoge'));
        expect(rt2).to.have.members(['piyo', 'puyo', 'poyo']);
        let rt3 = await sftp.stat(path.posix.join(remoteEmptyDir, 'foo'));
        let permission = (rt3.mode & parseInt(777,8)).toString(8);
        expect(permission).to.be.equal(perm);
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
