// Audit of the reachability rules the client actually enforces (UiTextResolver.TryResolve):
//
//   * exact match   : strings[original], used as is with no substitution
//   * template match: templates[NormalizeTemplate(original)], only when the normalisation changed the
//                     string (the resolver compares normalised != original before the lookup) and
//                     TrySubstituteDigits succeeds, which needs exactly one '#' outside markup per
//                     digit run outside markup of the original.
//
// So a templates entry is unreachable when its key has no '#' outside markup, when its placeholder
// count disagrees with the digit runs of its key, or when its value holds more placeholders than the
// client fills at all (TrySubstituteDigits returns false past MaxSubstitutions, so an original with that
// many digit runs is refused outright). Markup ('<...>') never counts on either side.
//
// Fixes are only proposed when the evidence supports them:
//   moveToStrings : the game has been observed to emit the key verbatim and the value has no
//                   placeholder, so the exact table reproduces it as is (literal digits kept).
//   rekey         : normalising the key yields a key whose digit runs match the value's placeholders,
//                   so the entry starts resolving through the template path.
//   capExceeded   : no fix exists in the tables; the client would have to be allowed more substitutions.
//   needsCapture  : no evidence yet, needs a live session to see the real string.
//
// Usage: node tools/scripts/audit-templates.js
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const ui = JSON.parse(fs.readFileSync(path.join(REPO, 'translation/ui/en.json'), 'utf8'));
// Captures of what the game emitted; authored tables are excluded so a typo cannot look "observed".
const CAPTURE = /(harvest|sources|todo|missing|unique|log|dump)/i;
// UiTextResolver.MaxSubstitutions: TrySubstituteDigits refuses an original with more digit runs.
const CAP = 8;

function isDigit(ch) {
    return (ch >= '0' && ch <= '9') || (ch >= '\uff10' && ch <= '\uff19');
}

// The resolver's NormalizeTemplate: every digit run outside markup becomes one '#'.
function normalise(text) {
    const out = [];
    let inTag = false;
    let inRun = false;
    for (const ch of Array.from(text)) {
        if (ch === '<') inTag = true;
        if (!inTag && isDigit(ch)) {
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

// Counts '#' or digit runs outside markup: those are the ones the resolver substitutes.
function countRuns(text, kind) {
    let inTag = false;
    let inRun = false;
    let runs = 0;
    for (const ch of Array.from(text)) {
        if (ch === '<') inTag = true;
        const hit = !inTag && (kind === 'digit' ? isDigit(ch) : ch === '#');
        if (hit) { if (!inRun) runs += 1; inRun = true; continue; }
        inRun = false;
        if (inTag && ch === '>') inTag = false;
    }
    return runs;
}


// Every string the game has been seen to emit, keyed by its exact text.
const observed = new Map();
const srcDir = path.join(REPO, 'tools/sources');
for (const file of fs.readdirSync(srcDir)) {
    if (!CAPTURE.test(file)) continue;
    const text = fs.readFileSync(path.join(srcDir, file), 'utf8');
    const add = (s) => {
        const trimmed = s.trim();
        if (trimmed === '' || observed.has(trimmed)) return;
        observed.set(trimmed, file);
    };
    if (/\.json$/i.test(file)) {
        let data;
        try { data = JSON.parse(text); } catch { continue; }
        const walk = node => {
            if (typeof node === 'string') { add(node); return; }
            if (Array.isArray(node)) { node.forEach(walk); return; }
            if (node && typeof node === 'object') Object.values(node).forEach(walk);
        };
        walk(data);
    } else {
        for (const line of text.split(/\r?\n/)) for (const part of line.split('\t')) add(part);
    }
}

const findings = [];
for (const [key, value] of Object.entries(ui.templates)) {
    const keyPlaceholders = countRuns(key, '#');
    const placeholders = countRuns(value, '#');
    // Reachable when the lookup key has a placeholder, the value fills exactly that many, and the fill
    // stays inside the client's MaxSubstitutions cap.
    if (keyPlaceholders > 0 && placeholders === keyPlaceholders && placeholders <= CAP) continue;

    const normalised = normalise(key);
    const rekeyPlaceholders = countRuns(normalised, '#');
    findings.push({
        key,
        value,
        keyPlaceholders,
        placeholders,
        literals: countRuns(key, 'digit'),
        observed: observed.has(key) ? observed.get(key) : null,
        rekey: normalised !== key && rekeyPlaceholders > 0 && rekeyPlaceholders === placeholders ? normalised : null,
    });
}

const plan = { moveToStrings: [], rekey: [], capExceeded: [], mismatch: [], needsCapture: [] };
for (const item of findings) {
    if (item.placeholders > CAP) { plan.capExceeded.push(item); continue; }
    if (item.keyPlaceholders > 0) { plan.mismatch.push(item); continue; }
    if (item.observed && item.placeholders === 0) { plan.moveToStrings.push(item); continue; }
    if (item.rekey) { plan.rekey.push(item); continue; }
    plan.needsCapture.push(item);
}

console.log('templates: ' + Object.keys(ui.templates).length + ', unreachable: ' + findings.length);
const show = (title, list, describe) => {
    console.log('\n' + title + ': ' + list.length);
    for (const item of list) console.log('  ' + describe(item));
};
show('A. observed verbatim, no placeholder -> move to strings', plan.moveToStrings, item =>
    JSON.stringify(item.key) + ' => ' + JSON.stringify(item.value) + '  (seen in ' + item.observed + ')');
show('B. re-key to the normalised form', plan.rekey, item =>
    JSON.stringify(item.key) + ' -> ' + JSON.stringify(item.rekey) + ' => ' + JSON.stringify(item.value) +
    '  (' + item.placeholders + ' placeholder(s)' + (item.literals ? ', ' + item.literals + ' literal digit run(s) in the key' : '') + ')');
show('C. more placeholders than the client fills -> untranslatable', plan.capExceeded, item =>
    JSON.stringify(item.key) + ' => ' + JSON.stringify(item.value) +
    '  [' + item.placeholders + ' placeholder(s), the client fills at most ' + CAP + ']');
show('D. placeholder counts disagree -> needs an author', plan.mismatch, item =>
    JSON.stringify(item.key) + ' => ' + JSON.stringify(item.value) +
    '  [' + item.keyPlaceholders + ' placeholder(s) in the key, ' + item.placeholders + ' in the value]');
show('E. no evidence yet -> needs a capture', plan.needsCapture, item =>
    JSON.stringify(item.key) + ' => ' + JSON.stringify(item.value) +
    '  [' + item.literals + ' literal digit run(s) in the key, ' + item.placeholders + ' placeholder(s), observed=' +
    (item.observed ? item.observed : 'no') + ']');

const out = path.join(REPO, 'tools/reports/template-reachability.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(plan, null, 2) + '\n', 'utf8');
console.log('\nplan written to tools/reports/template-reachability.json');
