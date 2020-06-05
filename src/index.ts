import commander from "commander";
import * as fs from "fs";
import * as glob from "glob";
import { filter as createMinimatchFilter, Minimatch } from "minimatch";
import * as path from "path";
import { Configuration, Linter, LintResult, Replacement, Utils } from "tslint";
import * as ts from "typescript";
import { SourceFile } from "typescript";
import { Argv, getInputArguments, Options } from "./command";
import { removeTslintComments } from "./lintUtils";

const { findConfiguration } = Configuration;
const { arrayify } = Utils;

export const enum Status {
    Ok = 0,
    FatalError = 1,
    LintError = 2,
}

export interface Logger {
    log(message: string): void;

    error(message: string): void;
}

export async function run(options: Options): Promise<Status> {
    return runWorker(options);
}

async function runWorker(options: Options): Promise<Status> {
    if (options.config && !fs.existsSync(options.config)) {
        throw new Error(`Invalid option for configuration: ${options.config}`);
    }

    const updatedSources = await runReplacement(options);
    writeUpdateSourceFiles(updatedSources);
    return Status.Ok;
}

function removePreviousTslintDisableComment(options: Options) {
    const { files, program } = resolveFilesAndProgram(options);

    files.forEach(filename => {
        const fileContent = program.getSourceFile(filename);
        const contentWithoutTslintDisableLineComment = removeTslintComments(
            fileContent as SourceFile
        );
        fs.writeFileSync(filename, contentWithoutTslintDisableLineComment);
    });
}

export async function runReplacement(
    options: Options
): Promise<Map<string, string>> {
    removePreviousTslintDisableComment(options);

    const { files, program } = resolveFilesAndProgram(options);
    const lintResult = await doLinting(options, files, program);
    return insertTslintDisableComments(program, lintResult);
}

function createTsProgram(projectPath: string) {
    const program = Linter.createProgram(projectPath);
    const diagnostics = ts.getPreEmitDiagnostics(program);
    if (diagnostics.length !== 0) {
        const message = diagnostics
            .map(d => showDiagnostic(d, program))
            .join("\n");
        throw new Error(message);
    }
    return program;
}

function resolveFilesAndProgram({
    files,
    project,
    exclude,
}: Options): { files: string[]; program: ts.Program } {
    // remove single quotes which break matching on Windows when glob is passed in single quotes
    exclude = exclude.map(trimSingleQuotes);

    const projectPath = findTsconfig(project);
    if (projectPath === undefined) {
        throw new Error(`Invalid option for project: ${project}`);
    }

    exclude = exclude.map(pattern => path.resolve(pattern));
    const program = createTsProgram(projectPath);
    let filesFound: string[];
    if (files.length === 0) {
        filesFound = filterFiles(Linter.getFileNames(program), exclude, false);
    } else {
        files = files.map(f => path.resolve(f));
        filesFound = filterFiles(
            program.getSourceFiles().map(f => f.fileName),
            files,
            true
        );
        filesFound = filterFiles(filesFound, exclude, false);

        // find non-glob files that have no matching file in the project and are not excluded by any exclude pattern
        for (const file of filterFiles(files, exclude, false)) {
            if (
                !glob.hasMagic(file) &&
                !filesFound.some(createMinimatchFilter(file))
            ) {
                if (fs.existsSync(file)) {
                    throw new Error(`'${file}' is not included in project.`);
                }
                // TODO make this an error in v6.0.0
                throw new Error(
                    `'${file}' does not exist. This will be an error in TSLint 6.\n`
                );
            }
        }
    }
    return { files: filesFound, program };
}

function filterFiles(
    files: string[],
    patterns: string[],
    include: boolean
): string[] {
    if (patterns.length === 0) {
        return include ? [] : files;
    }
    // `glob` always enables `dot` for ignore patterns
    const matcher = patterns.map(
        pattern => new Minimatch(pattern, { dot: !include })
    );
    return files.filter(
        file => include === matcher.some(pattern => pattern.match(file))
    );
}

async function doLinting(
    options: Options,
    files: string[],
    program: ts.Program | undefined
): Promise<LintResult> {
    const linter = new Linter(
        {
            fix: false,
            rulesDirectory: options.rulesDirectory,
        },
        program
    );

    let lastFolder: string | undefined;
    let configFile =
        options.config !== undefined
            ? findConfiguration(options.config).results
            : undefined;

    for (const file of files) {
        if (options.config === undefined) {
            const folder = path.dirname(file);
            if (lastFolder !== folder) {
                configFile = findConfiguration(null, folder).results;
                lastFolder = folder;
            }
        }
        if (isFileExcluded(file)) {
            continue;
        }

        const contents =
            program !== undefined
                ? program.getSourceFile(file)!.text
                : await tryReadFile(file);

        if (contents !== undefined) {
            linter.lint(file, contents, configFile);
        }
    }

    return linter.getResult();

    function isFileExcluded(filepath: string) {
        if (
            configFile === undefined ||
            configFile.linterOptions == undefined ||
            configFile.linterOptions.exclude == undefined
        ) {
            return false;
        }
        const fullPath = path.resolve(filepath);
        return configFile.linterOptions.exclude.some((pattern: any) =>
            new Minimatch(pattern).match(fullPath)
        );
    }
}

function getLineBreak(fileContent: string) {
    if (fileContent.includes("\r\n")) {
        return "\r\n";
    }
    return "\n";
}

export const insertTslintDisableComments = (
    program: ts.Program,
    result: LintResult
) => {
    const filesAndFixes = new Map<string, [number, Replacement][]>();
    result.failures.forEach(input => {
        const fileName = input.getFileName();
        const line = input.getStartPosition().getLineAndCharacter().line;
        const sourceFile = program.getSourceFile(fileName)!;
        const insertPos = sourceFile.getLineStarts()[line];
        const lineEnd = sourceFile.getLineEndOfPosition(insertPos);
        const maybeIndent = /^\s*/.exec(
            sourceFile.text.substring(insertPos, lineEnd)
        );

        const indent = maybeIndent != undefined ? maybeIndent[0] : "";
        const fix = Replacement.appendText(
            insertPos,
            `${indent}// tslint:disable-next-line${getLineBreak(
                sourceFile.text
            )}`
        );
        const fixes = filesAndFixes.get(fileName);
        if (fixes == undefined) {
            filesAndFixes.set(fileName, [[line, fix]]);
        } else if (fixes.findIndex(oldfix => oldfix[0] === line) < 0) {
            fixes.push([line, fix]);
            filesAndFixes.set(fileName, fixes);
        }
        // otherwise there is already a fix for the current line
    });

    const updatedSources = new Map<string, string>();
    filesAndFixes.forEach((fixes, filename) => {
        const source = program.getSourceFile(filename)!.text;
        updatedSources.set(
            filename,
            Replacement.applyAll(source, fixes.map(x => x[1]))
        );
    });

    return updatedSources;
};

export const writeUpdateSourceFiles = (updatedSources: Map<string, string>) => {
    updatedSources.forEach((source, filename) => {
        fs.writeFileSync(filename, source);
    });
};

/** Read a file, but return undefined if it is an MPEG '.ts' file. */
async function tryReadFile(filename: string): Promise<string | undefined> {
    if (!fs.existsSync(filename)) {
        throw new Error(`Unable to open file: ${filename}`);
    }
    const buffer = new Buffer(256);
    const fd = fs.openSync(filename, "r");
    try {
        fs.readSync(fd, buffer, 0, 256, 0);
        if (
            buffer.readInt8(0, true) === 0x47 &&
            buffer.readInt8(188, true) === 0x47
        ) {
            // MPEG transport streams use the '.ts' file extension. They use 0x47 as the frame
            // separator, repeating every 188 bytes. It is unlikely to find that pattern in
            // TypeScript source, so tslint ignores files with the specific pattern.
            throw new Error(`${filename}: ignoring MPEG transport stream\n`);
        }
    } finally {
        fs.closeSync(fd);
    }

    return fs.readFileSync(filename, "utf8");
}

function showDiagnostic(
    { file, start, category, messageText }: ts.Diagnostic,
    program: ts.Program,
    outputAbsolutePaths?: boolean
): string {
    let message = ts.DiagnosticCategory[category];
    if (file !== undefined && start !== undefined) {
        const { line, character } = file.getLineAndCharacterOfPosition(start);
        const currentDirectory = program.getCurrentDirectory();
        const filePath = outputAbsolutePaths
            ? path.resolve(currentDirectory, file.fileName)
            : path.relative(currentDirectory, file.fileName);
        message += ` at ${filePath}:${line + 1}:${character + 1}:`;
    }
    return `${message} ${ts.flattenDiagnosticMessageText(messageText, "\n")}`;
}

function trimSingleQuotes(str: string): string {
    return str.replace(/^'|'$/g, "");
}

function findTsconfig(project: string): string | undefined {
    try {
        const stats = fs.statSync(project); // throws if file does not exist
        if (!stats.isDirectory()) {
            return project;
        }
        const projectFile = path.join(project, "tsconfig.json");
        fs.accessSync(projectFile); // throws if file does not exist
        return projectFile;
    } catch (e) {
        return undefined;
    }
}

const argv: Argv = getInputArguments();

run({
    config: argv.config,
    exclude: argv.exclude,
    files: arrayify(commander.args),
    project: argv.project,
    rulesDirectory: argv.rulesDir,
})
    .then(rc => {
        process.exitCode = rc;
    })
    .catch(e => {
        console.error(e);
        process.exitCode = 1;
    });
