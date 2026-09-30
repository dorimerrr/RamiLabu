// Round 8 reachability repair. The client (UiTextResolver.TryResolve) only reaches a templates entry
// when NormalizeTemplate changed the string and TrySubstituteDigits succeeded, so an entry whose key
// carries no '#' outside its markup is inert: the game keeps showing the Japanese string even though
// the table appears to translate it. tools/scripts/audit-templates.js classifies every such entry
// against the captured strings and writes tools/reports/template-reachability.json.
//
// Every entry that audit found with a live twin (the key also present in strings, or the normalised key
// already present in templates) is retired when the wording is identical: the entry can never be
// looked up, so deleting it cannot change any render, and the live twin already covers the string.
// A differing wording is left alone and reported, because it needs an author's decision.
//
// Usage: node tools/scripts/audit-templates.js && node tools/scripts/build-round8-reachability.js
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const PLAN = path.join(REPO, 'tools/reports/template-reachability.json');
const TABLE = path.join(REPO, 'translation/ui/en.json');
const OUTPUT = path.join(REPO, 'tools/sources/ui-round8-reachability.json');
// UiTextResolver.MaxSubstitutions, mirrored in tools/scripts/audit-templates.js.
const CAP = 8;

const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
const table = JSON.parse(fs.readFileSync(TABLE, 'utf8'));
const additions = { strings: {}, templates: {}, remove: { strings: [], templates: [] } };
const retired = [];
const wording = [];

function look(key) {
    if (Object.prototype.hasOwnProperty.call(table.strings, key)) return { where: 'strings', value: table.strings[key] };
    if (Object.prototype.hasOwnProperty.call(table.templates, key)) return { where: 'templates', value: table.templates[key] };
    return null;
}

for (const item of [...plan.moveToStrings, ...plan.rekey]) {
    const twin = look(item.rekey && item.rekey !== item.key ? item.rekey : item.key);
    if (twin === null) {
        // Nothing live covers this string: it needs a capture session, not a rewrite.
        wording.push({ key: item.key, value: item.value, reason: 'no live entry covers this string yet' });
        continue;
    }
    if (twin.value !== item.value) {
        wording.push({ key: item.key, value: item.value, reason: 'the live entry in ' + twin.where + ' says ' + JSON.stringify(twin.value) });
        continue;
    }
    additions.remove.templates.push(item.key);
    retired.push({ key: item.key, coveredBy: twin.where, value: item.value });
}

// A value with more placeholders than the client fills cannot render at all. The tables cannot repair
// that: either the original is wrong or the client's MaxSubstitutions cap is too low, so it is reported.
for (const item of plan.capExceeded) {
    const twin = look(item.key);
    wording.push({ key: item.key, value: item.value, reason: twin === null
        ? 'value needs ' + item.placeholders + ' substitutions, the client fills at most ' + CAP
        : 'value needs ' + item.placeholders + ' substitutions, already covered exactly by ' + twin.where });
}

fs.writeFileSync(OUTPUT, JSON.stringify(additions, null, 2) + '\n', 'utf8');

const report = [
    'round 8 template reachability',
    '  unreachable templates : ' + (plan.moveToStrings.length + plan.rekey.length + plan.capExceeded.length + plan.needsCapture.length + plan.mismatch.length),
    '  retired as duplicates : ' + retired.length,
    '  over the client cap   : ' + plan.capExceeded.length,
    '  awaiting capture      : ' + plan.needsCapture.length,
    '  needs an author       : ' + wording.length + ' (+' + plan.mismatch.length + ' placeholder gap(s))',
    '',
    'retired (unreachable, and identical to a live entry):',
    ...retired.map(item => '  ' + JSON.stringify(item.key) + '  <- ' + item.coveredBy),
    '',
    'left in place, an author has to decide:',
    ...wording.map(item => '  ' + JSON.stringify(item.key) + ' => ' + JSON.stringify(item.value) + '  (' + item.reason + ')'),
    ...plan.mismatch.map(item => '  ' + JSON.stringify(item.key) + ' => ' + JSON.stringify(item.value) +
        '  (' + item.keyPlaceholders + ' placeholder(s) in the key, ' + item.placeholders + ' in the value)'),
    '',
    'awaiting a capture session (the raw string has not been seen yet, so no fix is provable):',
    ...plan.needsCapture.map(item => '  ' + JSON.stringify(item.key)),
];
fs.mkdirSync(path.join(REPO, 'tools/reports'), { recursive: true });
fs.writeFileSync(path.join(REPO, 'tools/reports/template-reachability.txt'), report.join('\n') + '\n', 'utf8');
console.log(report.join('\n'));
