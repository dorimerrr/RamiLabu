'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { isObject, digest, fingerprint, readJson, getAt, safePath, writeJson } = require('./json');
const { containsJapanese, normalizeTemplate, resolveUi, entriesOf, entryIssues, substitute } = require('./rules');
const idFor = (file, parts) => 'line-' + fingerprint([file, parts]);
function freshDirectory(directory, repo) {
    const absolute = path.resolve(directory);
    const translation = path.join(repo, 'translation');
    if (absolute === repo || absolute === translation || absolute.startsWith(translation + path.sep) || translation.startsWith(absolute + path.sep)) throw new Error('Output must be outside translation/ and cannot contain the repository');
    if (fs.existsSync(absolute)) throw new Error(`Output already exists: ${absolute}`);
    // Check any existing ancestor for symlinks before creating output.
    const relative = path.relative(repo, absolute).split(path.sep).join('/');
    if (relative.startsWith('../') || path.isAbsolute(relative)) throw new Error('Use an output directory inside this repository');
    safePath(repo, relative);
    return absolute;
}
function importSources(repo, options) {
    const { kind, input, scene, context } = options;
    const limit = options.limit === undefined ? Infinity : Number(options.limit);
    if (!(limit === Infinity || Number.isSafeInteger(limit) && limit > 0)) throw new Error('--limit must be a positive integer');
    if ((options.class || options.property) && kind !== 'static') throw new Error('--class/--property apply only to static imports');
    if (options.table && kind !== 'names') throw new Error('--table applies only to names imports');
    const raw = fs.readFileSync(input, 'utf8');
    let data;
    if (kind === 'ui-log') {
        const marker = /\[UI\] untranslated text: "([\s\S]*?)"(?:\r?\n|$)/g;
        data = [...raw.matchAll(marker)].map(match => match[1]);
        if (!data.length) throw new Error('No complete UI log entries found');
    } else data = require('./json').parseJson(raw, input).value;
    const suppliedContext = context ? readJson(context) : {};
    if (!isObject(suppliedContext)) throw new Error('Context must map exact source keys to context objects');
    const records = new Map(), targets = {};
    function add(file, parts, source, mode, sample, order, values) {
        if (options.class && parts[0] !== options.class || options.property && parts[1] !== options.property || options.table && parts[0] !== options.table) return;
        if (records.size >= limit && !records.has(idFor(file, parts))) return;
        if (!source || source.includes('\r')) throw new Error('Source is empty or contains CR; do not normalize a captured key');
        if (kind === 'ui-log' && sample.length > 160 && sample.endsWith('…')) throw new Error('Truncated UI log text cannot be a source key; use a full JSON capture');
        const absolute = safePath(repo, 'translation/' + file);
        if (!(file in targets)) {
            const targetRaw = fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf8') : null;
            targets[file] = { sha256: targetRaw === null ? null : digest(targetRaw), table: targetRaw === null ? {} : require('./json').parseJson(targetRaw, absolute).value };
        }
        const previous = getAt(targets[file].table, parts);
        if (options.onlyUntranslated && file !== 'ui/en.json' && previous && previous !== source) return;
        if (options.onlyUntranslated && file === 'ui/en.json' && resolveUi(targets[file].table, sample)) return;
        const id = idFor(file, parts);
        if (records.has(id)) { if (!records.get(id).samples.includes(sample)) records.get(id).samples.push(sample); return; }
        const index = order;
        records.set(id, { id, file, parts, source, mode, samples: [sample], previous: previous ?? null,
            context: { sourceIndex: index, preceding: values.slice(Math.max(0, index - 2), index), following: values.slice(index + 1, index + 3), ...suppliedContext[sample] } });
    }
    if (kind === 'scene') {
        if (!/^[0-9]+$/.test(scene || '') || !isObject(data)) throw new Error('Scene import needs --scene ID and a flat source JSON object');
        const values = Object.keys(data);
        values.forEach((source, index) => {
            if (typeof data[source] !== 'string') throw new Error('Scene input values must be strings');
            add(`scenes/${scene}/en.json`, [source], source, 'exact', source, index, values);
        });
    } else if (kind === 'ui' || kind === 'ui-log') {
        if (Array.isArray(data)) {
            if (data.some(value => typeof value !== 'string')) throw new Error('UI harvest must be an array of strings');
            data.forEach((sample, index) => {
                const key = normalizeTemplate(sample), mode = key === sample ? 'exact' : 'template';
                add('ui/en.json', [mode === 'exact' ? 'strings' : 'templates', key], key, mode, sample, index, data);
            });
        } else {
            const entries = entriesOf('ui/en.json', data), values = entries.map(entry => entry.source);
            entries.forEach((entry, index) => {
                let sample = entry.source;
                if (entry.mode === 'template') {
                    let inTag = false;
                    sample = [...sample].map(character => {
                        if (character === '<') inTag = true;
                        else if (character === '>') inTag = false;
                        return !inTag && character === '#' ? '123' : character;
                    }).join('');
                }
                add('ui/en.json', entry.parts, entry.source, entry.mode, sample, index, values);
            });
        }
    } else if (kind === 'static' || kind === 'names') {
        const file = `${kind}/en.json`, entries = entriesOf(file, data);
        const grouped = new Map();
        for (const entry of entries) {
            const group = JSON.stringify(entry.parts.slice(0, -1));
            if (!grouped.has(group)) grouped.set(group, []);
            grouped.get(group).push(entry);
        }
        for (const group of grouped.values()) {
            const values = group.map(entry => entry.source);
            group.forEach((entry, index) => add(file, entry.parts, entry.source, 'exact', entry.source, index, values));
        }
    } else throw new Error('Supported kinds: scene, ui, ui-log, static, names');
    if (!records.size) throw new Error('No sources selected');
    const frozen = { schema: 1, language: 'en', kind, inputSha256: digest(raw), inputName: path.basename(input),
        targets: Object.fromEntries(Object.entries(targets).map(([file, value]) => [file, value.sha256])), records: [...records.values()] };
    const sourceFingerprint = fingerprint(frozen);
    const work = { schema: 1, sourceFingerprint, entries: frozen.records.map(record => ({ id: record.id, translation: null, status: 'pending', note: '' })) };
    const directory = freshDirectory(options.out, repo);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'capture.txt'), raw, 'utf8');
    writeJson(path.join(directory, 'sources.json'), frozen);
    writeJson(path.join(directory, 'work.json'), work);
    return { records: records.size, directory };
}
function loadBatch(directory) {
    const source = readJson(path.join(directory, 'sources.json'));
    const work = readJson(path.join(directory, 'work.json'));
    if (source.schema !== 1 || source.language !== 'en' || !Array.isArray(source.records) || !isObject(source.targets)) throw new Error('Invalid source schema');
    if (work.schema !== 1 || work.sourceFingerprint !== fingerprint(source) || !Array.isArray(work.entries)) throw new Error('Frozen sources changed or worksheet belongs to a different batch');
    if (digest(fs.readFileSync(path.join(directory, 'capture.txt'), 'utf8')) !== source.inputSha256) throw new Error('Frozen input capture changed');
    const ids = new Set();
    for (const record of source.records) {
        if (record.id !== idFor(record.file, record.parts) || ids.has(record.id) || !Object.hasOwn(source.targets, record.file)) throw new Error('Invalid or duplicate source ID');
        ids.add(record.id);
        if (!Array.isArray(record.parts) || record.parts.some(part => typeof part !== 'string') || typeof record.source !== 'string' || !Array.isArray(record.samples) || record.samples.some(sample => typeof sample !== 'string')) throw new Error('Invalid source fields');
        // Validate the target path independently of user-editable worksheet data.
        if (!/^(ui|names|static)\/en\.json$|^scenes\/[0-9]+\/en\.json$/.test(record.file) || record.source !== record.parts.at(-1) || !['exact', 'template'].includes(record.mode) || !Array.isArray(record.samples)) throw new Error('Invalid source record');
    }
    const seen = new Set();
    for (const entry of work.entries) {
        if (!isObject(entry) || !ids.has(entry.id) || seen.has(entry.id)) throw new Error('Unknown or duplicate worksheet ID');
        if (Object.keys(entry).some(key => !['id', 'translation', 'status', 'note'].includes(key))) throw new Error('Worksheet must not contain source keys or target paths');
        if (!['pending', 'draft', 'reviewed', 'skipped'].includes(entry.status) || typeof entry.note !== 'string' || !(entry.translation === null || typeof entry.translation === 'string')) throw new Error('Invalid worksheet entry');
        seen.add(entry.id);
    }
    if (seen.size !== ids.size) throw new Error('Worksheet is missing source IDs');
    return { source, work };
}
function validateBatch(directory, complete = false) {
    const batch = loadBatch(directory);
    const records = new Map(batch.source.records.map(record => [record.id, record]));
    const errors = [], counts = { pending: 0, draft: 0, reviewed: 0, skipped: 0 };
    for (const entry of batch.work.entries) {
        const record = records.get(entry.id); counts[entry.status]++;
        if (entry.status === 'skipped') {
            if (!entry.note.trim()) errors.push(`${entry.id}: skipped entry needs a reason`);
            continue;
        }
        if (entry.translation !== null) {
            if (record.file === 'ui/en.json' && !containsJapanese(record.source)) errors.push(`${entry.id}: UI source fails the runtime Japanese-character gate`);
            for (const issue of entryIssues(record.source, entry.translation, record.mode)) errors.push(`${entry.id}: ${issue}`);
            if (record.mode === 'template') for (const sample of record.samples) if (substitute(entry.translation, sample) === null) errors.push(`${entry.id}: template cannot resolve captured sample`);
        } else if (entry.status !== 'pending') errors.push(`${entry.id}: ${entry.status} entry has no translation`);
        if (complete && entry.status !== 'reviewed') errors.push(`${entry.id}: must be reviewed or explicitly skipped before build`);
    }
    return { ...batch, errors, counts };
}
function requests(repo, directory, out) {
    const { source, work } = loadBatch(directory);
    const states = new Map(work.entries.map(entry => [entry.id, entry]));
    const glossary = readJson(path.join(repo, 'tools/workflow/glossary.json'));
    const style = fs.readFileSync(path.join(repo, 'tools/workflow/STYLE.md'), 'utf8');
    const response = { schema: 1, sourceFingerprint: fingerprint(source), language: 'en', style, glossary,
        entries: source.records.filter(record => !['reviewed', 'skipped'].includes(states.get(record.id).status)).map(record => ({ id: record.id, source: record.source, context: record.context, existingTranslation: record.previous, mode: record.mode })) };
    writeJson(out, response);
    return { entries: response.entries.length };
}
function importDrafts(directory, file) {
    const { source, work } = loadBatch(directory), draft = readJson(file);
    if (draft.schema !== 1 || draft.sourceFingerprint !== fingerprint(source) || !Array.isArray(draft.entries)) throw new Error('Draft response belongs to a different batch or has invalid schema');
    const entries = new Map(work.entries.map(entry => [entry.id, entry])), seen = new Set();
    const records = new Map(source.records.map(record => [record.id, record]));
    for (const item of draft.entries) {
        if (!isObject(item) || Object.keys(item).some(key => !['id', 'translation'].includes(key)) || !entries.has(item.id) || seen.has(item.id)) throw new Error('Draft response has unknown/duplicate IDs or altered source fields');
        if (entries.get(item.id).status !== 'pending' || entries.get(item.id).translation !== null) throw new Error('Draft import cannot overwrite existing work');
        const record = records.get(item.id), issues = entryIssues(record.source, item.translation, record.mode);
        if (record.file === 'ui/en.json' && !containsJapanese(record.source)) issues.push('UI source fails the runtime Japanese-character gate');
        if (!issues.length && record.mode === 'template' && record.samples.some(sample => substitute(item.translation, sample) === null)) issues.push('Cannot resolve captured template sample');
        if (issues.length) throw new Error(`${item.id}: ${issues.join('; ')}`);
        seen.add(item.id);
        Object.assign(entries.get(item.id), { translation: item.translation, status: 'draft' });
    }
    const output = path.join(directory, 'work.json');
    const temporary = output + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(work, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
    try { fs.renameSync(temporary, output); } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    return { imported: seen.size, status: 'draft; human review required' };
}
module.exports = { idFor, freshDirectory, importSources, loadBatch, validateBatch, requests, importDrafts };
