# tslint-auto-disable

tslint-auto-disable is a command line tool that automatically inserts
a comment `// tslint:disable-next-line` before lines failing to comply
with tslint rules.

## Motivation

TSLint is a fantastic static analysis tool which offers a wide range
of linting rules to make code cleaner, safer and to avoid potential
bugs.

Unfortunately, adopting TSLint initially or adopting new rules in an
existing code base of significant size can be a lot of work as it
means that either all errors have to be fixed right a way or that
the severity level has to be lowered to warning. This prevents the
new rules from being enforced for new code.

This is where tslint-auto-disable comes in: When adopting TSLint or
adopting new rules, one can run `tslint-auto-disable` once to insert
disable comments above the offending lines. This makes the code base
pass the linting step, meaning that linting rules can be enforced
immediately for new code. Existing code which does not comply with
the rules will be littered with disable comments, these can be cleaned
up over time.

## Installation and Usage

tslint-auto-disable can be installed from npm:

```$ npm install tslint-auto-disable```

To use it, the `tsconfig.json` and `tslint.json` files must be specified:

```$ npx tslint-auto-disable -p tsconfig.json -c tslint.json```

**Warning:** tslint-auto-disable is realtively early stage and while
it has been used successfully on a few code bases and has a test suite
indicating it should work as intended, it does rewrite your source
files, so you probably want to have things committed / backed up before
running it.