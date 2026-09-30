// Builds the round-7 authoring worksheet: one line per entry that still needs work,
// deduplicated by key, carrying the harvest index so the build step never retypes a key.
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

// Visible-escape form so clues like real CRLF vs. a literal backslash-n survive the worksheet
function escape(text) {
    return text.replace(/\\/g, '\\\\').replace(/\r/g, '<CR>').replace(/\n/g, '<LF>').replace(/\t/g, '<TAB>');
}

const rows = [];
const done = new Set();
const skipped = { covered: 0, noparse: 0 };

harvest.forEach((source, index) => {
    const key = templateKey(source);
    const kind = key === source ? 'S' : 'T';
    const lookupKey = kind === 'S' ? source : key;

    if (kind === 'S' && Object.prototype.hasOwnProperty.call(ui.strings, source)) { skipped.covered += 1; return; }
    if (kind === 'T' && Object.prototype.hasOwnProperty.call(ui.templates, key)) { skipped.covered += 1; return; }
    if (source.startsWith('<noparse>')) { skipped.noparse += 1; return; }

    const id = kind + '\u0000' + lookupKey;
    if (done.has(id)) return;
    done.add(id);

    rows.push({ index: index + 1, kind, key: lookupKey, source, length: source.length });
});

rows.sort((a, b) => a.length - b.length);

const lines = rows.map(r => `${r.index}\t${r.kind}\t${escape(r.source)}`);
fs.writeFileSync(path.join(REPO, 'tools/sources/round7-todo.tsv'), lines.join('\n') + '\n', 'utf8');

const s = rows.filter(r => r.kind === 'S').length;
const t = rows.filter(r => r.kind === 'T').length;
console.log('todo rows:', rows.length, '(S=' + s + ', T=' + t + ')');
console.log('skipped covered:', skipped.covered, 'skipped noparse:', skipped.noparse);

const buckets = [20, 40, 60, 100, 200, 400, 10000];
let prev = 0;
for (const b of buckets) {
    console.log(`  length <= ${b}:`, rows.filter(r => r.length > prev && r.length <= b).length);
    prev = b;
}
