// Repairs the line-break corruption in the committed scenario tables: the engine renders a break inside
// a string as a bare LF and never a CR, so a key that carries a CR can never match and its translation
// silently never appears.
//
// The evidence is the mod's own output, not a guess:
//   * scene-dump (the keys TranslationPatch actually looked up) holds 268 keys with no CR at all, 128 of
//     them multi-line, and no key ends with a break;
//   * the round-8 live harvest re-captured five strings round 7 had recorded with CRLF as bare LF, so the
//     CR came from the snapshot, not from the engine (build-round8.js documents the same repair on
//     translation/ui/en.json, where the CRLF keys were retired in favour of their LF twins).
//
// A CRLF inside a key becomes an LF. A CR that is not part of a CRLF is dropped, never turned into an
// LF: no recorded lookup key ends with a break. Values are repaired identically, so a value can never
// inject a CR into what the client renders.
//
// Only `translation/scenes/<id>/en.json` is repaired. `zh_Hans.json` is upstream's data and is never
// touched (AGENTS.md 0.2); the CRs in `translation/static/*.json` are reported but left alone, because
// those entries hold a value equal to their key and the client drops them anyway (AGENTS.md 0.6).
//
// Every rewrite has to prove that it changes nothing but the CRs:
//   * the file must round-trip byte for byte through the same serializer (its indent, line endings and
//     final newline are read back from the file), so a rewrite can never reflow anything else;
//   * the repaired table must differ from the original only by CR removal (same keys in the same order);
//   * a repaired key must not collide with a key that already exists in the same table.
//
// Usage: node tools/scripts/repair-newlines.js [--write]
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const TRANSLATION = path.join(REPO, 'translation');
const SCENES = path.join(TRANSLATION, 'scenes');
const LANGUAGE = 'en.json';

const WRITE = process.argv.includes('--write');

// The characters the serializer has to escape, made explicit for the report.
function formatLine(text) {
    return text.replace(/\\/g, '[BS]').replace(/\r/g, '<CR>').replace(/\n/g, '<LF>');
}

function repairText(text) {
    return text.split('\r\n').join('\n').split('\r').join('');
}

function hasCarriageReturn(text) {
    return text.includes('\r');
}

// Reads back how the file itself is formatted, so the rewrite reproduces it exactly.
function describeFormat(raw) {
    const eol = raw.includes('\r\n') ? '\r\n' : '\n';
    const secondLine = raw.split(/\r?\n/)[1] ?? '';
    const indent = (/^(\s*)/.exec(secondLine) ?? ['', ''])[1].length;
    return { eol, indent, finalNewline: raw.endsWith(eol) };
}

function serialize(table, format) {
    const json = JSON.stringify(table, null, format.indent).split('\n').join(format.eol);
    return format.finalNewline ? json + format.eol : json;
}

// Confirms that the repaired table is the original with CRs removed and nothing else.
function assertOnlyCarriageReturnsChanged(original, repaired, file) {
    const originalKeys = Object.keys(original);
    const repairedKeys = Object.keys(repaired);
    if (originalKeys.length !== repairedKeys.length) {
        throw new Error(`key count changed (${originalKeys.length} -> ${repairedKeys.length})`);
    }
    for (let index = 0; index < originalKeys.length; index += 1) {
        const key = originalKeys[index];
        // The value travels with its key, so it is looked up through the repaired name again.
        const repairedKey = repairedKeys[index];
        if (repairText(key) !== repairedKey) {
            throw new Error(`entry ${index} is not the CR-free form of the original`);
        }
        if (repairText(original[key]) !== repaired[repairedKey]) {
            throw new Error(`value of ${JSON.stringify(key)} changed by more than its CRs`);
        }
    }
}

function repairTable(table, file) {
    const seen = new Set(Object.keys(table));
    const repaired = {};
    for (const [key, value] of Object.entries(table)) {
        const fixedKey = repairText(key);
        const fixedValue = typeof value === 'string' ? repairText(value) : value;
        if (fixedKey !== key) {
            if (seen.has(fixedKey)) {
                throw new Error(
                    `${JSON.stringify(fixedKey)} already exists; retiring the CR key is a data decision, not a repair`,
                );
            }
            seen.add(fixedKey);
        }
        repaired[fixedKey] = fixedValue;
    }
    return repaired;
}

function readTable(file) {
    const raw = fs.readFileSync(file, 'utf8');
    return { raw, table: JSON.parse(raw) };
}

// Counts real CRs anywhere in a table, including the nested tables of translation/static.
function countCarriageReturns(table) {
    let count = 0;
    for (const [key, value] of Object.entries(table)) {
        if (hasCarriageReturn(key)) count += 1;
        if (typeof value === 'string') {
            if (hasCarriageReturn(value)) count += 1;
        } else if (value && typeof value === 'object') {
            count += countCarriageReturns(value);
        }
    }
    return count;
}

const repaired = [];
const refused = [];
const outOfScope = [];

for (const id of fs.readdirSync(SCENES).sort()) {
    const file = path.join(SCENES, id, LANGUAGE);
    if (!fs.existsSync(file)) continue;

    const { raw, table } = readTable(file);
    const crKeys = Object.keys(table).filter(hasCarriageReturn);
    const crValues = Object.entries(table).filter(
        ([, value]) => typeof value === 'string' && hasCarriageReturn(value),
    );
    if (crKeys.length === 0 && crValues.length === 0) continue;

    try {
        const format = describeFormat(raw);
        // The rewrite is only accepted when the file cannot have been reflowed by it: the same
        // serializer has to reproduce the bytes on disk before it is allowed to replace them.
        if (serialize(table, format) !== raw) {
            throw new Error('file does not round-trip through the serializer; repair it by hand');
        }

        const fixed = repairTable(table, file);
        assertOnlyCarriageReturnsChanged(table, fixed, file);

        const changes = [];
        for (const [key, value] of Object.entries(table)) {
            const fixedKey = repairText(key);
            if (fixedKey !== key) {
                changes.push(`  key   ${formatLine(key)}\n     -> ${formatLine(fixedKey)}`);
            } else if (value !== fixed[fixedKey]) {
                changes.push(`  value of ${formatLine(key)}\n     -> ${formatLine(fixed[fixedKey])}`);
            }
        }

        if (WRITE) {
            fs.writeFileSync(file, serialize(fixed, format), 'utf8');
            const survivors = Object.keys(readTable(file).table).filter(hasCarriageReturn).length;
            if (survivors !== 0) throw new Error(`${survivors} CR keys survived the rewrite`);
        }

        repaired.push({ file: path.relative(REPO, file), keys: crKeys.length, values: crValues.length, changes });
    } catch (error) {
        refused.push(`${path.relative(REPO, file)}: ${error.message}`);
    }
}

// Corruption the engine never reads is still reported, so it cannot hide.
for (const file of fs.readdirSync(SCENES).sort().map(id => path.join(SCENES, id, 'zh_Hans.json'))) {
    if (fs.existsSync(file) && countCarriageReturns(readTable(file).table) > 0) {
        outOfScope.push(`${path.relative(REPO, file)} (upstream data)`);
    }
}
for (const directory of ['static', 'ui', 'names']) {
    const root = path.join(TRANSLATION, directory);
    if (!fs.existsSync(root)) continue;
    for (const file of fs.readdirSync(root).sort()) {
        if (!file.endsWith('.json')) continue;
        const full = path.join(root, file);
        const count = countCarriageReturns(readTable(full).table);
        if (count > 0) outOfScope.push(`${path.relative(REPO, full)} (${count} CR, value-equals-key placeholders)`);
    }
}

console.log(
    `scene tables needing repair: ${repaired.length} (${WRITE ? 'written' : 'report only, pass --write to apply'})`,
);
for (const entry of repaired) {
    console.log(`\n${entry.file}: keys with CR=${entry.keys} values with CR=${entry.values}`);
    for (const change of entry.changes) console.log(change);
}
if (refused.length) {
    console.log(`\nrefused (${refused.length}):`);
    for (const entry of refused) console.log(`  ${entry}`);
}
console.log(`\nfound but out of scope (${outOfScope.length}):`);
for (const entry of outOfScope) console.log(`  ${entry}`);
console.log('\nremember: node manifest.js en after a write');
process.exitCode = refused.length ? 1 : 0;
