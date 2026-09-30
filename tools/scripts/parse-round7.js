const fs = require('fs');
const path = require('path');

const srcPath = 'C:/Users/Andrew/Desktop/translatethis.txt';
const content = fs.readFileSync(srcPath, 'utf8');

// Split on the log marker. The marker never occurs inside a rendered string, so every chunk is
// "<rendered text>" + the closing quote + whatever non-[UI] log lines follow it.
// The closing quote is therefore the LAST quote in the chunk, because the trailing lines
// ([Warning: ...] Scenario translation load failed, [SCENE ...] untranslated lines recorded) contain none.
const MARKER = '[UI] untranslated text: "';
const chunks = content.split(MARKER).slice(1);

const lines = [];
for (const chunk of chunks) {
    const end = chunk.lastIndexOf('"');
    if (end < 0) continue;
    const text = chunk.slice(0, end);
    if (text === '') continue;
    lines.push(text);
}

console.log('Extracted lines:', lines.length);

const outHarvest = path.join(__dirname, '../sources/ui-round7-harvest.json');
fs.writeFileSync(outHarvest, JSON.stringify(lines, null, 2), 'utf8');

const outSources = path.join(__dirname, '../sources/ui-round7-sources.txt');
fs.writeFileSync(outSources, lines.map((l, i) => `${i + 1}\t${l}`).join('\n'), 'utf8');
console.log('Written harvest (' + lines.length + ') and sources.');


