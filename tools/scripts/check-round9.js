// Round 9 verifier: the invariants the client depends on, plus the round's own records.
//
//  1. No key or value in the interface table contains a CR (the engine renders a bare LF).
//  2. Every templates entry the client can reach carries exactly one '#' per placeholder of its key.
//  3. Every interface entry of the frozen batch resolves - through the exact table or a template - with a
//     value that is neither empty nor identical to its key. Lines of scene 10280101 that the UI log also
//     reported are resolved by translation/scenes/10280101/en.json instead (its keys carry the
//     %usernameusernameuserna% placeholder), and entries that are already English need no value at all.
//  4. Both halves of every change recorded in tools/sources/ui-round9.json are in the table.
//
// Usage: node tools/scripts/check-round9.js
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const ui = JSON.parse(fs.readFileSync(path.join(REPO, 'translation/ui/en.json'), 'utf8'));
const harvest = JSON.parse(fs.readFileSync(path.join(REPO, 'tools/sources/ui-round9-harvest.json'), 'utf8'));
const additions = JSON.parse(fs.readFileSync(path.join(REPO, 'tools/sources/ui-round9.json'), 'utf8'));
const sceneLines = new Set(JSON.parse(fs.readFileSync(path.join(REPO, 'tools/reports/round9-scene-keys.json'), 'utf8')));
const SCENE_FILE = path.join(REPO, 'translation/scenes/10280101/en.json');
const scene = fs.existsSync(SCENE_FILE) ? JSON.parse(fs.readFileSync(SCENE_FILE, 'utf8')) : null;
const CAP = 8;
// UiTextResolver.MaxSubstitutions (see AGENTS.md 2.1).
// "Needs translation" means kana or kanji. Full-width punctuation (～, ！, ：) is not a letter, so an entry
// that only uses it is already English and needs no value at all.
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

// The scenario table is keyed by the scene dump, where the player name is still the placeholder.
function sceneKeyOf(text) {
    const bare = text
        .replace(/^<line-height=2\.000em>/, '')
        .replace(/<noparse>[^<]*<\/noparse>/g, '%usernameusernameuserna%');
    if (scene && Object.prototype.hasOwnProperty.call(scene, bare)) return bare;
    const direct = text.replace(/^<line-height=2\.000em>/, '');
    return scene && Object.prototype.hasOwnProperty.call(scene, direct) ? direct : null;
}


const failures = [];
const warnings = [];
const english = [];
const sceneResolved = [];

for (const name of ['strings', 'templates']) {
    for (const [key, value] of Object.entries(ui[name])) {
        if (key.includes('\r') || value.includes('\r'))
            failures.push(`${name} entry contains a CR: ${JSON.stringify(key.slice(0, 60))}`);
        if (value === '') failures.push(`${name} entry has an empty value: ${JSON.stringify(key.slice(0, 60))}`);
        if (value === key) failures.push(`${name} entry equals its key: ${JSON.stringify(key.slice(0, 60))}`);
    }
}

for (const [key, value] of Object.entries(ui.templates)) {
    const placeholders = countRuns(key, '#');
    const filled = countRuns(value, '#');
    if (placeholders === 0 || filled > CAP) {
        warnings.push(`template ${JSON.stringify(key.slice(0, 60))}: unreachable (${placeholders} '#' in the key, ${filled} in the value)`);
        continue;
    }
    if (placeholders !== filled)
        failures.push(`template ${JSON.stringify(key.slice(0, 60))}: ${placeholders} '#' in the key, ${filled} in the value`);
}

const unresolved = [];
for (const text of harvest) {
    if (sceneLines.has(text)) {
        if (scene === null) { warnings.push(`scene line waits for 10280101/en.json: ${JSON.stringify(text.slice(0, 60))}`); continue; }
        const key = sceneKeyOf(text);
        if (key === null) failures.push(`scene line is missing from 10280101/en.json: ${JSON.stringify(text.slice(0, 70))}`);
        else if (scene[key] === '' || scene[key] === key) failures.push(`scene entry is unusable: ${JSON.stringify(key.slice(0, 70))}`);
        else sceneResolved.push(text);
        continue;
    }
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
    if (!JAPANESE.test(text)) { english.push(text); continue; }
    unresolved.push(text);
}

for (const name of ['strings', 'templates']) {
    for (const [key, value] of Object.entries(additions[name])) {
        if (!Object.prototype.hasOwnProperty.call(ui[name], key))
            failures.push(`added key is missing from the table: ${JSON.stringify(key.slice(0, 60))}`);
        else if (ui[name][key] !== value)
            failures.push(`added key has a different value in the table: ${JSON.stringify(key.slice(0, 60))}`);
        if (ui[name][key] === key || ui[name][key] === '')
            failures.push(`added key is unusable: ${JSON.stringify(key.slice(0, 60))}`);
    }
    for (const key of additions.remove[name])
        if (Object.prototype.hasOwnProperty.call(ui[name], key))
            failures.push(`retired key is still in the table: ${JSON.stringify(key.slice(0, 60))}`);
}

console.log(`table          : ${Object.keys(ui.strings).length} strings + ${Object.keys(ui.templates).length} templates`);
console.log(`round 9        : +${Object.keys(additions.strings).length}/+${Object.keys(additions.templates).length} authored`);
console.log(`batch          : ${harvest.length} entries, scene=${sceneResolved.length}, already-English=${english.length}, unresolved=${unresolved.length}`);
for (const text of unresolved) console.log('  UNRESOLVED ' + JSON.stringify(text.slice(0, 100)));
if (scene) console.log(`scene 10280101 : ${Object.keys(scene).length} entries`);
console.log(`failures       : ${failures.length}`);
for (const failure of failures) console.log('  ' + failure);
console.log(`warnings       : ${warnings.length}` + (scene === null ? ' (scene file pending)' : ' dead template(s)/notes'));
if (failures.length > 0 || unresolved.length > 0) process.exitCode = 1;
