const fs = require('fs');
const path = require('path');

// setup test framework
const chai = require('chai');
const should = chai.should();
const chaiAsPromised = require("chai-as-promised");
chai.use(chaiAsPromised);
const sinon = require('sinon');
const sinonChai = require("sinon-chai");
chai.use(sinonChai);

// testee
const {isDirLocal, isFileLocal, getSizeLocal} = require('../lib/utils');

// test data
const {nonExisting, clearLocalTestFiles} = require('./testFiles');
const {createLocalFiles, localRoot, localEmptyDir, localFiles} = require('./testFiles');

describe('utilty functions in ARssh', function(){
  beforeEach(async function(){
    await clearLocalTestFiles().then(createLocalFiles)
  });
  after(async function(){
    await clearLocalTestFiles();
  });

  describe('#isDirLocal', function(){
    [
      {arg: localRoot, expected: true},
      {arg: path.join(localRoot, 'foo'), expected: false},
      {arg: nonExisting, expected: false}
    ].forEach(function (param){
      it('should return true with dir', function(){
        let rt = isDirLocal(param.arg);
        return rt.should.become(param.expected)
      });
    });
  });
  describe('#isFileLocal', function(){
    [
      {arg: localRoot, expected: false},
      {arg: path.join(localRoot, 'foo'), expected: true},
      {arg: nonExisting, expected: false}
    ].forEach(function (param){
      it('should return true with file', function(){
        let rt = isFileLocal(param.arg);
        return rt.should.become(param.expected)
      });
    });
  });
  describe('#getSizeLocal', function(){
    [
      {arg: localRoot, expected: false},
      {arg: path.join(localRoot, 'foo'), expected: path.join(localRoot, 'foo').length+1},
      {arg: nonExisting, expected: false}
    ].forEach(function (param){
      it('should return size with file', function(){
        let rt = getSizeLocal(param.arg);
        return rt.should.become(param.expected)
      });
    });
  });
});
