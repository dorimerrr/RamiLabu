// Triage helper for check-round8.js failures: given a key, find the raw strings in the harvest
// sources that normalise to it, plus what the committed table currently answers for them.
//
// Usage: node tools/scripts/find-raw-source.js "<key>" ["<key>" ...]
//        node tools/scripts/find-raw-source.js --no-hash "<key>"      (treat '#' as a literal)
'use strict';

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const strictHash = !args.includes('--no-hash');
const targets = args.filter(a => a !== '--no-hash');
if (targets.length === 0) {
    console.error('usage: node tools/scripts/find-raw-source.js "<key>" ["<key>" ...]');
    process.exit(2);
}

function templateKey(text, hashIsDigit) {
    const out = [];
    let inTag = false;
    let inRun = false;
    for (const ch of Array.from(text)) {
        if (ch === '<') inTag = true;
        const isDigit = hashIsDigit && !inTag && (ch === '#' || (ch >= '0' && ch <= '9'));
        if (isDigit) { if (!inRun) out.push('#'); inRun = true; continue; }
        inRun = false;
        if (inTag && ch === '>') inTag = false;
        out.push(ch);
    }
    return out.join('');
}

const REPO = path.join(__dirname, '..', '..');
const ui = JSON.parse(fs.readFileSync(path.join(REPO, 'translation/ui/en.json'), 'utf8'));
const wanted = new Set(targets);
const hits = new Map();

function record(raw, where) {
    const key = templateKey(raw, strictHash);
    if (!wanted.has(key)) return;
    if (!hits.has(key)) hits.set(key, []);
    hits.get(key).push({ raw, where });
}

// Walk every harvest/log source: they hold the strings exactly as the game emitted them.
const srcDir = path.join(REPO, 'tools/sources');
for (const file of fs.readdirSync(srcDir)) {
    const full = path.join(srcDir, file);
    const text = fs.readFileSync(full, 'utf8');
    const isJson = /\.json$/i.test(file);
    if (isJson) {
        let data;
        try { data = JSON.parse(text); } catch { continue; }
        const walk = (node) => {
            if (typeof node === 'string') { record(node, file); return; }
            if (Array.isArray(node)) { node.forEach(walk); return; }
            if (node && typeof node === 'object') Object.values(node).forEach(walk);
        };
        walk(data);
    } else {
        for (const line of text.split(/\r?\n/)) {
            if (line.trim() !== '') record(line.trim(), file);
            for (const part of line.split('\t')) if (part.trim() !== '') record(part.trim(), file);
        }
    }
}

for (const key of targets) {
    console.log('KEY ' + JSON.stringify(key));
    const placeholders = (key.match(/#/g) || []).length;
    const value = Object.prototype.hasOwnProperty.call(ui.templates, key) ? ui.templates[key]
        : Object.prototype.hasOwnProperty.call(ui.strings, key) ? ui.strings[key] : undefined;
    console.log('  committed: ' + (value === undefined ? '(absent)' : JSON.stringify(value)));
    const list = hits.get(key) || [];
    if (list.length === 0) { console.log('  raw sources: none found'); continue; }
    const unique = new Map();
    for (const hit of list) unique.set(JSON.stringify(hit.raw), hit);
    console.log('  raw sources: ' + unique.size);
    for (const hit of unique.values()) {
        const runs = (String(hit.raw).match(/[0-9]+/g) || []).length;
        console.log('    ' + JSON.stringify(hit.raw) + '  <- ' + hit.where +
            '  [digit runs outside tags: ' + runs + ', key placeholders: ' + placeholders + ']');
    }
}
