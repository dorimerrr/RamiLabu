'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { objHash } = require('../../manifest');
const { parseJson, canonical, getAt, setAt, safePath } = require('./json');
const { entriesOf, entryIssues, containsJapanese } = require('./rules');
function git(repo, ...args) { return execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }); }
function readGitObjects(repo, references) {
    if (!references.length) return new Map();
    const output = execFileSync('git', ['cat-file', '--batch'], { cwd: repo, input: references.join('\n') + '\n', maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
    const result = new Map(); let offset = 0;
    for (const reference of references) {
        const newline = output.indexOf(10, offset);
        if (newline < 0) throw new Error('Incomplete Git object response');
        const header = output.subarray(offset, newline).toString('utf8'); offset = newline + 1;
        if (header.endsWith(' missing')) { result.set(reference, null); continue; }
        const length = Number(header.split(' ').at(-1));
        if (!Number.isSafeInteger(length) || length < 0) throw new Error('Invalid Git object length');
        result.set(reference, output.subarray(offset, offset + length).toString('utf8')); offset += length + 1;
    }
    return result;
}
function walk(root, relative = '') {
    return fs.readdirSync(path.join(root, relative), { withFileTypes: true }).flatMap(entry => {
        const next = relative ? relative + '/' + entry.name : entry.name;
        if (entry.isSymbolicLink()) throw new Error(`Translation symlink is not allowed: ${next}`);
        return entry.isDirectory() ? walk(root, next) : [next];
    });
}
function check(repo, options = {}) {
    const staged = Boolean(options.staged), audit = Boolean(options.audit);
    const paths = staged ? git(repo, 'ls-files', '-z').split('\0').filter(file => file.startsWith('translation/')).map(file => file.slice(12)) : walk(path.join(repo, 'translation'));
    const files = paths.filter(file => file.endsWith('/en.json') && !file.startsWith('manifest/'));
    const errors = [], warnings = [], computed = {};
    let entryCount = 0, changedCount = 0, inheritedIssues = 0;
    const indexed = staged ? readGitObjects(repo, files.concat('manifest/en.json').map(file => ':translation/' + file)) : null;
    const load = file => staged ? indexed.get(':translation/' + file) : fs.readFileSync(safePath(repo, 'translation/' + file), 'utf8');
    const base = options.base || 'HEAD';
    git(repo, 'rev-parse', '--verify', base + '^{commit}');
    const baseValues = readGitObjects(repo, files.map(file => base + ':translation/' + file));
    for (const file of files) {
        try {
            const table = parseJson(load(file), file).value;
            const entries = entriesOf(file, table);
            setAt(computed, file.split('/').slice(0, -1), objHash(table));
            const baselineRaw = baseValues.get(base + ':translation/' + file);
            const before = baselineRaw === null ? {} : parseJson(baselineRaw).value;
            for (const entry of entries) {
                entryCount++;
                const changed = getAt(before, entry.parts) !== entry.translation;
                if (changed) changedCount++;
                const issues = entryIssues(entry.source, entry.translation, entry.mode);
                if (file === 'ui/en.json' && !containsJapanese(entry.source)) issues.push('UI source fails the runtime Japanese-character gate');
                if (!changed) inheritedIssues += issues.length > 0 ? 1 : 0;
                if (changed || audit) for (const issue of issues) {
                    const message = `${file} ${JSON.stringify(entry.parts).slice(0, 150)}: ${issue}`;
                    if (changed && !audit) errors.push(message); else warnings.push(message);
                }
            }
            if (!audit && Object.keys(before).length) {
                for (const old of entriesOf(file, before)) if (getAt(table, old.parts) === undefined) errors.push(`${file}: removed source key ${JSON.stringify(old.parts).slice(0, 150)}; reconcile removals explicitly before committing`);
            }
        } catch (error) { errors.push(`${file}: ${error.message}`); }
    }
    // Removed English resources are never silently dropped from a commit.
    const baseline = git(repo, 'ls-tree', '-r', '--name-only', base).trim().split('\n').filter(file => file.startsWith('translation/') && file.endsWith('/en.json') && !file.startsWith('translation/manifest/'));
    if (!audit) for (const file of baseline) if (!files.includes(file.slice(12))) errors.push(`Removed resource: ${file}`);
    computed.hash = objHash(computed);
    try {
        const manifest = parseJson(load('manifest/en.json'), 'manifest/en.json').value;
        if (canonical(manifest) !== canonical(computed)) errors.push('English manifest does not match this state; run node manifest.js en and stage it with the data');
    } catch (error) { errors.push(`manifest/en.json: ${error.message}`); }
    return { state: staged ? 'Git index' : 'working tree', files: files.length, entries: entryCount, changedEntries: changedCount, inheritedEntriesWithIssues: inheritedIssues, errors, warnings, manifestHash: computed.hash };
}
module.exports = { check };
