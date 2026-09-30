// Classifies the harvest strings that are still missing from the table after round 7.
const fs = require('fs');
const path = require('path');
const REPO = 'C:/Users/Andrew/Desktop/RamiLabu';

const ui = JSON.parse(fs.readFileSync(path.join(REPO, 'translation/ui/en.json'), 'utf8'));
const harvest = JSON.parse(fs.readFileSync(path.join(REPO, 'tools/sources/ui-round7-harvest.json'), 'utf8'));

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

const cjk = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff66-\uff9f]/;
const buckets = { noparse: [], english: [], cjkMissing: [] };
const seen = new Set();

harvest.forEach((s, i) => {
    if (Object.prototype.hasOwnProperty.call(ui.strings, s)) return;
    const key = templateKey(s);
    if (Object.prototype.hasOwnProperty.call(ui.templates, key)) return;
    if (seen.has(s)) return;
    seen.add(s);
    if (s.startsWith('<noparse>')) buckets.noparse.push([i + 1, s]);
    else if (!cjk.test(s)) buckets.english.push([i + 1, s]);
    else buckets.cjkMissing.push([i + 1, s]);
});

console.log('distinct still-missing keys:');
console.log('  <noparse> player content :', buckets.noparse.length);
console.log('  already English          :', buckets.english.length);
console.log('  CJK still untranslated   :', buckets.cjkMissing.length);

console.log('\n--- CJK STILL UNTRANSLATED ---');
for (const [i, s] of buckets.cjkMissing) console.log(`  [${i}] ${JSON.stringify(s.slice(0, 160))}`);
