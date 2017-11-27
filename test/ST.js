const assert = require('assert');
const util = require('util');
const fs = require('fs');

const sshClient = require('../lib/index.js');

describe('ARssh2', function(){
  this.timeout(10000);
  let ssh=null;

  let data = fs.readFileSync('test/ARsshTestSettings.json');
  let configs = JSON.parse(data);

  // change following lines to change ssh settings
  let config = configs[1];
  let keyFile = `${process.env.HOME}/.ssh/id_rsa`;

  config.privateKey = fs.readFileSync(keyFile).toString();
  //config.debug=console.log  // enable if you need ssh2's debug log to console


  beforeEach(function(){
    ssh = new sshClient(config);
  });
  afterEach(function(){
    ssh.disconnect();
  });

  describe('#exec', function(){
    let testText = 'hoge';

    it('single command with stdout',async function(){
      ssh.on('stdout',(data)=>{
        assert.equal(data, testText);
      });
      ssh.exec(`echo ${testText}`);
    });
    it('single command with stderr',async function(){
      ssh.on('stderr',(data)=>{
        assert.equal(data, testText);
      });
      ssh.exec(`echo ${testText} >&2`);
    });
    it.skip('80 times command execution after 1sec sleep',async function(){
      try{
        for(let i=0; i< 80; i++){
          ssh.on('stdout ',(data)=>{
            assert.equal(data, testText);
          });
          ssh.exec(`sleep 1&& echo ${testText}`);
        }
      }
      catch(e){
        assert.fail();
      }
    });
  });
  describe('#send', function(){
    let testFilename = 'foo'
    let testfileContent= 'bar'

    let ls = async (filename)=>{
      let result;
      ssh.on('stdout', (data)=>{
        result=data;
      })
      await ssh.exec(`ls ${filename}`).catch((e)=>{console.log(e)});
      return result;
    }
    let cat = async (filename)=>{
      let result;
      ssh.on('stdout', (data)=>{
        result=data;
      })
      await ssh.exec(`cat ${filename}`).catch((e)=>{console.log(e)});
      return result;
    }

    beforeEach(function(){
      fs.writeFileSync(testFilename, testfileContent);
    });
    afterEach(function(){
      fs.unlinkSync(testFilename);
    });

    it('should accept relative src filename and relative dst filename', async function(){
      let dst='foo';

      await ssh.send(testFilename, dst);

      let remoteFilename=dst;
      assert.equal(`${remoteFilename}\n`, await ls(remoteFilename));
      assert.equal(testfileContent, await cat(remoteFilename));

      await ssh.exec(`rm -fr ${dst}`);
    });
    it('should accept relative src filename and relative dst directory', async function(){
      let dst='test/'
      await ssh.exec('mkdir test');

      await ssh.send(testFilename, dst).catch((e)=>{console.log(e)});

      let remoteFilename='test/foo';
      assert.equal(`${remoteFilename}\n`, await ls(remoteFilename));
      assert.equal(testfileContent, await cat(remoteFilename));

      await ssh.exec(`rm -fr ${dst}`);
    });
  });
});
