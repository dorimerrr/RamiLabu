// Round 7 builder.
// Keys are taken FROM the frozen harvest by index, so a table entry can never drift from what the
// game rendered. The translations file supplies only "<index>\t<english>".
//
// Line-break convention in the translations file (it is plain text, not JSON):
//   <LF>   -> a real LF (0x0A)
//   <CRLF> -> a real CRLF (0x0D 0x0A)
//   \n     -> a literal backslash + n, exactly as typed
//   <TAB>  -> a literal tab
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const HARVEST = path.join(REPO, 'tools/sources/ui-round7-harvest.json');
const TRANSLATIONS = path.join(REPO, 'tools/sources/ui-round7-translations.tsv');
const OUTPUT = path.join(REPO, 'tools/sources/ui-round7.json');

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
const raw = fs.readFileSync(TRANSLATIONS, 'utf8');
const strings = {};
const templates = {};
const problems = [];
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

    if (value === '') { problems.push(label + ' empty value'); continue; }
    if (value === key) { problems.push(label + ' value equals key'); continue; }
    if (isTemplate) {
        const expected = countRuns(source, 'digit');
        const actual = countRuns(value, '#');
        if (expected !== actual) {
            problems.push(label + ' placeholder mismatch: key has ' + expected + ' run(s), value has ' + actual + ' "#"');
            continue;
        }
    }
    if (isTemplate && Object.prototype.hasOwnProperty.call(templates, key) && templates[key] !== value) {
        problems.push(label + ' template already set with a different value');
    }
    if (!isTemplate && Object.prototype.hasOwnProperty.call(strings, key) && strings[key] !== value) {
        problems.push(label + ' string already set with a different value');
    }

    if (isTemplate) templates[key] = value; else strings[key] = value;
    applied += 1;
}

const additions = { strings, templates, remove: { strings: [], templates: [] } };
fs.writeFileSync(OUTPUT, JSON.stringify(additions, null, 2) + '\n', 'utf8');

console.log('applied rows :', applied);
console.log('new strings  :', Object.keys(strings).length);
console.log('new templates:', Object.keys(templates).length);
console.log('problems     :', problems.length);
for (const p of problems) console.log('  ' + p);
