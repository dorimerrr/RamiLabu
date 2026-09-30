// Round 8 freeze: copies the interface strings of the current session out of the live log into the
// round's sources of record, then lists the ones the committed table still does not resolve.
//
// The client rewrites LogOutput.log on every launch, so the harvest has to be frozen before anything is
// authored; the builders read the frozen JSON by index, which is what keeps the round reproducible.
//
// Usage: node tools/scripts/freeze-round8.js
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const LOG = 'C:/Users/Andrew/muv_luv_girlsgardenx_cl/BepInEx/LogOutput.log';
const MARKER = '[UI] untranslated text: "';

const ui = JSON.parse(fs.readFileSync(path.join(REPO, 'translation/ui/en.json'), 'utf8'));
const cjk = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff66-\uff9f]/;

// Digit runs outside rich-text tags become one '#', the rule the client and the builders share.
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

// The marker never occurs inside a rendered string, so every chunk is "<rendered text>" followed by
// whatever non-[UI] log lines follow it. The closing quote is the last quote of the chunk.
const raw = fs.readFileSync(LOG, 'utf8');
const sources = [];
for (const chunk of raw.split(MARKER).slice(1)) {
    const end = chunk.lastIndexOf('"');
    if (end < 0) continue;
    const text = chunk.slice(0, end);
    if (text !== '') sources.push(text);
}

fs.writeFileSync(
    path.join(REPO, 'tools/sources/ui-round8-harvest.json'),
    JSON.stringify(sources, null, 2),
    'utf8'
);
fs.writeFileSync(
    path.join(REPO, 'tools/sources/ui-round8-sources.txt'),
    sources.map((text, i) => `${i + 1}\t${text}`).join('\n'),
    'utf8'
);

// '[BS]' marks a literal backslash, '<LF>' a real line break: a row stays one physical line.
const escape = text => text.replace(/\\/g, '[BS]').replace(/\r/g, '<CR>').replace(/\n/g, '<LF>');

const todo = sources
    .map((text, i) => ({ index: i + 1, text, key: templateKey(text) }))
    .filter(row => !(row.text in ui.strings) && !(row.key in ui.templates))
    .map(row => `${row.index}\t${row.key === row.text ? 'S' : 'T'}\t${escape(row.text)}`);

fs.writeFileSync(path.join(REPO, 'tools/sources/ui-round8-todo.tsv'), todo.join('\n') + '\n', 'utf8');

console.log(`harvest entries: ${sources.length}`);
console.log(`still unresolved: ${todo.length}`);
for (const row of todo) {
    const [index, form, text] = row.split('\t');
    console.log(`  [${index} ${form}] ${text}`);
}
const noJapanese = sources.filter(text => !cjk.test(text));
console.log(`entries with no Japanese left: ${noJapanese.length}`);
