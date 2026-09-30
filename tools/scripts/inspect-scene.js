const fs = require('fs');
const path = require('path');
const REPO = 'C:/Users/Andrew/Desktop/RamiLabu';

const file = path.join(REPO, 'translation/scenes/10000101/en.json');
const raw = fs.readFileSync(file, 'utf8');
const data = JSON.parse(raw);

const keys = Object.keys(data);
console.log('entries:', keys.length);
console.log('keys containing a real newline :', keys.filter(k => k.includes('\n')).length);
console.log('keys containing a literal n-escape:', keys.filter(k => k.includes('\\n')).length);
console.log('keys containing full-width space:', keys.filter(k => k.includes('\u3000')).length);

const withNl = keys.find(k => k.includes('\n') || k.includes('\\n'));
console.log('\n--- sample key ---');
console.log(JSON.stringify(withNl));
console.log('--- sample value ---');
console.log(JSON.stringify(data[withNl]));
console.log('\n--- file tail (raw) ---');
console.log(JSON.stringify(raw.slice(-160)));
