// Compares each scene dump with the matching zh_Hans.json to see whether the Chinese files carry keys
// the dump never reported (choice labels and similar).
const fs = require('fs');
const path = require('path');

const DUMP = 'C:/Users/Andrew/muv_luv_girlsgardenx_cl/BepInEx/plugins/MuvluvMod/translation/scene-dump';
const ZH = 'C:/Users/Andrew/Desktop/RamiLabu/translation/scenes';
const ids = ['61000301', '61000701', '61001601', '61066001'];

for (const id of ids) {
    const dump = JSON.parse(fs.readFileSync(path.join(DUMP, id + '.json'), 'utf8'));
    const zhPath = path.join(ZH, id, 'zh_Hans.json');
    const zh = JSON.parse(fs.readFileSync(zhPath, 'utf8'));
    const dumpKeys = Object.keys(dump);
    const zhKeys = Object.keys(zh);
    const extra = zhKeys.filter(k => !dumpKeys.includes(k));
    const missing = dumpKeys.filter(k => !zhKeys.includes(k));
    console.log(`${id}: dump=${dumpKeys.length} zh=${zhKeys.length} extra-in-zh=${extra.length} missing-in-zh=${missing.length}`);
    for (const e of extra) console.log('    extra: ' + JSON.stringify(e));
    for (const m of missing) console.log('    missing: ' + JSON.stringify(m).slice(0, 90));
    const empty = zhKeys.filter(k => !zh[k]);
    if (empty.length) console.log('    empty values: ' + empty.length);
}
