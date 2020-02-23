"use strict";
const path = require("path");
const fs = require("fs-extra");

//setup test framework
const chai = require("chai");
const { expect } = require("chai");
const chaiAsPromised = require("chai-as-promised");
chai.use(chaiAsPromised);

//testee
const { isDirLocal, isFileLocal, getSizeLocal, getFileMode } = require("../lib/utils");

//test data
const { nonExisting, clearLocalTestFiles, createLocalFiles, localRoot, localFiles } = require("./util/testFiles");

describe("utilty functions in ARssh", ()=>{
  beforeEach(async()=>{
    await clearLocalTestFiles().then(createLocalFiles);
  });
  after(async()=>{
    await clearLocalTestFiles();
  });

  describe("#isDirLocal", ()=>{
    [
      { arg: localRoot, expected: true },
      { arg: path.join(localRoot, "foo"), expected: false },
      { arg: nonExisting, expected: false }
    ].forEach((param)=>{
      it("should return true with dir", async()=>{
        const rt = await isDirLocal(param.arg);
        expect(rt).to.equal(param.expected);
      });
    });
  });
  describe("#isFileLocal", ()=>{
    [
      { arg: localRoot, expected: false },
      { arg: path.join(localRoot, "foo"), expected: true },
      { arg: nonExisting, expected: false }
    ].forEach((param)=>{
      it("should return true with file", async()=>{
        const rt = await isFileLocal(param.arg);
        expect(rt).to.equal(param.expected);
      });
    });
  });
  describe("#getSizeLocal", ()=>{
    [
      { arg: localRoot, expected: false },
      {
        arg: path.join(localRoot, "foo"),
        expected: path.join(localRoot, "foo").length + 1
      },
      { arg: nonExisting, expected: false }
    ].forEach((param)=>{
      it("should return size with file", async()=>{
        const rt = await getSizeLocal(param.arg);
        expect(rt).to.equal(param.expected);
      });
    });
  });
  describe("#getFileMode", ()=>{
    localFiles.forEach((filename)=>{
      it("should return default file mode", async()=>{
        const perm = "412";
        await fs.chmod(filename, perm);
        const stats = await fs.stat(filename);
        const rt = getFileMode(stats.mode);
        expect(rt).to.equal(perm);
      });
    });
  });
});
