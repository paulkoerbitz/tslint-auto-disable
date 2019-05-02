"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = __importDefault(require("commander"));
const fs = __importStar(require("fs"));
const glob = __importStar(require("glob"));
const minimatch_1 = require("minimatch");
const path = __importStar(require("path"));
const tslint_1 = require("tslint");
const ts = __importStar(require("typescript"));
const { findConfiguration } = tslint_1.Configuration;
const { dedent, arrayify } = tslint_1.Utils;
const TSLINT_AUTO_DISABLE_VERSION = "0.0.1";
const options = [
    {
        short: "c",
        name: "config",
        type: "string",
        describe: "configuration file",
        description: dedent `
            The location of the configuration file that tslint-auto-disable
            will use to determine which rules are activated and what options
            to provide to the rules. If no option is specified, the config
            file named tslint.json is used, so long as it exists in the path.
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
        description: dedent `
            A filename or glob which indicates files to exclude from linting.
            This option can be supplied multiple times if you need multiple
            globs to indicate which files to exclude.
            This parameter is forwarded to tslint.`,
    },
    {
        short: "r",
        name: "rules-dir",
        type: "string",
        describe: "rules directory",
        description: dedent `
            An additional rules directory, for user-created rules.
            tslint will always check its default rules directory, in
            node_modules/tslint/lib/rules, before checking the user-provided
            rules directory, so rules in the user-provided rules directory
            with the same name as the base rules will not be loaded.
            This parameter is forwarded to tslint.`,
    },
    {
        short: "p",
        name: "project",
        type: "string",
        describe: "tsconfig.json file",
        description: dedent `
        The path or directory containing a tsconfig.json file that will be
        used to determine which files will be linted. This flag also enables
        rules that require the type checker.
        This parameter is forwarded to tslint.`,
    },
];
const builtinOptions = [
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
commander_1.default.version(TSLINT_AUTO_DISABLE_VERSION, "-v, --version");
for (const option of options) {
    const commanderStr = optionUsageTag(option) + optionParam(option);
    if (option.type === "array") {
        commander_1.default.option(commanderStr, option.describe, collect, []);
    }
    else {
        commander_1.default.option(commanderStr, option.describe);
    }
}
commander_1.default.on("--help", () => {
    const indent = "\n        ";
    const optionDetails = options.concat(builtinOptions).map(o => {
        const descr = o.description.startsWith("\n")
            ? o.description.replace(/\n/g, indent)
            : indent + o.description;
        return `${optionUsageTag(o)}:${descr}`;
    });
    console.log(`tslint accepts the following commandline options:\n\n    ${optionDetails.join("\n\n    ")}\n\n`);
});
// Hack to get unknown option errors to work. https://github.com/visionmedia/commander.js/pull/121
const parsed = commander_1.default.parseOptions(process.argv.slice(2));
commander_1.default.args = parsed.args;
if (parsed.unknown.length !== 0) {
    commander_1.default.parseArgs([], parsed.unknown);
}
const argv = commander_1.default.opts();
if (global.RUN_FROM_COMMAND_LINE &&
    argv.project === undefined &&
    commander_1.default.args.length <= 0) {
    console.error("No files specified. Use --project to lint a project folder.");
    process.exit(1);
}
function run(options, logger) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            return yield runWorker(options, logger);
        }
        catch (error) {
            return 1 /* FatalError */;
        }
    });
}
exports.run = run;
function runWorker(options, logger) {
    return __awaiter(this, void 0, void 0, function* () {
        if (options.config && !fs.existsSync(options.config)) {
            throw new Error(`Invalid option for configuration: ${options.config}`);
        }
        const updatedSources = yield runReplacement(options, logger);
        exports.writeUpdateSourceFiles(updatedSources);
        return 0 /* Ok */;
    });
}
function runReplacement(options, logger) {
    return __awaiter(this, void 0, void 0, function* () {
        const { files, program } = resolveFilesAndProgram(options, logger);
        const diagnostics = ts.getPreEmitDiagnostics(program);
        if (diagnostics.length !== 0) {
            const message = diagnostics
                .map(d => showDiagnostic(d, program))
                .join("\n");
            throw new Error(message);
        }
        const lintResult = yield doLinting(options, files, program, logger);
        return exports.insertTslintDisableComments(program, lintResult);
    });
}
exports.runReplacement = runReplacement;
function resolveFilesAndProgram({ files, project, exclude }, logger) {
    // remove single quotes which break matching on Windows when glob is passed in single quotes
    exclude = exclude.map(trimSingleQuotes);
    const projectPath = findTsconfig(project);
    if (projectPath === undefined) {
        throw new Error(`Invalid option for project: ${project}`);
    }
    exclude = exclude.map(pattern => path.resolve(pattern));
    const program = tslint_1.Linter.createProgram(projectPath);
    let filesFound;
    if (files.length === 0) {
        filesFound = filterFiles(tslint_1.Linter.getFileNames(program), exclude, false);
    }
    else {
        files = files.map(f => path.resolve(f));
        filesFound = filterFiles(program.getSourceFiles().map(f => f.fileName), files, true);
        filesFound = filterFiles(filesFound, exclude, false);
        // find non-glob files that have no matching file in the project and are not excluded by any exclude pattern
        for (const file of filterFiles(files, exclude, false)) {
            if (!glob.hasMagic(file) &&
                !filesFound.some(minimatch_1.filter(file))) {
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
function filterFiles(files, patterns, include) {
    if (patterns.length === 0) {
        return include ? [] : files;
    }
    // `glob` always enables `dot` for ignore patterns
    const matcher = patterns.map(pattern => new minimatch_1.Minimatch(pattern, { dot: !include }));
    return files.filter(file => include === matcher.some(pattern => pattern.match(file)));
}
function doLinting(options, files, program, logger) {
    return __awaiter(this, void 0, void 0, function* () {
        const linter = new tslint_1.Linter({
            fix: false,
            rulesDirectory: options.rulesDirectory,
        }, program);
        let lastFolder;
        let configFile = options.config !== undefined
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
            const contents = program !== undefined
                ? program.getSourceFile(file).text
                : yield tryReadFile(file, logger);
            if (contents !== undefined) {
                linter.lint(file, contents, configFile);
            }
        }
        return linter.getResult();
        function isFileExcluded(filepath) {
            if (configFile === undefined ||
                configFile.linterOptions == undefined ||
                configFile.linterOptions.exclude == undefined) {
                return false;
            }
            const fullPath = path.resolve(filepath);
            return configFile.linterOptions.exclude.some((pattern) => new minimatch_1.Minimatch(pattern).match(fullPath));
        }
    });
}
exports.insertTslintDisableComments = (program, result) => {
    const filesAndFixes = new Map();
    result.failures.forEach(input => {
        const fileName = input.getFileName();
        const line = input.getStartPosition().getLineAndCharacter().line;
        const sourceFile = program.getSourceFile(fileName);
        const insertPos = sourceFile.getLineStarts()[line];
        const maybeIndent = /^\s*/.exec(sourceFile.text.substring(insertPos));
        const indent = maybeIndent != undefined ? maybeIndent[0] : "";
        const fix = tslint_1.Replacement.appendText(insertPos, `${indent}// tslint:disable-next-line\n`);
        const fixes = filesAndFixes.get(fileName);
        if (fixes == undefined) {
            filesAndFixes.set(fileName, [[line, fix]]);
        }
        else if (fixes.findIndex(oldfix => oldfix[0] === line) < 0) {
            fixes.push([line, fix]);
            filesAndFixes.set(fileName, fixes);
        }
        // otherwise there is already a fix for the current line
    });
    const updatedSources = new Map();
    filesAndFixes.forEach((fixes, filename) => {
        const source = fs.readFileSync(filename).toString();
        updatedSources.set(filename, tslint_1.Replacement.applyAll(source, fixes.map(x => x[1])));
    });
    return updatedSources;
};
exports.writeUpdateSourceFiles = (updatedSources) => {
    updatedSources.forEach((source, filename) => {
        fs.writeFileSync(filename, source);
    });
};
/** Read a file, but return undefined if it is an MPEG '.ts' file. */
function tryReadFile(filename, logger) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!fs.existsSync(filename)) {
            throw new Error(`Unable to open file: ${filename}`);
        }
        const buffer = new Buffer(256);
        const fd = fs.openSync(filename, "r");
        try {
            fs.readSync(fd, buffer, 0, 256, 0);
            if (buffer.readInt8(0, true) === 0x47 &&
                buffer.readInt8(188, true) === 0x47) {
                // MPEG transport streams use the '.ts' file extension. They use 0x47 as the frame
                // separator, repeating every 188 bytes. It is unlikely to find that pattern in
                // TypeScript source, so tslint ignores files with the specific pattern.
                logger.error(`${filename}: ignoring MPEG transport stream\n`);
                return undefined;
            }
        }
        finally {
            fs.closeSync(fd);
        }
        return fs.readFileSync(filename, "utf8");
    });
}
function showDiagnostic({ file, start, category, messageText }, program, outputAbsolutePaths) {
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
function trimSingleQuotes(str) {
    return str.replace(/^'|'$/g, "");
}
function findTsconfig(project) {
    try {
        const stats = fs.statSync(project); // throws if file does not exist
        if (!stats.isDirectory()) {
            return project;
        }
        const projectFile = path.join(project, "tsconfig.json");
        fs.accessSync(projectFile); // throws if file does not exist
        return projectFile;
    }
    catch (e) {
        return undefined;
    }
}
run({
    config: argv.config,
    exclude: argv.exclude,
    files: arrayify(commander_1.default.args),
    project: argv.project,
    rulesDirectory: argv.rulesDir,
}, {
    log(m) {
        process.stdout.write(m);
    },
    error(m) {
        process.stdout.write(m);
    },
})
    .then(rc => {
    process.exitCode = rc;
})
    .catch(e => {
    console.error(e);
    process.exitCode = 1;
});
function optionUsageTag({ short, name }) {
    return short !== undefined ? `-${short}, --${name}` : `--${name}`;
}
function optionParam(option) {
    switch (option.type) {
        case "string":
            return ` [${option.name}]`;
        case "array":
            return ` <${option.name}>`;
        case "boolean":
            return "";
    }
}
function collect(val, memo) {
    memo.push(val);
    return memo;
}
