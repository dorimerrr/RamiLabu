#!/usr/bin/env node
'use strict';
const path = require('node:path');
const { parseArgs } = require('node:util');
const batch = require('./batch');
const exporter = require('./build');
const { check } = require('./check');
const HELP = `RamiLabu English workflow (Node.js 18+; no extra dependencies)

  import --kind scene --scene ID --input dump.json --out tools/batches/NAME
  import --kind ui|ui-log|static|names --input SOURCE --out tools/batches/NAME
         [--context context.json] [--only-untranslated] [--limit N]
         [--class CLASS --property PATH] (static) [--table TABLE] (names)
  requests --batch tools/batches/NAME --out requests.json
  draft --batch tools/batches/NAME --input response.json
  validate --batch tools/batches/NAME [--complete]
  build --batch tools/batches/NAME --out tools/builds/NAME
  apply --build tools/builds/NAME
  check [--staged] [--base COMMIT]
  audit

Edit work.json translations/status/note; never edit sources.json or capture.txt.
External drafts use IDs and the sourceFingerprint, and always require review.
Build writes a preview; apply writes English data and generates its manifest.
No command commits, pushes, contacts a translation service, or changes zh_Hans.
`;
async function main(argv = process.argv.slice(2)) {
    const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
        class: { type: 'string' }, property: { type: 'string' }, table: { type: 'string' }, limit: { type: 'string' }, kind: { type: 'string' }, scene: { type: 'string' }, input: { type: 'string' }, out: { type: 'string' },
        context: { type: 'string' }, batch: { type: 'string' }, build: { type: 'string' }, base: { type: 'string' },
        'only-untranslated': { type: 'boolean' }, complete: { type: 'boolean' }, staged: { type: 'boolean' }, help: { type: 'boolean', short: 'h' }
    } });
    if (values.help || !positionals.length) { process.stdout.write(HELP); return; }
    if (positionals.length !== 1) throw new Error('Supply one command; paths must use named options');
    const command = positionals[0], repo = path.resolve(__dirname, '../..');
    const allowed = { import: ['kind', 'scene', 'input', 'out', 'context', 'only-untranslated', 'class', 'property', 'table', 'limit'], requests: ['batch', 'out'], draft: ['batch', 'input'], validate: ['batch', 'complete'], build: ['batch', 'out'], apply: ['build'], check: ['staged', 'base'], audit: [] };
    if (!allowed[command]) throw new Error(`Unknown command: ${command}`);
    for (const option of Object.keys(values)) if (!allowed[command].includes(option)) throw new Error(`--${option} does not apply to ${command}`);
    const need = (...names) => { for (const name of names) if (!values[name]) throw new Error(`Missing --${name}`); };
    let result;
    if (command === 'import') { need('kind', 'input', 'out'); result = batch.importSources(repo, { ...values, onlyUntranslated: values['only-untranslated'] }); }
    if (command === 'requests') { need('batch', 'out'); result = batch.requests(repo, values.batch, values.out); }
    if (command === 'draft') { need('batch', 'input'); result = batch.importDrafts(values.batch, values.input); }
    if (command === 'validate') {
        need('batch'); const checked = batch.validateBatch(values.batch, values.complete);
        result = { counts: checked.counts, errors: checked.errors };
    }
    if (command === 'build') { need('batch', 'out'); result = await exporter.build(repo, values.batch, values.out); }
    if (command === 'apply') { need('build'); result = await exporter.apply(repo, values.build); }
    if (command === 'check' || command === 'audit') {
        const checked = check(repo, { ...values, audit: command === 'audit' });
        result = { ...checked, warnings: checked.warnings.slice(0, 20), warningCount: checked.warnings.length };
    }
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (result.errors?.length) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
module.exports = { main };
