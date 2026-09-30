// Compares the newline characters the game actually logged with the ones the round sources recorded.
'use strict';

const fs = require('fs');

function stats(label, list) {
    let crlf = 0, lf = 0, cr = 0;
    for (const text of list) {
        if (text.includes('\r\n')) crlf++;
        const stripped = text.split('\r\n').join('');
        if (stripped.includes('\n')) lf++;
        if (stripped.includes('\r')) cr++;
    }
    console.log(`${label}: entries=${list.length} withCRLF=${crlf} withLF=${lf} withCR=${cr}`);
}

const raw = fs.readFileSync('C:/Users/Andrew/muv_luv_girlsgardenx_cl/BepInEx/LogOutput.log', 'utf8');
const live = [...raw.matchAll(/\[UI\] untranslated text: "(.*?)"\r?\n/gs)].map(m => m[1]);
stats('live log          ', live);
stats('round7 harvest    ', JSON.parse(fs.readFileSync('tools/sources/ui-round7-harvest.json', 'utf8')));
stats('round8 harvest    ', JSON.parse(fs.readFileSync('tools/sources/ui-round8-harvest.json', 'utf8')));
stats('translatethis.txt ', fs.readFileSync('C:/Users/Andrew/Desktop/translatethis.txt', 'utf8')
    .split('[UI] untranslated text: "').slice(1).map(c => c.slice(0, c.lastIndexOf('"'))).filter(Boolean));

// A text file the game never touches cannot introduce a CR, so any CR in a *harvest* only tells us how
// the snapshot was saved; the live log is the game's own output.
const committed = JSON.parse(fs.readFileSync('translation/ui/en.json', 'utf8'));
const all = { ...committed.strings, ...committed.templates };
let crlfKeys = 0, lfKeys = 0;
for (const key of Object.keys(all)) {
    if (key.includes('\r\n')) crlfKeys++;
    else if (key.includes('\n')) lfKeys++;
}
console.log(`committed table: keys with CRLF=${crlfKeys} with LF only=${lfKeys}`);
