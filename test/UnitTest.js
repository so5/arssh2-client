const util = require('util');
const fs = require('fs');
const path = require('path');

const chai = require('chai');
const chaiAsPromised = require("chai-as-promised");
chai.use(chaiAsPromised);
const assert = chai.assert;
chai.should();

const PsshClient = require('../lib/PsshClient.js');
const {isDir, realpath, mkdir_p} = require('../lib/util.js');

let data = fs.readFileSync('test/ARsshTestSettings.json');
let configs = JSON.parse(data);
// change following lines to change ssh settings
let config = configs[1];
let keyFile = `${process.env.HOME}/.ssh/id_rsa`;

config.privateKey = fs.readFileSync(keyFile).toString();
//config.debug=console.log  // enable if you need ssh2's debug log to console


let ssh = new PsshClient(config);
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
});

describe('sftpUtil', function(){
  let sftp;
  //TODO should be checkd with absolute path
  let testDirname='ARssh_testDir'
  let testFilename='ARSSH_testFile'
  let nonExisting='ARSSH_nonExistingPath'
  let homedir;
  beforeEach(async function(){
    await ssh.connect();
    sftp = await ssh.sftp();
    await ssh.exec(`rm -fr ${testDirname} ${testFilename} ${nonExisting} && mkdir ${testDirname} && touch ${testFilename}`);
    ssh.once('stdout', (data)=>{
      homedir=data.trim();
    })
    await ssh.exec('pwd');
  });
  afterEach(async function(){
    await ssh.exec(`rm -fr ${testDirname} ${testFilename}`);
    ssh.disconnect();
  });
  describe('#isDir', function(){
    it('should return true with dir', function(){
      let rt = isDir(sftp, testDirname);
      return Promise.all([
        rt.should.be.fulfilled,
        rt.should.not.be.rejected,
        rt.should.become(true)
      ])
    });
    it('should return false with file', function(){
      let rt = isDir(sftp, testFilename);
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

  describe('#realpath', function(){
    it('should return absolute path on dir', function(){
      let rt = realpath(sftp, testDirname);
      return Promise.all([
        rt.should.be.fulfilled,
        rt.should.not.be.rejected,
        rt.should.become(path.resolve(homedir, testDirname))
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

  describe('#mkdir_p', function(){
    it('should make child of existing directory', function(){
      let rt=mkdir_p(sftp, testDirname+'/hogehoge');
      return Promise.all([
        rt.should.be.fulfilled,
        rt.should.not.be.rejected,
        rt.should.become(0)
      ]);
    });
    it('should make child dir of non-existing directory', function(){
      let tmpDirname=nonExisting+'/hogehoge/foo/bar/baz/huga';
      let rt=mkdir_p(sftp, tmpDirname);
      return Promise.all([
        rt.should.be.fulfilled,
        rt.should.not.be.rejected,
        rt.should.become(0)
      ]);
    });
    it('should cause error if making existing directory', function(){
      let rt=mkdir_p(sftp, testDirname);
      return Promise.all([
        rt.should.not.be.fulfilled,
        rt.should.be.rejectedWith('Failure')
      ]);
    });
    it.skip('should cause error if making child dir of not-owned directory', function(){
    });
  });

});

