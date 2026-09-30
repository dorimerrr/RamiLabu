const fs = require('fs');
const path = require('path');
const REPO = 'C:/Users/Andrew/Desktop/RamiLabu';

const content = fs.readFileSync('C:/Users/Andrew/Desktop/translatethis.txt', 'utf8');
const marker = '[UI] untranslated text: "';
let n = 0;
let i = 0;
while ((i = content.indexOf(marker, i)) >= 0) { n += 1; i += marker.length; }
console.log('marker occurrences:', n);

const harvest = JSON.parse(fs.readFileSync(path.join(REPO, 'tools/sources/ui-round7-harvest.json'), 'utf8'));
console.log('harvest entries  :', harvest.length);
console.log('empty entries    :', harvest.filter(s => s === '').length);

const suspicious = harvest.filter(s => s.includes('untranslated text') || s.includes('[Info   :') || s.includes('Scenario translation load failed'));
console.log('suspicious       :', suspicious.length);
for (const s of suspicious.slice(0, 5)) console.log('  ' + JSON.stringify(s.slice(0, 150)));

// Entries whose text ends without a quote-close indicator often mean the split misfired
const noLineHeightReason = harvest.filter(s => s.endsWith('[Info') || s.endsWith('[Warning'));
console.log('ends with tag    :', noLineHeightReason.length);
