const util = require('util');
const fs = require('fs');
const path = require('path');

const chai = require('chai');
const chaiAsPromised = require("chai-as-promised");
chai.use(chaiAsPromised);
const assert = chai.assert;

const should = chai.should();

const del = require('del');

const PsshClient = require('../lib/PsshClient.js');
const {mput, isDir, realpath, mkdir_p, ls} = require('../lib/sftpUtil.js');

let config = require('./config');
let ssh = new PsshClient(config);

// define filenames
let localRoot = 'ARssh_testLocalDir'
let localDir2 = `${localRoot}/hoge`

let localFiles=[
  `${localRoot}/foo`,
  `${localRoot}/bar`,
  `${localRoot}/baz`,
  `${localRoot}/hoge/piyo`,
  `${localRoot}/hoge/puyo`,
  `${localRoot}/hoge/poyo`,
];

let remoteRoot = 'ARssh_testRemoteDir'
let remoteDir2 = `${remoteRoot}/hoge`
let remoteEmptyDir = `${remoteRoot}/huga`

let remoteFiles=[
  `${remoteRoot}/foo`,
  `${remoteRoot}/bar`,
  `${remoteRoot}/baz`,
  `${remoteRoot}/hoge/piyo`,
  `${remoteRoot}/hoge/puyo`,
  `${remoteRoot}/hoge/poyo`,
];
let nonExisting='ARSSH_nonExisting'

// setup/treadown for all tests
beforeEach(async function(){
  await ssh.connect();
});
afterEach(function(){
  ssh.disconnect();
});


describe('PsshClient', function(){
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

  describe.skip('#sftp',function(){
  });
});

describe('sftpUtil', function(){
  let sftp;
  let homedir;

  beforeEach(async function(){
    await ssh.connect();
    sftp = await ssh.sftp();

    // make sure any test files are not exist on both side
    await ssh.exec(`rm -fr ${localRoot} ${remoteRoot} ${nonExisting}`);
    await del(`${localRoot} ${remoteRoot} ${nonExisting}`);

    // create local files
    fs.mkdirSync(localRoot);
    fs.mkdirSync(localDir2);
    localFiles.forEach((localFile)=>{
      // after writeFile, all files contains its own filename
      fs.writeFileSync(localFile, localFile+'\n');
    });

    //create remote files
    await mkdir_p(sftp, `${remoteDir2}`).catch(()=>{});
    await mkdir_p(sftp, `${remoteEmptyDir}`).catch(()=>{});
    remoteFiles.forEach(async (remoteFile)=>{
      await ssh.exec(`touch ${remoteFile}`);
    });

    // get remote ${HOME}
    ssh.once('stdout', (data)=>{
      homedir=data.trim();
    })
    await ssh.exec('pwd');
    // TODO add pwd to sftpUtil and replace
    // sftpUtil.pwd('.')
  });

  afterEach(async function(){
    await ssh.exec(`rm -fr ${localRoot} ${remoteRoot} ${nonExisting}`);
    await del(localRoot);
    ssh.disconnect();
  });


  //
  // actual test start here !!
  //
  describe('#ls', function(){
    [
      {args: path.join(remoteRoot,nonExisting), expected: []},
      {args: path.join(remoteRoot,'foo'),       expected: ["foo"]},
      {args: remoteRoot,                        expected: ["foo", "bar", "baz", "hoge", "huga"]}
    ].forEach(function(param){
      it('should return directory contents', function(){
        let rt = ls(sftp, param.args);
        return rt.should.eventually.have.members(param.expected);
      });
    });
  });

  describe('#mput', function(){
    [
      {
        src: path.join(localRoot, 'foo'),
        dst: path.join(remoteRoot, 'foobar'),
        rt: ['foobar'],
        message: 'put single file and rename'
      },
      {
        src: path.join(localRoot, 'foo'),
        dst: remoteEmptyDir,
        rt: ['foo'],
        message: 'put single file to directory'
      },
      {
        src: localFiles,
        dst: remoteEmptyDir,
        rt: ["foo", "bar", "baz", "piyo", "puyo", "poyo"],
        message: 'put multi file and directory'
      },
    ].forEach(function(param){
      it('should put file and directories to server', function(){
        let promise = mput(sftp, param.src, param.dst)
          .then(async ()=>{
            let rt = await ls(sftp, param.dst);
            rt.should.have.members(param.rt, param.message)
          });
        return promise.should.be.fulfilled
      });
    });
    [
      {src: nonExisting, error: `ENOENT: no such file or directory, lstat '${nonExisting}'`},
      {src: localRoot, error: "src must be file"},
      {src: [localRoot], error: "all src is not file"},
    ].forEach(function(param){
      it('should reject when sending non existing file', function(){
        let promise = mput(sftp, param.src, remoteRoot)
        return promise.should.be.rejectedWith(param.error);
      });
    });
  });

  describe('#isDir', function(){
    it('should return true with dir', function(){
      let rt = isDir(sftp, remoteRoot);
      return Promise.all([
        rt.should.be.fulfilled,
        rt.should.not.be.rejected,
        rt.should.become(true)
      ])
    });
    it('should return false with file', function(){
      let rt = isDir(sftp, `${remoteRoot}/foo`);
      return Promise.all([
        rt.should.be.fulfilled,
        rt.should.not.be.rejected,
        rt.should.become(false)
      ])
    });
    it('should return false with nonExisting path', function(){
      let rt = isDir(sftp, nonExisting);
      return Promise.all([
        rt.should.be.fulfilled,
        rt.should.not.be.rejected,
        rt.should.become(false)
      ])
    });
  });

  describe('#mkdir_p', function(){
    it('should make child of existing directory', function(){
      let rt=mkdir_p(sftp, remoteRoot+'/hogehoge');
      return Promise.all([
        rt.should.be.fulfilled,
        rt.should.become(undefined)
      ]);
    });
    it('should make child dir of non-existing directory', function(){
      let tmpDirname=`${remoteRoot}/${nonExisting}/hogehoge/foo/bar/baz/huga`;
      let rt=mkdir_p(sftp, tmpDirname);
      return Promise.all([
        rt.should.be.fulfilled,
        rt.should.become(undefined)
      ]);
    });
    it('should cause error if making existing directory', function(){
      let rt=mkdir_p(sftp, remoteRoot);
      return Promise.all([
        rt.should.not.be.fulfilled,
        rt.should.be.rejectedWith('Failure')
      ]);
    });
    it.skip('should cause error if making child dir of not-owned directory', function(){
    });
  });

  describe.skip('#realpath is using promisify for now so skip all test', function(){
    it('should return absolute path on dir', function(){
      let rt = realpath(sftp, localRoot);
      return Promise.all([
        rt.should.be.fulfilled,
        rt.should.not.be.rejected,
        rt.should.become(path.resolve(homedir, localRoot))
      ])
    });
    it('should return absolute path on file', function(){
      let rt = realpath(sftp, testFilename);
      return Promise.all([
        rt.should.be.fulfilled,
        rt.should.not.be.rejected,
        rt.should.become(path.resolve(homedir, testFilename))
      ])
    });
    it('should return absolute path on nonExisting path', function(){
      let rt = realpath(sftp, nonExisting);
      return Promise.all([
        rt.should.be.fulfilled,
        rt.should.not.be.rejected,
        rt.should.become(path.resolve(homedir, nonExisting))
      ])
    });
    it('should rejected on child of nonExisting path', function(){
      let rt = realpath(sftp, nonExisting+'/hogehoge');
      return Promise.all([
        rt.should.not.be.fulfilled,
        rt.should.be.rejectedWith('No such file')
      ])
    });
  });

});

