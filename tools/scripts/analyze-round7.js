// Analysis for round 7: classify harvested strings against the existing UI table.
// Reads the frozen harvest and reports what needs an exact string vs. a template.
const fs = require('fs');
const path = require('path');

const REPO = 'C:/Users/Andrew/Desktop/RamiLabu';
const ui = JSON.parse(fs.readFileSync(path.join(REPO, 'translation/ui/en.json'), 'utf8'));
const harvest = JSON.parse(fs.readFileSync(path.join(REPO, 'tools/sources/ui-round7-harvest.json'), 'utf8'));

// Mirror of the client's template key: digit runs outside rich-text tags collapse to '#'
function templateKey(text) {
    const out = [];
    let inTag = false;
    let inRun = false;
    for (const ch of Array.from(text)) {
        if (ch === '<') inTag = true;
        const isDigit = !inTag && ch >= '0' && ch <= '9';
        if (isDigit) {
            if (!inRun) out.push('#');
            inRun = true;
            continue;
        }
        inRun = false;
        if (inTag && ch === '>') inTag = false;
        out.push(ch);
    }
    return out.join('');
}

const seen = new Set();
const unique = [];
for (const s of harvest) {
    if (!seen.has(s)) { seen.add(s); unique.push(s); }
}

const report = { stringCovered: [], templateCovered: [], needString: [], needTemplate: [], noparse: [] };

for (const s of unique) {
    if (Object.prototype.hasOwnProperty.call(ui.strings, s)) { report.stringCovered.push(s); continue; }
    const key = templateKey(s);
    if (Object.prototype.hasOwnProperty.call(ui.templates, key)) { report.templateCovered.push(s); continue; }
    if (s.startsWith('<noparse>')) { report.noparse.push(s); continue; }
    if (key !== s) report.needTemplate.push(s);
    else report.needString.push(s);
}

console.log('harvest total  :', harvest.length);
console.log('unique         :', unique.length);
console.log('string covered :', report.stringCovered.length);
console.log('templatecovered:', report.templateCovered.length);
console.log('noparse (skip) :', report.noparse.length);
console.log('need NEW string:', report.needString.length);
console.log('need NEW templ :', report.needTemplate.length);

// Group the new-template candidates by their template key so several sources collapse into one entry
const groups = new Map();
for (const s of report.needTemplate) {
    const key = templateKey(s);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
}
console.log('distinct new templates needed:', groups.size);
console.log('\n--- NEW TEMPLATE KEYS (count of sources) ---');
for (const [key, list] of [...groups.entries()].sort()) {
    console.log(`${list.length}\t${JSON.stringify(key)}`);
}

fs.writeFileSync(path.join(REPO, 'tools/sources/round7-analysis.json'), JSON.stringify({
    needString: report.needString,
    needTemplateGroups: Object.fromEntries(groups),
    templateCovered: report.templateCovered,
    noparse: report.noparse,
}, null, 2), 'utf8');
console.log('\nwrote tools/sources/round7-analysis.json');
