'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Manifest, objHash } = require('../../../manifest');
const json = require('../json');
const rules = require('../rules');
const batch = require('../batch');
const builder = require('../build');
const { check } = require('../check');
function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ramilabu-workflow-'));
    t.after(() => {
        const resolved = fs.realpathSync(root);
        assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
        assert.ok(path.basename(resolved).startsWith('ramilabu-workflow-'));
        fs.rmSync(resolved, { recursive: true, force: true });
    });
    fs.mkdirSync(path.join(root, 'translation'), { recursive: true });
    return root;
}
function put(root, file, value, raw = false) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, raw ? value : JSON.stringify(value, null, 2) + '\n', 'utf8');
    return target;
}
function imported(root, data, kind = 'scene', scene = '123') {
    const input = put(root, 'input.json', data), out = path.join(root, 'tools/batches/test');
    batch.importSources(root, { input, out, kind, scene });
    return out;
}
function review(directory, translations) {
    const file = path.join(directory, 'work.json'), work = json.readJson(file);
    work.entries.forEach((entry, index) => Object.assign(entry, { translation: translations[index], status: 'reviewed' }));
    fs.writeFileSync(file, JSON.stringify(work), 'utf8');
}
function git(root, ...args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
async function initialCommit(root) {
    await new Manifest(path.join(root, 'translation'), 'en').update();
    git(root, 'init'); git(root, 'add', 'translation');
    git(root, '-c', 'user.name=Workflow test', '-c', 'user.email=workflow-test@example.invalid', 'commit', '-m', 'fixture');
}

test('resolver handles full-width digits, tags, and each adjacent # independently', () => {
    assert.equal(rules.normalizeTemplate('残り１２時間'), '残り#時間');
    assert.equal(rules.normalizeTemplate('12個<color=#12abcd>３４</color>'), '#個<color=#12abcd>#</color>');
    assert.equal(rules.substitute('<color=#12abcd>#h</color>', '残り１２時間'), '<color=#12abcd>12h</color>');
    assert.equal(rules.substitute('#・', '残り１２時間'), '１２・');
    assert.equal(rules.substitute('##', '１/２'), '12');
    assert.equal(rules.substitute('#', '１/２'), null);
    assert.equal(rules.substitute('#/#/#/#/#/#/#/#/#', '1/2/3/4/5/6/7/8/9'), null);
    assert.equal(rules.resolveUi({ strings: { '残り１２時間': 'Exact' }, templates: { '残り#時間': '#h' } }, '残り１２時間'), 'Exact');
    assert.equal(rules.resolveUi({ strings: { 'English': 'Different' }, templates: {} }, 'English'), null);
});

test('validation preserves Japanese placeholder names, markup attributes and control codes', () => {
    const source = '<color=#123abc>威力{威力}% %usernameusernameuserna%</color>\n次\\n\u200b';
    const translation = '<color=#123abc>Power {威力}% %usernameusernameuserna%</color>\nNext\\n\u200b';
    assert.deepEqual(rules.entryIssues(source, translation), []);
    assert.ok(rules.entryIssues(source, translation.replace('{威力}', '{power}')).some(issue => issue.includes('placeholders')));
    assert.ok(rules.entryIssues(source, translation.replace('#123abc', '#abcdef')).some(issue => issue.includes('tags')));
    assert.ok(rules.entryIssues(source, translation.replace('\n', ' ')).some(issue => issue.includes('Line-break')));
    assert.ok(rules.entryIssues('残り#時間', '#h：', 'template').length);
    assert.ok(rules.entryIssues('残り#時間', 'Still Japanese 時間 #', 'template').length);
});

test('JSON rejects duplicate keys and preserves surrounding static file bytes', () => {
    assert.throws(() => json.parseJson('{"a":{"key":"one","key":"two"}}'), /duplicate/);
    const raw = '{\r\n    "SkillMaster": {\r\n        "Name": {"技": "Old", "未訳": "未訳"}\r\n    }\r\n}\r\n';
    const changed = json.editJson(raw, [{ parts: ['SkillMaster', 'Name', '技'], translation: 'New' }]);
    assert.equal(changed, raw.replace('"Old"', '"New"'));
    const added = json.editJson(raw, [{ parts: ['SkillMaster', 'Name', '別'], translation: 'Another' }, { parts: ['ItemMaster', 'Name', '__proto__'], translation: 'Safe' }]);
    assert.equal(json.readJson ? json.parseJson(added).value.ItemMaster.Name.__proto__ : null, 'Safe');
    assert.equal({}.Name, undefined);
});

test('UI import collapses numeric variants but retains both exact captures and stable IDs', t => {
    const root = fixture(t), directory = imported(root, ['残り１２時間', '残り3時間'], 'ui');
    const { source } = batch.loadBatch(directory);
    assert.equal(source.records.length, 1);
    assert.deepEqual(source.records[0].samples, ['残り１２時間', '残り3時間']);
    assert.equal(source.records[0].source, '残り#時間');
    assert.equal(source.records[0].id, batch.idFor('ui/en.json', ['templates', '残り#時間']));
    review(directory, ['#h left']);
    assert.equal(batch.validateBatch(directory, true).errors.length, 0);
});

test('UI log import refuses truncated and CR-bearing keys before creating a batch', t => {
    const root = fixture(t), out = path.join(root, 'tools/batches/test');
    const input = put(root, 'log.txt', '[UI] untranslated text: "' + 'あ'.repeat(160) + '…"\n', true);
    assert.throws(() => batch.importSources(root, { kind: 'ui-log', input, out }), /Truncated/);
    assert.equal(fs.existsSync(out), false);
    const source = put(root, 'input.json', ['行\r\n行']);
    assert.throws(() => batch.importSources(root, { kind: 'ui', input: source, out }), /CR/);
});

test('frozen source edits and missing/duplicate worksheet IDs are rejected', t => {
    const root = fixture(t), directory = imported(root, { '台詞': '' });
    const sourcePath = path.join(directory, 'sources.json'), source = json.readJson(sourcePath);
    source.records[0].source = '改変'; fs.writeFileSync(sourcePath, JSON.stringify(source));
    assert.throws(() => batch.loadBatch(directory), /Frozen sources/);
});

test('invalid draft response writes nothing; valid responses remain unreviewed', t => {
    const root = fixture(t), directory = imported(root, { '技{威力}': '', '次': '' });
    const before = fs.readFileSync(path.join(directory, 'work.json'), 'utf8');
    const { source, work } = batch.loadBatch(directory);
    const response = { schema: 1, sourceFingerprint: json.fingerprint(source), entries: [{ id: work.entries[0].id, translation: 'Power {威力}' }, { id: 'unknown', translation: 'Next' }] };
    const file = put(root, 'response.json', response);
    assert.throws(() => batch.importDrafts(directory, file), /unknown/);
    assert.equal(fs.readFileSync(path.join(directory, 'work.json'), 'utf8'), before);
    response.entries.pop(); put(root, 'response.json', response);
    assert.equal(batch.importDrafts(directory, file).imported, 1);
    assert.equal(batch.loadBatch(directory).work.entries[0].status, 'draft');
    assert.ok(batch.validateBatch(directory, true).errors.length);
    assert.throws(() => batch.importDrafts(directory, file), /overwrite/);
});

test('incomplete batch cannot produce a build directory', async t => {
    const root = fixture(t), directory = imported(root, { '台詞': '' }), out = path.join(root, 'tools/builds/test');
    await assert.rejects(builder.build(root, directory, out), /reviewed/);
    assert.equal(fs.existsSync(out), false);
});

test('build/apply keeps Japanese keys, neighboring entries, Chinese data and official hashes', async t => {
    const root = fixture(t);
    const raw = '{\r\n  "台詞": "Old",\r\n  "隣": "Neighbor"\r\n}\r\n';
    put(root, 'translation/scenes/123/en.json', raw, true);
    const chinese = put(root, 'translation/scenes/123/zh_Hans.json', { '台詞': '中文' });
    const beforeChinese = fs.readFileSync(chinese, 'utf8');
    const directory = imported(root, { '台詞': '' }); review(directory, ['New']);
    const out = path.join(root, 'tools/builds/test'); await builder.build(root, directory, out);
    assert.equal(fs.readFileSync(path.join(root, 'translation/scenes/123/en.json'), 'utf8'), raw);
    await builder.apply(root, out);
    assert.equal(fs.readFileSync(path.join(root, 'translation/scenes/123/en.json'), 'utf8'), raw.replace('Old', 'New'));
    assert.equal(fs.readFileSync(chinese, 'utf8'), beforeChinese);
    const generated = await new Manifest(path.join(root, 'translation'), 'en').build();
    assert.equal(json.canonical(json.readJson(path.join(root, 'translation/manifest/en.json'))), json.canonical(generated));
});

test('stale targets and altered previews cannot change any translations', async t => {
    const root = fixture(t), target = put(root, 'translation/scenes/123/en.json', { '台詞': 'Old' });
    const directory = imported(root, { '台詞': '' }); review(directory, ['New']);
    const out = path.join(root, 'tools/builds/test'); await builder.build(root, directory, out);
    put(root, 'translation/scenes/123/en.json', { '台詞': 'Concurrent' });
    await assert.rejects(builder.apply(root, out), /target changed/);
    put(root, 'translation/scenes/123/en.json', { '台詞': 'Old' });
    put(out, 'translation/scenes/123/en.json', { '台詞': 'Tampered' });
    await assert.rejects(builder.apply(root, out), /altered/);
    assert.equal(json.readJson(target)['台詞'], 'Old');
});

test('apply rolls back earlier files if installation fails', async t => {
    const root = fixture(t), target = put(root, 'translation/scenes/123/en.json', { '台詞': 'Old' });
    await new Manifest(path.join(root, 'translation'), 'en').update();
    const originalManifest = fs.readFileSync(path.join(root, 'translation/manifest/en.json'), 'utf8');
    const directory = imported(root, { '台詞': '' }); review(directory, ['New']);
    const out = path.join(root, 'tools/builds/test'); await builder.build(root, directory, out);
    const originalRename = fs.renameSync; let calls = 0;
    fs.renameSync = (...args) => { if (++calls === 2) throw new Error('Simulated disk error'); return originalRename(...args); };
    try { await assert.rejects(builder.apply(root, out), /Simulated/); } finally { fs.renameSync = originalRename; }
    assert.equal(json.readJson(target)['台詞'], 'Old');
    assert.equal(fs.readFileSync(path.join(root, 'translation/manifest/en.json'), 'utf8'), originalManifest);
});

test('path traversal, invalid schema and output into translation are rejected', t => {
    const root = fixture(t);
    assert.throws(() => json.safePath(root, '../escape'), /Unsafe/);
    assert.throws(() => rules.entriesOf('ui/en.json', { Strings: {}, templates: {} }), /exactly/);
    assert.throws(() => rules.entriesOf('static/en.json', { SkillMaster: { 'Items[]': {} } }), /property path/);
    assert.throws(() => batch.freshDirectory(path.join(root, 'translation/output'), root), /outside translation/);
});

test('commit gate validates the index, allows inherited backlog and rejects new invalid entries', async t => {
    const root = fixture(t);
    put(root, 'translation/static/en.json', { ItemMaster: { Name: { '未訳': '未訳' } } });
    await initialCommit(root);
    assert.equal(check(root, { staged: true }).errors.length, 0);
    assert.equal(check(root, { staged: true }).inheritedEntriesWithIssues, 1);
    put(root, 'translation/static/en.json', { ItemMaster: { Name: { '未訳': 'Translated' } } });
    await new Manifest(path.join(root, 'translation'), 'en').update();
    git(root, 'add', 'translation');
    put(root, 'translation/static/en.json', '{invalid worktree', true);
    assert.equal(check(root, { staged: true }).errors.length, 0);
    assert.ok(check(root).errors.length);
    put(root, 'translation/static/en.json', { ItemMaster: { Name: { '未訳': 'Translated', '新規': '新規' } } });
    await new Manifest(path.join(root, 'translation'), 'en').update(); git(root, 'add', 'translation');
    assert.ok(check(root, { staged: true }).errors.some(error => error.includes('identity')));
});

test('commit gate catches unstaged manifest and duplicate JSON source keys', async t => {
    const root = fixture(t);
    put(root, 'translation/scenes/123/en.json', { '台詞': 'Old' }); await initialCommit(root);
    put(root, 'translation/scenes/123/en.json', { '台詞': 'New' }); git(root, 'add', 'translation/scenes/123/en.json');
    assert.ok(check(root, { staged: true }).errors.some(error => error.includes('manifest')));
    put(root, 'translation/scenes/123/en.json', '{"台詞":"New","台詞":"Duplicate"}', true); git(root, 'add', 'translation/scenes/123/en.json');
    assert.ok(check(root, { staged: true }).errors.some(error => error.includes('duplicate')));
});


test('bounded MasterData imports select exact class/property groups and retain context', t => {
    const root=fixture(t);
    const input=put(root,'input.json',{SkillMaster:{Name:{'??':'??','?':'?'},Description:{'??':'??'}},ItemMaster:{Name:{'?':'?'}}});
    const context=put(root,'context.json',{'??':{speaker:'Verified',sceneNotes:'Skill screen'}});
    const out=path.join(root,'tools/batches/bounded');
    batch.importSources(root,{kind:'static',input,out,context,class:'SkillMaster',property:'Name',limit:'1',onlyUntranslated:true});
    const frozen=batch.loadBatch(out);
    assert.equal(frozen.source.records.length,1);
    assert.deepEqual(frozen.source.records[0].parts,['SkillMaster','Name','??']);
    assert.equal(frozen.source.records[0].context.speaker,'Verified');
    put(root,'tools/workflow/glossary.json',[]);put(root,'tools/workflow/STYLE.md','Context first',true);
    const requestFile=path.join(out,'requests.json');batch.requests(root,out,requestFile);
    assert.equal(json.readJson(requestFile).entries[0].context.sceneNotes,'Skill screen');
    assert.throws(()=>batch.importSources(root,{kind:'static',input,out:path.join(root,'other'),limit:'0'}),/positive/);
});

test('a first scene resource builds and applies with no preexisting scene category', async t=>{
    const root=fixture(t),directory=imported(root,{'??':''});review(directory,['Dialogue']);
    const out=path.join(root,'tools/builds/new');await builder.build(root,directory,out);await builder.apply(root,out);
    assert.equal(json.readJson(path.join(root,'translation/scenes/123/en.json'))['??'],'Dialogue');
    assert.equal(json.readJson(path.join(root,'translation/manifest/en.json')).scenes['123'],objHash({'??':'Dialogue'}));
});

test('explicit skips require reasons; non-Japanese UI sources cannot become deliverables',t=>{
    const root=fixture(t),directory=imported(root,['English 12'],'ui');review(directory,['Changed #']);
    assert.ok(batch.validateBatch(directory,true).errors.some(error=>error.includes('Japanese-character gate')));
    const workFile=path.join(directory,'work.json'),work=json.readJson(workFile);
    work.entries[0].status='skipped';work.entries[0].translation=null;fs.writeFileSync(workFile,JSON.stringify(work));
    assert.ok(batch.validateBatch(directory,true).errors.some(error=>error.includes('reason')));
    work.entries[0].note='Already English: runtime never consults this key';fs.writeFileSync(workFile,JSON.stringify(work));
    assert.equal(batch.validateBatch(directory,true).errors.length,0);
});
