// Round 9 builder: turns tools/sources/ui-round9-translations.tsv into the additions file that
// merge-ui-translations.ps1 applies to translation/ui/en.json.
//
// The TSV is "<harvest index><TAB><english>", one row per interface string of the frozen batch. The
// builder takes the *key* from the harvest (never from the TSV), so a key can never drift from what the
// game rendered, and validates every value against the failure modes the client ignores silently: an
// empty value, a value equal to its key, a CR, a Japanese character left in a Latin value, and a template
// whose '#' count does not match the digit runs of its source.
//
// Line-break convention (the TSV is plain text, not JSON):
//   <LF>    -> a real line break (0x0A)
//   <ZWSP>  -> U+200B, which a few of the game's own labels carry
//   <TAB>   -> a literal tab
//   a backslash-n typed as-is stays a literal backslash + n (some source strings carry exactly that)
//
// Rows are optional: an index that is not authored is reported at the end. Round 9 leaves out the lines
// that belong to scene 10280101 (handled by its scene file) and the handful of entries that are already
// English - the client drops a value equal to its key, so authoring those would only add dead weight.
//
// Usage: node tools/scripts/build-round9.js
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const HARVEST = path.join(REPO, 'tools/sources/ui-round9-harvest.json');
const TRANSLATIONS = path.join(REPO, 'tools/sources/ui-round9-translations.tsv');
const TABLE = path.join(REPO, 'translation/ui/en.json');
const OUTPUT = path.join(REPO, 'tools/sources/ui-round9.json');

// "Needs translation" means kana or kanji: full-width punctuation (～, ！, ：) is not a letter, so an entry
// that only uses it is already English and authoring a value would just duplicate its key.
const JAPANESE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

function templateKey(text) {
    const out = [];
    let inTag = false;
    let inRun = false;
    for (const ch of Array.from(text)) {
        if (ch === '<') inTag = true;
        const isDigit = !inTag && ch >= '0' && ch <= '9';
        if (isDigit) { if (!inRun) out.push('#'); inRun = true; continue; }
        inRun = false;
        if (inTag && ch === '>') inTag = false;
        out.push(ch);
    }
    return out.join('');
}

function countRuns(text, char) {
    let inTag = false;
    let inRun = false;
    let runs = 0;
    for (const ch of Array.from(text)) {
        if (ch === '<') inTag = true;
        const hit = inTag ? false : (char === 'digit' ? (ch >= '0' && ch <= '9') : ch === '#');
        if (hit) { if (!inRun) runs += 1; inRun = true; continue; }
        inRun = false;
        if (inTag && ch === '>') inTag = false;
    }
    return runs;
}

function expand(value) {
    return value
        .split('<CRLF>').join('\r\n')
        .split('<LF>').join('\n')
        .split('<ZWSP>').join('\u200b')
        .split('<TAB>').join('\t');
}


const harvest = JSON.parse(fs.readFileSync(HARVEST, 'utf8'));
const table = JSON.parse(fs.readFileSync(TABLE, 'utf8'));
// Lines of scene 10280101 also appear in the log (the UI draws scenario text too) but their keys belong to
// that scene's table, which the dump provides with the %usernameusernameuserna% placeholder in place.
const sceneLines = new Set(JSON.parse(fs.readFileSync(path.join(REPO, 'tools/reports/round9-scene-keys.json'), 'utf8')));
const strings = {};
const templates = {};
const problems = [];
const warnings = [];
const skippedScene = [];
const authored = new Set();
let applied = 0;

for (const line of fs.readFileSync(TRANSLATIONS, 'utf8').split(/\r?\n/)) {
    if (line === '' || line.startsWith('#')) continue;
    const tab = line.indexOf('\t');
    if (tab < 0) { problems.push('no tab: ' + line.slice(0, 60)); continue; }
    const index = Number(line.slice(0, tab));
    const value = expand(line.slice(tab + 1));
    if (!Number.isInteger(index) || index < 1 || index > harvest.length) {
        problems.push('bad index: ' + line.slice(0, 60));
        continue;
    }
    if (authored.has(index)) { problems.push('row authored twice: ' + index); continue; }

    const source = harvest[index - 1];
    const key = templateKey(source);
    const isTemplate = key !== source;
    const label = '[' + index + ' ' + (isTemplate ? 'T' : 'S') + ']';

    // A row that names a scene line is not an interface entry: the value authored for it is the same
    // sentence the scene file carries, so it is reported rather than merged twice.
    if (sceneLines.has(source)) { skippedScene.push(index + ' ' + JSON.stringify(source.slice(0, 70))); continue; }

    if (source.includes('\r')) { problems.push(label + ' the harvested key contains a CR'); continue; }
    if (value === '') { problems.push(label + ' empty value'); continue; }
    if (value.includes('\r')) { problems.push(label + ' the value contains a CR'); continue; }
    if (value === key) { problems.push(label + ' value equals key'); continue; }
    if (isTemplate) {
        const expected = countRuns(source, 'digit');
        const actual = countRuns(value, '#');
        if (expected !== actual) {
            problems.push(label + ' placeholder mismatch: key has ' + expected + ' run(s), value has ' + actual + ' "#"');
            continue;
        }
    }
    if (JAPANESE.test(value)) warnings.push(label + ' the value still contains Japanese');

    authored.add(index);
    if (isTemplate) templates[key] = value; else strings[key] = value;
    applied += 1;
}

const additions = { strings, templates, remove: { strings: [], templates: [] } };
fs.writeFileSync(OUTPUT, JSON.stringify(additions, null, 2) + '\n', 'utf8');

const notAuthored = [];
for (let index = 1; index <= harvest.length; index += 1) {
    if (authored.has(index) || skippedScene.some(entry => entry.startsWith(index + ' '))) continue;
    const text = harvest[index - 1];
    if (sceneLines.has(text)) continue;
    const reason = JAPANESE.test(text) ? 'not authored' : 'already English';
    notAuthored.push(index + ' (' + reason + ') ' + JSON.stringify(text.slice(0, 80)));
}

// What the merged table will look like, and whether every interface entry of the batch then resolves.
const after = { strings: { ...table.strings }, templates: { ...table.templates } };
for (const name of ['strings', 'templates']) {
    for (const [key, value] of Object.entries(additions[name])) after[name][key] = value;
}
const unresolved = harvest.filter(text => {
    if (sceneLines.has(text)) return false;
    if (Object.prototype.hasOwnProperty.call(after.strings, text)) return false;
    const key = templateKey(text);
    return key === text || !Object.prototype.hasOwnProperty.call(after.templates, key);
});

console.log('applied rows        :', applied, '(' + Object.keys(strings).length + ' strings, '
    + Object.keys(templates).length + ' templates)');
console.log('replacing existing  :', Object.keys(strings).filter(key => key in table.strings).length
    + ' strings, ' + Object.keys(templates).filter(key => key in table.templates).length + ' templates');
console.log('scene-line rows     :', skippedScene.length, '(translated in translation/scenes/10280101/en.json)');
console.log('not authored        :', notAuthored.length);
for (const entry of notAuthored) console.log('  ' + entry);
console.log('unresolved harvest  :', unresolved.length);
for (const text of unresolved) console.log('  ' + JSON.stringify(text.slice(0, 100)));
console.log('problems            :', problems.length);
for (const problem of problems) console.log('  ' + problem);
console.log('warnings            :', warnings.length);
for (const warning of warnings) console.log('  ' + warning);
if (problems.length > 0) process.exitCode = 1;
