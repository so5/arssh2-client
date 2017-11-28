const util = require('util');
const fs = require('fs');
const path = require('path');

const chai = require('chai');
const chaiAsPromised = require("chai-as-promised");
chai.use(chaiAsPromised);
const assert = chai.assert;
chai.should();

const del = require('del');

const PsshClient = require('../lib/PsshClient.js');
const {mput, isDir, realpath, mkdir_p, ls} = require('../lib/util.js');

let config = require('./config');


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

  describe('#mput', function(){
    let localFiles=[
      `${testDirname}/foo`,
      `${testDirname}/bar`,
      `${testDirname}/baz`,
      `${testDirname}/hoge/huga`,
      `${testDirname}/hoge/piyo`,
      `${testDirname}/hoge/poyo`,
    ];
    let testDirname2=`${testDirname}2`;
    beforeEach(async function(){
      fs.mkdirSync(testDirname);
      fs.mkdirSync(path.resolve(testDirname, 'hoge'));
      localFiles.forEach((localFile)=>{
        // after writeFile, all files contains its own filename
        fs.writeFileSync(localFile, localFile);
      });
      await mkdir_p(sftp, `${testDirname2}/${testDirname2}`).catch(()=>{});
      await ssh.exec(`touch ${testDirname2}/hoge`);
    });
    afterEach(async function(){
      await del(testDirname);
      // await ssh.exec(`rm -fr ${testDirname2}`);
    });

    describe.only('#ls', function(){
      it('should get empty array when listing empty directory', function(){
        let rt = ls(sftp, `${testDirname2}/${testDirname2}`);
        return Promise.all([
          rt.should.be.fulfilled,
          rt.should.not.be.rejected,
          rt.should.become([])
        ])
      });
      it('should get filename when listing existing file', function(){
        let rt = ls(sftp, `${testDirname2}/hoge`);
        return Promise.all([
          rt.should.be.fulfilled,
          rt.should.not.be.rejected,
          rt.should.become(["hoge"])
        ])
      });
      it('should get names when listing existing directory which contain filename and directories', function(){
        let rt = ls(sftp, `${testDirname2}`);
        return Promise.all([
          rt.should.be.fulfilled,
          rt.should.not.be.rejected,
          rt.should.eventually.be.a('array'),
          rt.should.eventually.be.lengthOf(2),
          rt.should.eventually.have.members(["hoge",`${testDirname2}`])
        ])
      });
    });

    it('should put single file to server', function(){
      let src=path.join(testDirname, 'foo');
      let rt = mput(sftp, src, 'foo');
      return Promise.all([
        rt.should.be.fulfilled,
        rt.should.not.be.rejected,
        rt.should.become(undefined)
      ])
    });
    it('should put single file to server and rename', function(){
      let src=path.join(testDirname, 'foo');
      let rt = mput(sftp, src, 'bar');
      return Promise.all([
        rt.should.be.fulfilled,
        rt.should.not.be.rejected,
        rt.should.become(undefined)
      ])
    });
    it('should put single file to existing directory on the server', async function(){
      let src=path.join(testDirname, 'foo');
      let dst = `${testDirname}2`;
      let rt = mput(sftp, src, dst);
      return Promise.all([
        rt.should.be.fulfilled,
        rt.should.not.be.rejected,
        rt.should.become(undefined)
      ])
    });
    it.skip('should put multi file to server', function(){
      let src=localFiles;
      let rt = mput(sftp, src, './');
      return Promise.all([
        rt.should.be.fulfilled,
        rt.should.not.be.rejected,
        rt.should.become(undefined)
      ]);
    });
    it('should put files in the specified directory to server', function(){
      let src=testDirname;
      let rt = mput(sftp, src, './');
      return Promise.all([
        rt.should.be.fulfilled,
        rt.should.not.be.rejected,
        rt.should.become(undefined)
      ]);
    });


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

  describe('#mkdir_p', function(){
    it('should make child of existing directory', function(){
      let rt=mkdir_p(sftp, testDirname+'/hogehoge');
      return Promise.all([
        rt.should.be.fulfilled,
        rt.should.not.be.rejected,
        rt.should.become(undefined)
      ]);
    });
    it('should make child dir of non-existing directory', function(){
      let tmpDirname=nonExisting+'/hogehoge/foo/bar/baz/huga';
      let rt=mkdir_p(sftp, tmpDirname);
      return Promise.all([
        rt.should.be.fulfilled,
        rt.should.not.be.rejected,
        rt.should.become(undefined)
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

  describe.skip('#realpath is using promisify for now so skip all test', function(){
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

});

