import { expect } from "chai";
import * as fs from "fs";
import * as glob from "glob";
import _ from "lodash";
import * as path from "path";
import { runReplacement } from "../src";

const promisify1 = <T1, R>(
    f: (arg1: T1, cb: (err: NodeJS.ErrnoException, result: R) => void) => void
): ((arg1: T1) => Promise<R>) => {
    return (arg1: T1) =>
        new Promise((resolve, reject) => {
            f(arg1, (err, result) => {
                if (err) {
                    return reject(err);
                }
                return resolve(result);
            });
        });
};

const readdir = promisify1(fs.readdir);
const readfile = promisify1<string, Buffer>(fs.readFile);

const EXPECTED_FILES = [
    "input.ts",
    "output.ts",
    "tsconfig.json",
    "tslint.json",
];

// For each test case directory, we expect to find
// three different files:
// 1. tslint.json - specifying the tslint rules to apply
// 2. input.ts - the initial input
// 3. output.ts - the expected output
// we run tslint-auto-disable on the input file, then compare
// it to the expected output file
const main = async () => {
    try {
        const testDirectories = glob
            .sync("test/cases/**/tslint.json")
            .map(path.dirname);

        for (const testdir of testDirectories) {
            const files = (await readdir(testdir)).sort();
            if (!_.isEqual(files, EXPECTED_FILES)) {
                throw new Error(
                    `Invalid test files in directory ${testdir}: [${files}] is not expected [${EXPECTED_FILES}]`
                );
            }
            const options = {
                project: `${testdir}/tsconfig.json`,
                files: [`${testdir}/input.ts`],
                exclude: [`${testdir}/output.ts`],
            };
            console.log(`running test ${testdir}`);
            const updatedSources = await runReplacement(options);
            const expectedSourceBuff = await readfile(`${testdir}/output.ts`);
            const expectedSource = expectedSourceBuff.toString();
            expect(updatedSources.size).to.equal(1);
            const key = collect(updatedSources.keys()).find(x =>
                x.endsWith("input.ts")
            )!;
            expect(updatedSources.get(key)).to.equal(expectedSource);
        }
        process.exitCode = 0;
    } catch (e) {
        console.error(e.toString());
        process.exitCode = 1;
    }
};

const collect = <T>(iter: Iterator<T>): T[] => {
    const result: T[] = [];
    for (let val = iter.next(); !val.done; val = iter.next()) {
        result.push(val.value);
    }
    return result;
};

main();
