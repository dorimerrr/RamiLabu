// Probe for the round 8 newline repair: how many committed keys contain a CRLF, and what the LF twin
// of each one looks like.
'use strict';

const fs = require('fs');
const ui = JSON.parse(fs.readFileSync('translation/ui/en.json', 'utf8'));

let same = 0;
const different = [];
const fresh = [];
for (const table of ['strings', 'templates']) {
    for (const [key, value] of Object.entries(ui[table])) {
        if (!key.includes('\r\n')) continue;
        const twin = key.split('\r\n').join('\n');
        const there = ui[table][twin] ?? ui[table === 'strings' ? 'templates' : 'strings'][twin];
        if (there === undefined) fresh.push([table, twin]);
        else if (there === value.split('\r\n').join('\n')) same++;
        else different.push([table, twin, there]);
    }
}
console.log(`CRLF keys: twins missing=${fresh.length} identical=${same} conflicting=${different.length}`);
console.log('\n--- conflicts ---');
for (const [table, twin, there] of different) console.log(`${table}\n  twin: ${JSON.stringify(twin)}\n  kept: ${JSON.stringify(there)}`);
console.log('\n--- fresh twins (first 12) ---');
for (const [table, twin] of fresh.slice(0, 12)) console.log(`${table}  ${JSON.stringify(twin)}`);
