import commander = require("commander");
import * as fs from "fs";
import * as glob from "glob";
import { filter as createMinimatchFilter, Minimatch } from "minimatch";
import * as path from "path";
import tsl, { Configuration, Linter, LintResult, Utils, RuleFailure, Replacement } from "tslint";
import * as ts from "typescript";
// import { run } from "./runner";
// import { arrayify, dedent } from "./utils";

const { findConfiguration } = Configuration;
const { dedent, arrayify, flatMap } = Utils;

interface Argv {
    config?: string;
    exclude: string[];
    fix?: boolean;
    force?: boolean;
    help?: boolean;
    init?: boolean;
    out?: string;
    outputAbsolutePaths: boolean;
    project?: string;
    rulesDir?: string;
    formattersDir: string;
    format?: string;
    typeCheck?: boolean;
    test?: boolean;
    version?: boolean;
}

interface Option {
    short?: string;
    // Commander will camelCase option names.
    name: keyof Argv | "rules-dir" | "formatters-dir" | "type-check";
    type: "string" | "boolean" | "array";
    describe: string; // Short, used for usage message
    description: string; // Long, used for `--help`
}

const options: Option[] = [
    {
        short: "c",
        name: "config",
        type: "string",
        describe: "configuration file",
        description: dedent`
            The location of the configuration file that tslint will use to
            determine which rules are activated and what options to provide
            to the rules. If no option is specified, the config file named
            tslint.json is used, so long as it exists in the path.
            The format of the file is { rules: { /* rules list */ } },
            where /* rules list */ is a key: value comma-separated list of
            rulename: rule-options pairs. Rule-options can be either a
            boolean true/false value denoting whether the rule is used or not,
            or a list [boolean, ...] where the boolean provides the same role
            as in the non-list case, and the rest of the list are options passed
            to the rule that will determine what it checks for (such as number
            of characters for the max-line-length rule, or what functions to ban
            for the ban rule).`,
    },
    {
        short: "e",
        name: "exclude",
        type: "array",
        describe: "exclude globs from path expansion",
        description: dedent`
            A filename or glob which indicates files to exclude from linting.
            This option can be supplied multiple times if you need multiple
            globs to indicate which files to exclude.`,
    },
    {
        name: "fix",
        type: "boolean",
        describe: "fixes linting errors for select rules (this may overwrite linted files)",
        description: "Fixes linting errors for select rules. This may overwrite linted files.",
    },
    {
        name: "force",
        type: "boolean",
        describe: "return status code 0 even if there are lint errors",
        description: dedent`
            Return status code 0 even if there are any lint errors.
            Useful while running as npm script.`,
    },
    {
        short: "i",
        name: "init",
        type: "boolean",
        describe: "generate a tslint.json config file in the current working directory",
        description: "Generates a tslint.json config file in the current working directory.",
    },
    {
        short: "o",
        name: "out",
        type: "string",
        describe: "output file",
        description: dedent`
            A filename to output the results to. By default, tslint outputs to
            stdout, which is usually the console where you're running it from.`,
    },
    {
        name: "outputAbsolutePaths",
        type: "boolean",
        describe: "whether or not outputted file paths are absolute",
        description: "If true, all paths in the output will be absolute.",
    },
    {
        short: "r",
        name: "rules-dir",
        type: "string",
        describe: "rules directory",
        description: dedent`
            An additional rules directory, for user-created rules.
            tslint will always check its default rules directory, in
            node_modules/tslint/lib/rules, before checking the user-provided
            rules directory, so rules in the user-provided rules directory
            with the same name as the base rules will not be loaded.`,
    },
    {
        short: "s",
        name: "formatters-dir",
        type: "string",
        describe: "formatters directory",
        description: dedent`
            An additional formatters directory, for user-created formatters.
            Formatters are files that will format the tslint output, before
            writing it to stdout or the file passed in --out. The default
            directory, node_modules/tslint/build/formatters, will always be
            checked first, so user-created formatters with the same names
            as the base formatters will not be loaded.`,
    },
    {
        short: "t",
        name: "format",
        type: "string",
        describe: "output format (prose, json, stylish, verbose, pmd, msbuild, checkstyle, vso, fileslist, codeFrame)",
        description: dedent`
            The formatter to use to format the results of the linter before
            outputting it to stdout or the file passed in --out. The core
            formatters are prose (human readable), json (machine readable)
            and verbose. prose is the default if this option is not used.
            Other built-in options include pmd, msbuild, checkstyle, and vso.
            Additional formatters can be added and used if the --formatters-dir
            option is set.`,
    },
    {
        name: "test",
        type: "boolean",
        describe: "test that tslint produces the correct output for the specified directory",
        description: dedent`
            Runs tslint on matched directories and checks if tslint outputs
            match the expected output in .lint files. Automatically loads the
            tslint.json files in the directories as the configuration file for
            the tests. See the full tslint documentation for more details on how
            this can be used to test custom rules.`,
    },
    {
        short: "p",
        name: "project",
        type: "string",
        describe: "tsconfig.json file",
        description: dedent`
            The path or directory containing a tsconfig.json file that will be
            used to determine which files will be linted. This flag also enables
            rules that require the type checker.`,
    },
    {
        name: "type-check",
        type: "boolean",
        describe: "(deprecated) check for type errors before linting the project",
        description: dedent`
            (deprecated) Checks for type errors before linting a project.
            --project must be specified in order to enable type checking.`,
    },
];

const builtinOptions: Option[] = [
    {
        short: "v",
        name: "version",
        type: "boolean",
        describe: "current version",
        description: "The current version of tslint.",
    },
    {
        short: "h",
        name: "help",
        type: "boolean",
        describe: "display detailed help",
        description: "Prints this help message.",
    },
];

commander.version(Linter.VERSION, "-v, --version");

for (const option of options) {
    const commanderStr = optionUsageTag(option) + optionParam(option);
    if (option.type === "array") {
        commander.option(commanderStr, option.describe, collect, []);
    } else {
        commander.option(commanderStr, option.describe);
    }
}

commander.on("--help", () => {
    const indent = "\n        ";
    const optionDetails = options.concat(builtinOptions).map((o) => {
        const descr = o.description.startsWith("\n") ? o.description.replace(/\n/g, indent) : indent + o.description;
        return `${optionUsageTag(o)}:${descr}`;
    });
    console.log(`tslint accepts the following commandline options:\n\n    ${optionDetails.join("\n\n    ")}\n\n`);
});

// Hack to get unknown option errors to work. https://github.com/visionmedia/commander.js/pull/121
const parsed = commander.parseOptions(process.argv.slice(2));
commander.args = parsed.args;
if (parsed.unknown.length !== 0) {
    (commander.parseArgs as (args: string[], unknown: string[]) => void)([], parsed.unknown);
}
const argv = commander.opts() as any as Argv;

if (!(argv.init || argv.test !== undefined || argv.project !== undefined || commander.args.length > 0)) {
    console.error("No files specified. Use --project to lint a project folder.");
    process.exit(1);
}

if (argv.typeCheck) {
    console.warn("--type-check is deprecated. You only need --project to enable rules which need type information.");
    if (argv.project === undefined) {
        console.error("--project must be specified in order to enable type checking.");
        process.exit(1);
    }
}

const outputStream: NodeJS.WritableStream = argv.out === undefined
    ? process.stdout
    : fs.createWriteStream(argv.out, { flags: "w+", mode: 420 });

export interface Options {
    /**
     * Path to a configuration file.
     */
    config?: string;

    /**
     * Exclude globs from path expansion.
     */
    exclude: string[];

    /**
     * File paths to lint.
     */
    files: string[];

    /**
     * Whether to return status code 0 even if there are lint errors.
     */
    force?: boolean;

    /**
     * Whether to fixes linting errors for select rules. This may overwrite linted files.
     */
    fix?: boolean;

    /**
     * Output format.
     */
    format?: string;

    /**
     * Formatters directory path.
     */
    formattersDirectory?: string;

    /**
     * Whether to generate a tslint.json config file in the current working directory.
     */
    init?: boolean;

    /**
     * Output file path.
     */
    out?: string;

    /**
     * Whether to output absolute paths
     */
    outputAbsolutePaths?: boolean;

    /**
     * tsconfig.json file.
     */
    project?: string;

    /**
     * Rules directory paths.
     */
    rulesDirectory?: string | string[];

    /**
     * Run the tests in the given directories to ensure a (custom) TSLint rule's output matches the expected output.
     * When this property is `true` the `files` property is used to specify the directories from which the tests
     * should be executed.
     */
    test?: boolean;

    /**
     * Whether to enable type checking when linting a project.
     */
    typeCheck?: boolean;
}

export const enum Status {
    Ok = 0,
    FatalError = 1,
    LintError = 2,
}

export interface Logger {
    log(message: string): void;
    error(message: string): void;
}

export async function run(options: Options, logger: Logger): Promise<Status> {
    try {
        return await runWorker(options, logger);
    } catch (error) {
        return Status.FatalError;
    }
}

async function runWorker(options: Options, logger: Logger): Promise<Status> {
    if (options.config && !fs.existsSync(options.config)) {
        throw new Error(`Invalid option for configuration: ${options.config}`);
    }

    const { output, errorCount } = await runLinter(options, logger);
    if (output && output.trim()) {
        logger.log(`${output}\n`);
    }
    return options.force || errorCount === 0 ? Status.Ok : Status.LintError;
}

async function runLinter(options: Options, logger: Logger): Promise<LintResult> {
    const { files, program } = resolveFilesAndProgram(options, logger);
    // if type checking, run the type checker
    if (program && options.typeCheck) {
        const diagnostics = ts.getPreEmitDiagnostics(program);
        if (diagnostics.length !== 0) {
            const message = diagnostics.map((d) => showDiagnostic(d, program, options.outputAbsolutePaths)).join("\n");
            if (options.force) {
                logger.error(`${message}\n`);
            } else {
                throw new Error(message);
            }
        }
    }
    return doLinting(options, files, program, logger);
}

function resolveFilesAndProgram(
    { files, project, exclude, outputAbsolutePaths }: Options,
    logger: Logger,
): { files: string[]; program?: ts.Program } {
    // remove single quotes which break matching on Windows when glob is passed in single quotes
    exclude = exclude.map(trimSingleQuotes);

    if (project === undefined) {
        return { files: resolveGlobs(files, exclude, outputAbsolutePaths, logger) };
    }

    const projectPath = findTsconfig(project);
    if (projectPath === undefined) {
        throw new Error(`Invalid option for project: ${project}`);
    }

    exclude = exclude.map((pattern) => path.resolve(pattern));
    const program = Linter.createProgram(projectPath);
    let filesFound: string[];
    if (files.length === 0) {
        filesFound = filterFiles(Linter.getFileNames(program), exclude, false);
    } else {
        files = files.map((f) => path.resolve(f));
        filesFound = filterFiles(program.getSourceFiles().map((f) => f.fileName), files, true);
        filesFound = filterFiles(filesFound, exclude, false);

        // find non-glob files that have no matching file in the project and are not excluded by any exclude pattern
        for (const file of filterFiles(files, exclude, false)) {
            if (!glob.hasMagic(file) && !filesFound.some(createMinimatchFilter(file))) {
                if (fs.existsSync(file)) {
                    throw new Error(`'${file}' is not included in project.`);
                }
                // TODO make this an error in v6.0.0
                logger.error(`'${file}' does not exist. This will be an error in TSLint 6.\n`);
            }
        }
    }
    return { files: filesFound, program };
}

function filterFiles(files: string[], patterns: string[], include: boolean): string[] {
    if (patterns.length === 0) {
        return include ? [] : files;
    }
    // `glob` always enables `dot` for ignore patterns
    const matcher = patterns.map((pattern) => new Minimatch(pattern, { dot: !include }));
    return files.filter((file) => include === matcher.some((pattern) => pattern.match(file)));
}

function resolveGlobs(files: string[], ignore: string[], outputAbsolutePaths: boolean | undefined, logger: Logger): string[] {
    const results = flatMap(
        files,
        (file) => glob.sync(trimSingleQuotes(file), { ignore, nodir: true }),
    );
    // warn if `files` contains non-existent files, that are not patters and not excluded by any of the exclude patterns
    for (const file of filterFiles(files, ignore, false)) {
        if (!glob.hasMagic(file) && !results.some(createMinimatchFilter(file))) {
            logger.error(`'${file}' does not exist. This will be an error in TSLint 6.\n`); // TODO make this an error in v6.0.0
        }
    }
    const cwd = process.cwd();
    return results.map((file: any) => outputAbsolutePaths ? path.resolve(cwd, file) : path.relative(cwd, file));
}

async function doLinting(options: Options, files: string[], program: ts.Program | undefined, logger: Logger): Promise<LintResult> {
    const linter = new Linter(
        {
            fix: !!options.fix,
            formatter: options.format,
            formattersDirectory: options.formattersDirectory,
            rulesDirectory: options.rulesDirectory,
        },
        program);

    let lastFolder: string | undefined;
    let configFile = options.config !== undefined ? findConfiguration(options.config).results : undefined;

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

        const contents = program !== undefined
            ? program.getSourceFile(file)!.text
            : await tryReadFile(file, logger);

        if (contents !== undefined) {
            linter.lint(file, contents, configFile);
        }
    }

    const result = linter.getResult();

    const filesAndFixes = createMultiMap(result.failures, (input) => {
        const fileName = input.getFileName();
        const line = input.getStartPosition().getLineAndCharacter().line;
        const sourceFile = program!.getSourceFile(fileName)!;
        const insertPos = sourceFile.getLineStarts()[line];
        const fix = Replacement.appendText(insertPos, "\n/* tslint:disable-next-line */\n");
        return [fileName, fix];
    });

    filesAndFixes.forEach((fixes, filename) => {
        const source = fs.readFileSync(filename).toString();
        const updatedSource = Replacement.applyAll(source, fixes);
        console.log(`Writing updated source for ${filename}`);
        fs.writeFileSync(filename, updatedSource);
    });

    return result;

    function isFileExcluded(filepath: string) {
        if (configFile === undefined || configFile.linterOptions == undefined || configFile.linterOptions.exclude == undefined) {
            return false;
        }
        const fullPath = path.resolve(filepath);
        return configFile.linterOptions.exclude.some((pattern: any) => new Minimatch(pattern).match(fullPath));
    }
}

/** Read a file, but return undefined if it is an MPEG '.ts' file. */
async function tryReadFile(filename: string, logger: Logger): Promise<string | undefined> {
    if (!fs.existsSync(filename)) {
        throw new Error(`Unable to open file: ${filename}`);
    }
    const buffer = new Buffer(256);
    const fd = fs.openSync(filename, "r");
    try {
        fs.readSync(fd, buffer, 0, 256, 0);
        if (buffer.readInt8(0, true) === 0x47 && buffer.readInt8(188, true) === 0x47) {
            // MPEG transport streams use the '.ts' file extension. They use 0x47 as the frame
            // separator, repeating every 188 bytes. It is unlikely to find that pattern in
            // TypeScript source, so tslint ignores files with the specific pattern.
            logger.error(`${filename}: ignoring MPEG transport stream\n`);
            return undefined;
        }
    } finally {
        fs.closeSync(fd);
    }

    return fs.readFileSync(filename, "utf8");
}

function showDiagnostic({ file, start, category, messageText }: ts.Diagnostic, program: ts.Program, outputAbsolutePaths?: boolean): string {
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

run(
    {
        config: argv.config,
        exclude: argv.exclude,
        files: arrayify(commander.args),
        fix: argv.fix,
        force: argv.force,
        format: argv.format === undefined ? "prose" : argv.format,
        formattersDirectory: argv.formattersDir,
        init: argv.init,
        out: argv.out,
        outputAbsolutePaths: argv.outputAbsolutePaths,
        project: argv.project,
        rulesDirectory: argv.rulesDir,
        test: argv.test,
        typeCheck: argv.typeCheck,
    },
    {
        log(m) {
            outputStream.write(m);
        },
        error(m) {
            process.stdout.write(m);
        },
    })
    .then((rc) => {
        process.exitCode = rc;
    }).catch((e) => {
        console.error(e);
        process.exitCode = 1;
    });

function optionUsageTag({ short, name }: Option) {
    return short !== undefined ? `-${short}, --${name}` : `--${name}`;
}

function optionParam(option: Option) {
    switch (option.type) {
        case "string":
            return ` [${option.name}]`;
        case "array":
            return ` <${option.name}>`;
        case "boolean":
            return "";
    }
}

function collect(val: string, memo: string[]) {
    memo.push(val);
    return memo;
}

function createMultiMap<T, K, V>(inputs: T[], getPair: (input: T) => [K, V] | undefined): Map<K, V[]> {
    const map = new Map<K, V[]>();
    for (const input of inputs) {
        const pair = getPair(input);
        if (pair !== undefined) {
            const [k, v] = pair;
            const vs = map.get(k);
            if (vs !== undefined) {
                vs.push(v);
            } else {
                map.set(k, [v]);
            }
        }
    }
    return map;
}
