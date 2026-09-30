// Same audit as audit-newlines.js for the scenario tables: is any CR inside a key even renderable?
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = 'C:/Users/Andrew/Desktop/RamiLabu';
const DUMP = 'C:/Users/Andrew/muv_luv_girlsgardenx_cl/BepInEx/plugins/MuvluvMod/translation/scene-dump';

const dumps = fs.existsSync(DUMP) ? fs.readdirSync(DUMP) : [];
let dumpKeys = 0, dumpCr = 0, dumpCrlf = 0, dumpLf = 0;
for (const file of dumps) {
    const keys = Object.keys(JSON.parse(fs.readFileSync(path.join(DUMP, file), 'utf8')));
    for (const key of keys) {
        dumpKeys++;
        if (key.includes('\r\n')) dumpCrlf++; else if (key.includes('\r')) dumpCr++; else if (key.includes('\n')) dumpLf++;
    }
}
console.log(`scene-dump (game output): files=${dumps.length} keys=${dumpKeys} withCRLF=${dumpCrlf} withCR=${dumpCr} withLFonly=${dumpLf}`);

const sceneDir = path.join(REPO, 'translation/scenes');
let files = 0, crlfKeys = 0, lfKeys = 0, affected = [];
for (const id of fs.readdirSync(sceneDir)) {
    const file = path.join(sceneDir, id, 'en.json');
    if (!fs.existsSync(file)) continue;
    files++;
    const keys = Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')));
    let cr = 0, lf = 0;
    for (const key of keys) {
        if (key.includes('\r\n')) cr++; else if (key.includes('\n')) lf++;
    }
    crlfKeys += cr; lfKeys += lf;
    if (cr > 0) affected.push([id, cr]);
}
console.log(`committed scenes: files=${files} keysWithCRLF=${crlfKeys} keysWithLFonly=${lfKeys} affectedFiles=${affected.length}`);
console.log(affected.map(([id, cr]) => `  ${id} (${cr})`).join('\n'));
