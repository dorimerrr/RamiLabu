// Round 8 builder. Two jobs, one additions file:
//
// 1. Newline repair. The game renders a line break inside a UI string as a bare LF: the live log
//    (44 distinct strings) and the scene dump (268 keys) contain no CR at all, while the committed
//    table holds 183 keys with CRLF. Those keys can never match — round 7's harvest was captured
//    through an editor that normalised LF to CRLF, so both the harvest and the authored keys carried a
//    CR the engine never emits. The sweep adds the LF twin of every CRLF key with the same value and
//    retires the CRLF key through 'remove'.
// 2. The strings authored in tools/sources/ui-round8-translations.tsv, validated against the frozen
//    harvest by index so a key can never drift from what the game rendered.
//
// Line-break convention in the translations file (it is plain text, not JSON):
//   <LF>   -> a real LF (0x0A)
//   <CRLF> -> a real CRLF (0x0D 0x0A) — rejected here: the game never renders a CR
//   \n     -> a literal backslash + n, exactly as typed
//   <TAB>  -> a literal tab
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const HARVEST = path.join(REPO, 'tools/sources/ui-round8-harvest.json');
const TRANSLATIONS = path.join(REPO, 'tools/sources/ui-round8-translations.tsv');
const TABLE = path.join(REPO, 'translation/ui/en.json');
const OUTPUT = path.join(REPO, 'tools/sources/ui-round8.json');

const JAPANESE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/;

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

// Placeholders are digit runs outside rich-text tags in the source; the value must carry one '#'
// per run, also outside tags (a '#0096ff' inside a <color=...> tag is not a placeholder).
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
    return value.split('<CRLF>').join('\r\n').split('<LF>').join('\n').split('<TAB>').join('\t');
}

const harvest = JSON.parse(fs.readFileSync(HARVEST, 'utf8'));
const table = JSON.parse(fs.readFileSync(TABLE, 'utf8'));
const raw = fs.readFileSync(TRANSLATIONS, 'utf8');
const strings = {};
const templates = {};
const problems = [];
const warnings = [];
let applied = 0;

for (const line of raw.split(/\r?\n/)) {
    if (line === '' || line.startsWith('#')) continue;
    const tab = line.indexOf('\t');
    if (tab < 0) { problems.push('no tab: ' + line.slice(0, 60)); continue; }
    const index = Number(line.slice(0, tab));
    const value = expand(line.slice(tab + 1));
    if (!Number.isInteger(index) || index < 1 || index > harvest.length) {
        problems.push('bad index: ' + line.slice(0, 60));
        continue;
    }
    const source = harvest[index - 1];
    const key = templateKey(source);
    const isTemplate = key !== source;
    const label = '[' + index + ' ' + (isTemplate ? 'T' : 'S') + ']';

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
    if (isTemplate && Object.prototype.hasOwnProperty.call(templates, key) && templates[key] !== value)
        problems.push(label + ' template already set with a different value');
    if (!isTemplate && Object.prototype.hasOwnProperty.call(strings, key) && strings[key] !== value)
        problems.push(label + ' string already set with a different value');

    if (isTemplate) templates[key] = value; else strings[key] = value;
    applied += 1;
}

// The newline repair runs on the committed table only: every authoring surface of this round rejects a
// CR outright, so nothing added above can need it.
const remove = { strings: [], templates: [] };
const repaired = { strings: 0, templates: 0, redundant: 0 };
const kept = { strings: [], templates: [] };
for (const name of ['strings', 'templates']) {
    for (const [key, value] of Object.entries(table[name])) {
        if (!key.includes('\r\n')) continue;
        const twin = key.split('\r\n').join('\n');
        const fixed = value.split('\r\n').join('\n');
        const existing = twin in table.strings ? table.strings[twin]
            : twin in table.templates ? table.templates[twin] : undefined;
        remove[name].push(key);
        if (existing === fixed) { repaired.redundant += 1; continue; }
        if (existing !== undefined) {
            warnings.push('kept the existing LF entry for ' + JSON.stringify(twin.slice(0, 60)));
            continue;
        }
        if (Object.prototype.hasOwnProperty.call(strings, twin) || Object.prototype.hasOwnProperty.call(templates, twin)) {
            problems.push('the LF twin of ' + JSON.stringify(twin.slice(0, 60)) + ' is also authored in the TSV');
            continue;
        }
        kept[name].push([twin, fixed]);
        repaired[name] += 1;
    }
}
for (const name of ['strings', 'templates']) {
    for (const [key, value] of kept[name]) {
        if (name === 'templates') templates[key] = value; else strings[key] = value;
        applied += 1;
    }
}

const additions = { strings, templates, remove };
fs.writeFileSync(OUTPUT, JSON.stringify(additions, null, 2) + '\n', 'utf8');

// What the merged table will look like, so the report can say whether the round is finished.
const after = { strings: { ...table.strings }, templates: { ...table.templates } };
for (const name of ['strings', 'templates']) {
    for (const key of remove[name]) delete after[name][key];
    for (const [key, value] of Object.entries(additions[name])) after[name][key] = value;
}
const unresolved = harvest.filter(text => {
    if (Object.prototype.hasOwnProperty.call(after.strings, text)) return false;
    return !Object.prototype.hasOwnProperty.call(after.templates, templateKey(text));
});

console.log('applied rows        :', applied);
console.log('new strings         :', Object.keys(strings).length);
console.log('new templates       :', Object.keys(templates).length);
console.log('CRLF keys retired   :', remove.strings.length + remove.templates.length,
    '(strings=' + remove.strings.length + ' templates=' + remove.templates.length + ')');
console.log('  LF twins added    :', repaired.strings + repaired.templates,
    '(strings=' + repaired.strings + ' templates=' + repaired.templates + ')');
console.log('  twin already LF   :', repaired.redundant);
console.log('unresolved harvest  :', unresolved.length);
for (const text of unresolved) console.log('  ' + JSON.stringify(text.slice(0, 100)));
console.log('problems            :', problems.length);
for (const p of problems) console.log('  ' + p);
console.log('warnings            :', warnings.length);
for (const w of warnings) console.log('  ' + w);
