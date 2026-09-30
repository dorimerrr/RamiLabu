// Lists every worksheet row that has no translation yet, so the remaining set can be inspected.
const fs = require('fs');
const path = require('path');
const REPO = 'C:/Users/Andrew/Desktop/RamiLabu';

const todo = fs.readFileSync(path.join(REPO, 'tools/sources/round7-todo.tsv'), 'utf8')
    .split(/\r?\n/).filter(l => l !== '');
const have = new Set();
for (const line of fs.readFileSync(path.join(REPO, 'tools/sources/ui-round7-translations.tsv'), 'utf8').split(/\r?\n/)) {
    if (line === '' || line.startsWith('#')) continue;
    const tab = line.indexOf('\t');
    if (tab > 0) have.add(Number(line.slice(0, tab)));
}

const missing = [];
for (const line of todo) {
    const index = Number(line.slice(0, line.indexOf('\t')));
    if (!have.has(index)) missing.push(line);
}

console.log('todo rows      :', todo.length);
console.log('translated rows:', have.size);
console.log('missing rows   :', missing.length);

// An untranslatable row is one whose source contains no Japanese/Chinese characters
const cjk = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff66-\uff9f]/;
const nonCjk = missing.filter(l => !cjk.test(l.split('\t').slice(2).join('\t')));
const realMissing = missing.filter(l => cjk.test(l.split('\t').slice(2).join('\t')));

console.log('\n--- non-CJK (already English) ---');
for (const l of nonCjk) console.log('  ' + l.slice(0, 100));

if (realMissing.length > 0) {
    console.log('\n--- STILL NEEDS WORK ---');
    for (const l of realMissing) console.log('  ' + l.slice(0, 140));
}
