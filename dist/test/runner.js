"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const fs = __importStar(require("fs"));
const glob = __importStar(require("glob"));
const lodash_1 = __importDefault(require("lodash"));
const path = __importStar(require("path"));
const index_1 = require("../src/index");
const promisify1 = (f) => {
    return (arg1) => new Promise((resolve, reject) => {
        f(arg1, (err, result) => {
            if (err) {
                return reject(err);
            }
            return resolve(result);
        });
    });
};
const readdir = promisify1(fs.readdir);
const readfile = promisify1(fs.readFile);
const EXPECTED_FILES = [
    "input.ts",
    "output.ts",
    "tsconfig.json",
    "tslint.json",
];
const logger = {
    log(m) {
        console.log(m);
    },
    error(m) {
        console.error(m);
    },
};
// For each test case directory, we expect to find
// three different files:
// 1. tslint.json - specifying the tslint rules to apply
// 2. input.ts - the initial input
// 3. output.ts - the expected output
// we run tslint-auto-disable on the input file, then compare
// it to the expected output file
const main = () => __awaiter(this, void 0, void 0, function* () {
    try {
        const testDirectories = glob
            .sync("test/cases/**/tslint.json")
            .map(path.dirname);
        for (const testdir of testDirectories) {
            const files = (yield readdir(testdir)).sort();
            if (!lodash_1.default.isEqual(files, EXPECTED_FILES)) {
                throw new Error(`Invalid test files in directory ${testdir}: [${files}] is not expected [${EXPECTED_FILES}]`);
            }
            const options = {
                project: `${testdir}/tsconfig.json`,
                files: [`${testdir}/input.ts`],
                exclude: [`${testdir}/output.ts`],
            };
            console.log(`running test ${testdir}`);
            const updatedSources = yield index_1.runReplacement(options, logger);
            const expectedSourceBuff = yield readfile(`${testdir}/output.ts`);
            const expectedSource = expectedSourceBuff.toString();
            chai_1.expect(updatedSources.size).to.equal(1);
            const key = collect(updatedSources.keys()).find((x) => x.endsWith("input.ts"));
            chai_1.expect(updatedSources.get(key)).to.equal(expectedSource);
        }
        process.exitCode = 0;
    }
    catch (e) {
        console.error(e.toString());
        process.exitCode = 1;
    }
});
const collect = (iter) => {
    const result = [];
    for (let val = iter.next(); !val.done; val = iter.next()) {
        result.push(val.value);
    }
    return result;
};
main();
