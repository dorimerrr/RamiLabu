const fs = require('fs');
const path = require('path');
const REPO = 'C:/Users/Andrew/Desktop/RamiLabu';
const ui = JSON.parse(fs.readFileSync(path.join(REPO, 'translation/ui/en.json'), 'utf8'));

const probes = [
    ['strings', '\u9178\u6027\u306e\u6cbc\r\n'],
    ['strings', '\u6307\u63ee\u5b98'],
    ['templates', '\u6b8b\u308a\u6642\u9593\uff1a\u3042\u3068#\u6642\u9593#\u5206#\u79d2'],
    ['templates', '\u540c\u5c5e\u6027\u30ab\u30fc\u30c9\u5fc5\u8981\u6570\r\n#\uff0b#'],
];

for (const [section, key] of probes) {
    const table = ui[section];
    const value = table[key];
    console.log(section, JSON.stringify(key.slice(0, 40)), '=>', value === undefined ? 'MISSING' : JSON.stringify(value));
}

// Count how many string keys still equal their value (identity entries the client drops)
let identity = 0;
for (const [k, v] of Object.entries(ui.strings)) if (k === v) identity += 1;
let templateIdentity = 0;
for (const [k, v] of Object.entries(ui.templates)) if (k === v) templateIdentity += 1;
console.log('identity strings:', identity, 'identity templates:', templateIdentity);
console.log('total strings:', Object.keys(ui.strings).length, 'total templates:', Object.keys(ui.templates).length);
