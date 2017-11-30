const fs = require('fs');
const path = require('path');

// setup test framework
const chai = require('chai');
const chaiAsPromised = require("chai-as-promised");
chai.use(chaiAsPromised);
const should = chai.should();

// testee
const {isDirLocal, isFileLocal, getSizeLocal} = require('../lib/utils');

// test data
const {nonExisting, clearLocalTestFiles} = require('./testFiles');
const {createLocalFiles, localRoot, localEmptyDir, localFiles} = require('./testFiles');

describe('utils functions in ARssh', function(){
  beforeEach(async function(){
    await clearLocalTestFiles();
    await createLocalFiles();
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
