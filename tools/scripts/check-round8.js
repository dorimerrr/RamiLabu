// Round 8 verifier: the invariants the client depends on, checked against the merged table.
//
//  1. No key or value contains a CR. The engine renders a line break as a bare LF (the live log and the
//     scene dump hold no CR at all), so a CRLF key can never match.
//  2. Every templates entry the client can reach carries exactly one '#' per placeholder of its key, so
//     TrySubstituteDigits fills every placeholder (a '#' inside a <...> tag is markup and does not
//     count). An entry the client cannot reach is inert and is reported as a warning instead: it cannot
//     change a render, so it can only be dead weight (tools/scripts/audit-templates.js triages those).
//  3. Every string in the frozen harvest either matches an exact entry or resolves through a template,
//     with a value that is neither empty nor identical to its key.
//
// Usage: node tools/scripts/check-round8.js
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const ui = JSON.parse(fs.readFileSync(path.join(REPO, 'translation/ui/en.json'), 'utf8'));
const harvest = JSON.parse(fs.readFileSync(path.join(REPO, 'tools/sources/ui-round8-harvest.json'), 'utf8'));
// The records of the round: the authored translations and the reachability repair.
const additions = ['ui-round8.json', 'ui-round8-reachability.json']
    .map(file => JSON.parse(fs.readFileSync(path.join(REPO, 'tools/sources', file), 'utf8')));
// UiTextResolver.MaxSubstitutions.
const CAP = 8;

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

const failures = [];
const warnings = [];
for (const name of ['strings', 'templates']) {
    for (const [key, value] of Object.entries(ui[name])) {
        if (key.includes('\r') || value.includes('\r'))
            failures.push(`${name} entry contains a CR: ${JSON.stringify(key.slice(0, 60))}`);
        if (value === '') failures.push(`${name} entry has an empty value: ${JSON.stringify(key.slice(0, 60))}`);
        if (value === key) failures.push(`${name} entry equals its key: ${JSON.stringify(key.slice(0, 60))}`);
    }
}

// A template key keeps '#' where the source had digits, so key and value must agree on the count. A key
// without a '#' outside markup never comes back from NormalizeTemplate, and a value past the client's
// substitution cap is refused, so both classes are dead rather than wrong.
for (const [key, value] of Object.entries(ui.templates)) {
    const placeholders = countRuns(key, '#');
    const filled = countRuns(value, '#');
    if (placeholders === 0 || filled > CAP) {
        warnings.push(`template ${JSON.stringify(key.slice(0, 60))}: unreachable ` +
            `(${placeholders} '#' in the key, ${filled} in the value)`);
        continue;
    }
    if (placeholders !== filled)
        failures.push(`template ${JSON.stringify(key.slice(0, 60))}: ${placeholders} '#' in the key, ${filled} in the value`);
}

const unresolved = [];
for (const text of harvest) {
    if (Object.prototype.hasOwnProperty.call(ui.strings, text)) {
        if (ui.strings[text] === '' || ui.strings[text] === text)
            failures.push(`harvest string has an unusable entry: ${JSON.stringify(text.slice(0, 60))}`);
        continue;
    }
    const key = templateKey(text);
    if (Object.prototype.hasOwnProperty.call(ui.templates, key)) {
        if (ui.templates[key] === '' || ui.templates[key] === key)
            failures.push(`harvest template has an unusable entry: ${JSON.stringify(key.slice(0, 60))}`);
        continue;
    }
    unresolved.push(text);
}

// The additions files are the record of the round, so both halves of each change must be in the table.
for (const file of additions) {
    for (const name of ['strings', 'templates']) {
        for (const key of Object.keys(file[name]))
            if (!Object.prototype.hasOwnProperty.call(ui[name], key))
                failures.push(`added key is missing from the table: ${JSON.stringify(key.slice(0, 60))}`);
        for (const key of file.remove[name])
            if (Object.prototype.hasOwnProperty.call(ui[name], key))
                failures.push(`retired key is still in the table: ${JSON.stringify(key.slice(0, 60))}`);
    }
}

const templateCount = Object.keys(ui.templates).length;
console.log(`table          : ${Object.keys(ui.strings).length} strings + ${templateCount} templates`);
console.log(`harvest        : ${harvest.length} strings, unresolved=${unresolved.length}`);
for (const text of unresolved) console.log('  UNRESOLVED ' + JSON.stringify(text.slice(0, 100)));
console.log(`additions      : ` + additions.map((file, index) =>
    `${['authored', 'reachability'][index]} +${Object.keys(file.strings).length}/${Object.keys(file.templates).length}` +
    ` -${file.remove.strings.length}/${file.remove.templates.length}`).join(', '));
console.log(`failures       : ${failures.length}`);
for (const failure of failures) console.log('  ' + failure);
console.log(`warnings       : ${warnings.length} dead template(s), triaged in tools/reports/template-reachability.txt`);
for (const warning of warnings) console.log('  ' + warning);
if (failures.length > 0 || unresolved.length > 0) process.exitCode = 1;
