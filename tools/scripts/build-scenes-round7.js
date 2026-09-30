// Builds the round-7 scenario files (translation/scenes/<id>/en.json) for the scenes the harvest
// reported as "no translation file", and archives a copy under tools/snapshots/scenes/.
//
// The keys are taken verbatim from the game's scene dump, never retyped, so a table entry can never
// drift from the line the game rendered. The TSV supplies the values only:
//
//     <dump index><TAB>translation              a line of the dump, in dump order
//     @@choice<TAB><japanese><TAB>translation   a choice label the dump does not record
//
// Escapes follow tools\sources\scene-<id>-translations.tsv: '<LF>' becomes a real line break.
//
// Usage: node tools/scripts/build-scenes-round7.js
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = 'C:/Users/Andrew/Desktop/RamiLabu';
const DUMP_DIR = 'C:/Users/Andrew/muv_luv_girlsgardenx_cl/BepInEx/plugins/MuvluvMod/translation/scene-dump';
const SOURCE_DIR = path.join(REPO, 'tools/sources');
const SCENE_DIR = path.join(REPO, 'translation/scenes');
const SNAPSHOT_DIR = path.join(REPO, 'tools/snapshots/scenes');

// The scenes this round completes: every one of them was reported as untranslated and has no en.json,
// only a zh_Hans.json to compare the choice labels against.
const SCENES = ['61000301', '61000701', '61001601', '61066001'];

const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff66-\uff9f]/;
const NAME_PLACEHOLDER = '%usernameusernameuserna%';

function expandMarkers(value) {
    return value.split('<LF>').join('\n').split('<CRLF>').join('\r\n');
}

function countOf(text, needle) {
    return text.split(needle).length - 1;
}

// Every rich-text tag the key carries has to survive into the value, otherwise the client renders
// broken markup. Only the tag names are compared, not the attributes: sizes and colours may be retuned.
function tagsOf(text) {
    return (text.match(/<\/?[a-zA-Z][^>]*>/g) || []).map(tag => tag.replace(/=.*$/, '>'));
}

function readDump(sceneId) {
    const live = path.join(DUMP_DIR, sceneId + '.json');
    const archived = path.join(SNAPSHOT_DIR, sceneId, 'en.json');
    const source = fs.existsSync(live) ? live : archived;
    if (!fs.existsSync(source)) return null;
    return { keys: Object.keys(JSON.parse(fs.readFileSync(source, 'utf8'))), source };
}

function readTsv(sceneId) {
    const file = path.join(SOURCE_DIR, `scene-${sceneId}-translations.tsv`);
    if (!fs.existsSync(file)) return null;
    const lines = [];
    const choices = [];
    for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const line = raw.replace(/\s+$/, '');
        if (line === '' || line.startsWith('#')) continue;
        const parts = line.split('\t');
        if (parts[0] === '@@choice') {
            choices.push({ key: parts[1], value: expandMarkers(parts.slice(2).join('\t')) });
            continue;
        }
        lines.push({ index: Number(parts[0]), value: expandMarkers(parts.slice(1).join('\t')) });
    }
    return { file, lines, choices };
}

let problems = 0;
let warnings = 0;
const report = [];

for (const sceneId of SCENES) {
    const dump = readDump(sceneId);
    const tsv = readTsv(sceneId);
    if (!dump) { console.log(`${sceneId}: no scene dump, skipped`); continue; }
    if (!tsv) { console.log(`${sceneId}: no translations TSV, skipped`); continue; }

    const scene = {};
    let translated = 0;

    for (const entry of tsv.lines) {
        const where = `[${sceneId} ${String(entry.index).padStart(2, '0')}]`;
        if (!Number.isInteger(entry.index) || entry.index < 0 || entry.index >= dump.keys.length) {
            console.log(`${where} index is outside the dump (${dump.keys.length} lines)`);
            problems++;
            continue;
        }
        const key = dump.keys[entry.index];
        if (entry.value.trim() === '') {
            console.log(`${where} empty value for ${JSON.stringify(key.slice(0, 40))}`);
            problems++;
            continue;
        }
        if (entry.value === key && CJK.test(key)) {
            console.log(`${where} value equals the still-Japanese key`);
            problems++;
            continue;
        }
        const names = [countOf(key, NAME_PLACEHOLDER), countOf(entry.value, NAME_PLACEHOLDER)];
        if (names[0] !== names[1]) {
            console.log(`${where} name placeholders: value has ${names[1]}, the key has ${names[0]}`);
            problems++;
        }
        const breaks = [countOf(key, '\n'), countOf(entry.value, '\n')];
        if (breaks[0] !== breaks[1]) {
            console.log(`${where} warning: ${breaks[1]} line breaks for the key's ${breaks[0]}`);
            warnings++;
        }
        for (const tag of new Set(tagsOf(entry.value))) {
            if (!tagsOf(key).includes(tag)) {
                console.log(`${where} warning: tag ${tag} is not in the key`);
                warnings++;
            }
        }
        scene[key] = entry.value;
        translated++;
    }

    // Choice labels: the dump never records them, so they are keyed by their original text. They must
    // not duplicate a dump line, or one of the two lookups would shadow the other.
    for (const choice of tsv.choices) {
        const where = `[${sceneId} choice]`;
        if (choice.value.trim() === '') {
            console.log(`${where} empty value for ${JSON.stringify(choice.key)}`);
            problems++;
            continue;
        }
        if (!CJK.test(choice.key)) {
            console.log(`${where} ${JSON.stringify(choice.key)} carries no Japanese text`);
            warnings++;
        }
        if (dump.keys.includes(choice.key) || Object.prototype.hasOwnProperty.call(scene, choice.key)) {
            console.log(`${where} ${JSON.stringify(choice.key)} duplicates another entry`);
            problems++;
            continue;
        }
        scene[choice.key] = choice.value;
        translated++;
    }

    const missing = dump.keys.filter(key => !Object.prototype.hasOwnProperty.call(scene, key));
    if (missing.length > 0) {
        console.log(`[${sceneId}] ${missing.length} dumped line(s) have no translation`);
        for (const key of missing) console.log(`    ${JSON.stringify(key.slice(0, 80))}`);
        problems += missing.length;
    }

    const output = JSON.stringify(scene);
    const target = path.join(SCENE_DIR, sceneId, 'en.json');
    const snapshot = path.join(SNAPSHOT_DIR, sceneId, 'en.json');
    for (const file of [target, snapshot]) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, output, { encoding: 'utf8' });
    }
    console.log(`wrote ${target} (lines=${translated}, dumped=${dump.keys.length}, choices=${tsv.choices.length})`);
    report.push({ sceneId, translated, dumped: dump.keys.length, choices: tsv.choices.length, bytes: output.length });
}

console.log('---');
for (const row of report) {
    console.log(`${row.sceneId}  lines=${row.translated}  dumped=${row.dumped}  choices=${row.choices}  bytes=${row.bytes}`);
}
console.log(`problems=${problems} warnings=${warnings}`);
