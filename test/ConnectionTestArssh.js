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
const SftpUtil  = require('../lib/sftpUtils.js');

let config = require('./config');
const {nonExisting, clearLocalTestFiles, clearRemoteTestFiles} = require('./testFiles');
const {createLocalFiles, localRoot, localEmptyDir, localFiles} = require('./testFiles');
const {createRemoteFiles, remoteRoot,remoteEmptyDir,remoteFiles} = require('./testFiles');


process.on('unhandledRejection', console.dir);

describe('arssh connection test', function(){
  let arssh;
  let sshout=sinon.stub();
  let ssherr=sinon.stub();
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

  describe('#exec', function(){
    this.timeout(4000);
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
    this.timeout(10000);
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

  describe('file transfer', function(){
    this.timeout(10000);
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
      this.timeout(10000);
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
