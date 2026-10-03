'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { Manifest, objHash } = require('../../manifest');
const { digest, parseJson, safePath, editJson, writeJson, fingerprint, getAt, canonical } = require('./json');
const { validateBatch, freshDirectory } = require('./batch');
const { entriesOf } = require('./rules');
function currentRaw(repo, file) { const absolute = safePath(repo, 'translation/' + file); return fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf8') : null; }
async function preview(repo, directory) {
    const batch = validateBatch(directory, true);
    if (batch.errors.length) throw new Error(batch.errors.join('\n'));
    const groups = new Map(), records = new Map(batch.source.records.map(record => [record.id, record]));
    for (const entry of batch.work.entries) {
        if (entry.status !== 'reviewed') continue;
        const record = records.get(entry.id);
        if (!groups.has(record.file)) groups.set(record.file, []);
        groups.get(record.file).push({ parts: record.parts, translation: entry.translation });
    }
    if (!groups.size) throw new Error('No reviewed translations to build');
    const manifest = await new Manifest(path.join(repo, 'translation'), 'en').build();
    const outputs = new Map(), files = [];
    for (const [file, changes] of groups) {
        const raw = currentRaw(repo, file);
        if ((raw === null ? null : digest(raw)) !== batch.source.targets[file]) throw new Error(`${file}: target changed since import; import a new batch to reconcile it`);
        const initial = file === 'ui/en.json' ? '{"strings":{},"templates":{}}' : file === 'names/en.json' ? '{"speakerNames":{},"teamNames":{}}' : '{}';
        const after = editJson(raw ?? initial, changes);
        const table = parseJson(after).value;
        entriesOf(file, table);
        for (const change of changes) if (getAt(table, change.parts) !== change.translation) throw new Error('Output differs from reviewed translation');
        if (raw === after) continue;
        outputs.set(file, after);
        files.push({ path: file, beforeSha256: raw === null ? null : digest(raw), afterSha256: digest(after), entries: changes.length });
        const resourceHash = objHash(table);
        if (file.startsWith('scenes/')) { manifest.scenes ||= {}; manifest.scenes[file.split('/')[1]] = resourceHash; }
        else manifest[file.split('/')[0]] = resourceHash;
    }
    if (!outputs.size) throw new Error('Reviewed translations already match published files');
    delete manifest.hash;
    manifest.hash = objHash(manifest);
    const originalManifest = currentRaw(repo, 'manifest/en.json');
    const sorted = JSON.parse(require('./json').canonical(manifest));
    const manifestRaw = JSON.stringify(sorted, null, 2).replaceAll('\n', os.EOL) + os.EOL;
    outputs.set('manifest/en.json', manifestRaw);
    files.push({ path: 'manifest/en.json', beforeSha256: originalManifest === null ? null : digest(originalManifest), afterSha256: digest(manifestRaw) });
    return { outputs, plan: { schema: 1, batch: path.resolve(directory), sourceFingerprint: fingerprint(batch.source), counts: batch.counts, files } };
}
async function build(repo, directory, out) {
    const prepared = await preview(repo, directory);
    const output = freshDirectory(out, repo);
    fs.mkdirSync(output, { recursive: true });
    for (const [file, raw] of prepared.outputs) {
        const target = safePath(output, 'translation/' + file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, raw, { encoding: 'utf8', flag: 'wx' });
    }
    writeJson(path.join(output, 'plan.json'), prepared.plan);
    return { directory: output, ...prepared.plan };
}
async function apply(repo, directory) {
    const plan = require('./json').readJson(path.join(directory, 'plan.json'));
    if (plan.schema !== 1 || typeof plan.batch !== 'string') throw new Error('Invalid build plan');
    const expected = await preview(repo, plan.batch);
    if (canonical(plan) !== canonical(expected.plan)) throw new Error('Build plan is stale or altered; rebuild');
    const pending = [];
    for (const [file, raw] of expected.outputs) {
        const prepared = fs.readFileSync(safePath(directory, 'translation/' + file), 'utf8');
        if (prepared !== raw) throw new Error(`Prepared ${file} was altered; rebuild`);
        const target = safePath(repo, 'translation/' + file);
        const before = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
        pending.push({ file, target, before, raw, temporary: target + '.' + randomUUID() + '.tmp' });
    }
    const installed = [];
    try {
        // All source/output/conflict checks complete before any deployable file is touched.
        for (const item of pending) {
            fs.mkdirSync(path.dirname(item.target), { recursive: true });
            fs.writeFileSync(item.temporary, item.raw, { encoding: 'utf8', flag: 'wx' });
        }
        for (const item of pending) {
            if ((fs.existsSync(item.target) ? fs.readFileSync(item.target, 'utf8') : null) !== item.before) throw new Error(`Concurrent edit detected: ${item.file}`);
            fs.renameSync(item.temporary, item.target);
            installed.push(item);
        }
        // Use the repository's official generator after every real data change.
        await new Manifest(path.join(repo, 'translation'), 'en').update();
    } catch (error) {
        for (const item of installed.reverse()) {
            if (item.before === null) fs.unlinkSync(item.target);
            else fs.writeFileSync(item.target, item.before, 'utf8');
        }
        throw error;
    } finally {
        for (const item of pending) if (fs.existsSync(item.temporary)) fs.unlinkSync(item.temporary);
    }
    return { applied: plan.files.map(file => 'translation/' + file.path), manifest: 'generated for en', publication: 'local only; review and commit before publishing' };
}
module.exports = { preview, build, apply };
