const path = require("path");

// setup test framework
const chai = require("chai");
const { expect } = require("chai");
const chaiAsPromised = require("chai-as-promised");
chai.use(chaiAsPromised);
// const sinon = require('sinon');
// const sinonChai = require("sinon-chai");
// chai.use(sinonChai);

// testee
const { isDirLocal, isFileLocal, getSizeLocal } = require("../lib/utils");

// test data
const { nonExisting, clearLocalTestFiles } = require("./testFiles");
const { createLocalFiles, localRoot } = require("./testFiles");

describe("utilty functions in ARssh", function() {
  beforeEach(async function() {
    await clearLocalTestFiles().then(createLocalFiles);
  });
  after(async function() {
    await clearLocalTestFiles();
  });

  describe("#isDirLocal", function() {
    [
      { arg: localRoot, expected: true },
      { arg: path.join(localRoot, "foo"), expected: false },
      { arg: nonExisting, expected: false }
    ].forEach(function(param) {
      it("should return true with dir", function() {
        let rt = isDirLocal(param.arg);
        return expect(rt).to.become(param.expected);
      });
    });
  });
  describe("#isFileLocal", function() {
    [
      { arg: localRoot, expected: false },
      { arg: path.join(localRoot, "foo"), expected: true },
      { arg: nonExisting, expected: false }
    ].forEach(function(param) {
      it("should return true with file", function() {
        let rt = isFileLocal(param.arg);
        return expect(rt).to.become(param.expected);
      });
    });
  });
  describe("#getSizeLocal", function() {
    [
      { arg: localRoot, expected: false },
      {
        arg: path.join(localRoot, "foo"),
        expected: path.join(localRoot, "foo").length + 1
      },
      { arg: nonExisting, expected: false }
    ].forEach(function(param) {
      it("should return size with file", function() {
        let rt = getSizeLocal(param.arg);
        return expect(rt).to.become(param.expected);
      });
    });
  });
});
