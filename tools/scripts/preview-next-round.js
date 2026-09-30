// Preview of the *next* round: the strings in the live log that the table still does not resolve.
// Same gate as the client (ContainsJapanese) plus the two lookup tables, so an entry that is already
// English is never counted as backlog. -Harvest '' reads the live log.
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = 'C:/Users/Andrew/Desktop/RamiLabu';
const LOG = 'C:/Users/Andrew/muv_luv_girlsgardenx_cl/BepInEx/LogOutput.log';

const ui = JSON.parse(fs.readFileSync(path.join(REPO, 'translation/ui/en.json'), 'utf8'));
const cjk = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff66-\uff9f]/;

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

const raw = fs.readFileSync(LOG, 'utf8');
const seen = [...raw.matchAll(/\[UI\] untranslated text: "(.*?)"\r?\n/gs)].map(m => m[1]);
const distinct = [...new Set(seen)];
const unresolved = distinct.filter(s => !(s in ui.strings) && !(templateKey(s) in ui.templates));

console.log(`log entries=${seen.length} distinct=${distinct.length} unresolved=${unresolved.length}`);
console.log(`  CJK still untranslated : ${unresolved.filter(s => cjk.test(s)).length}`);
console.log(`  already English        : ${unresolved.filter(s => !cjk.test(s)).length}`);
console.log('\n--- CJK STILL UNTRANSLATED ---');
for (const s of unresolved.filter(s => cjk.test(s))) console.log('  ' + JSON.stringify(s));
