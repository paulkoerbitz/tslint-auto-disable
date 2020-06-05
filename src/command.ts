import { Utils } from "tslint";
import commander from "commander";

const { dedent } = Utils;

const TSLINT_AUTO_DISABLE_VERSION = "0.0.3";

export interface Argv {
    project: string;
    exclude: string[];
    config?: string;
    help?: boolean;
    rulesDir?: string;
    version?: boolean;
}

interface Option {
    short?: string;
    // Commander will camelCase option names.
    name: keyof Argv | "rules-dir";
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
        description: dedent`
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
        description: dedent`
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
        description: dedent`
        The path or directory containing a tsconfig.json file that will be
        used to determine which files will be linted. This flag also enables
        rules that require the type checker.
        This parameter is forwarded to tslint.`,
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

commander.version(TSLINT_AUTO_DISABLE_VERSION, "-v, --version");

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
    const optionDetails = options.concat(builtinOptions).map(o => {
        const descr = o.description.startsWith("\n")
            ? o.description.replace(/\n/g, indent)
            : indent + o.description;
        return `${optionUsageTag(o)}:${descr}`;
    });
    console.log(
        `tslint accepts the following commandline options:\n\n    ${optionDetails.join(
            "\n\n    "
        )}\n\n`
    );
});

// Hack to get unknown option errors to work. https://github.com/visionmedia/commander.js/pull/121
const parsed = commander.parseOptions(process.argv.slice(2));
(commander as any).args = parsed.args;
console.log(parsed.unknown);
if (parsed.unknown.length !== 0) {
    (commander.parseArgs as (args: string[], unknown: string[]) => void)(
        [],
        parsed.unknown
    );
}
const argv = (commander.opts() as any) as Argv;

if (
    (global as any).RUN_FROM_COMMAND_LINE &&
    argv.project === undefined &&
    commander.args.length <= 0
) {
    console.error(
        "No files specified. Use --project to lint a project folder."
    );
    process.exit(1);
}

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
     * tsconfig.json file.
     */
    project: string;

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
}

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

export const getInputArguments = () => {
    return argv;
};
