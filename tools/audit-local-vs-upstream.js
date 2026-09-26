// Separates the working copy's own work from the data upstream already publishes.
//
// The game cache holds one language file per category/scene, downloaded from the CDN and then edited
// locally. This reports, per file, whether it still matches the hash the manifest publishes
// (UPSTREAM), differs from a published hash (LOCAL-EDIT) or is not in the manifest at all
// (LOCAL-ONLY, which the plugin loads without verification).
//
// Usage:
//   node tools/audit-local-vs-upstream.js [cacheDirectory] [--manifest <path>] [--language en]
//
// The hash comes from the repository's own manifest.js, so it is exactly the function the plugin
// uses at load time (TranslationHash / StringTableHash.ComputeEntries).

const fs = require('fs');
const path = require('path');
const { fileHash } = require(path.join(__dirname, '..', 'manifest.js'));

const defaultCache =
    'C:/Users/Andrew/muv_luv_girlsgardenx_cl/BepInEx/plugins/MuvluvMod/translation';

let cacheDirectory = defaultCache;
let manifestPath = null;
let language = 'en';

const args = process.argv.slice(2);
for (let index = 0; index < args.length; index++) {
    if (args[index] === '--manifest') manifestPath = args[++index];
    else if (args[index] === '--language') language = args[++index];
    else cacheDirectory = args[index];
}

if (!manifestPath) manifestPath = path.join(cacheDirectory, 'manifest', `${language}.json`);
if (!fs.existsSync(cacheDirectory)) {
    console.error(`cache directory not found: ${cacheDirectory}`);
    process.exit(1);
}
if (!fs.existsSync(manifestPath)) {
    console.error(`manifest not found: ${manifestPath}`);
    process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const languageFile = `${language}.json`;

function expectedHash(relative) {
    const parts = relative.split('/');
    if (parts[0] === 'scenes') {
        return manifest.scenes && parts.length > 2 ? manifest.scenes[parts[1]] : undefined;
    }
    return manifest[parts[0]];
}

function collect(directory, relative) {
    const found = [];
    for (const entry of fs.readdirSync(directory)) {
        const full = path.join(directory, entry);
        const relativePath = relative === '' ? entry : `${relative}/${entry}`;
        // statSync follows the category junctions, which readdir reports as symbolic links.
        let stats;
        try {
            stats = fs.statSync(full);
        } catch {
            continue;
        }
        if (stats.isDirectory()) {
            if (relative === '' && (entry === 'manifest' || entry === 'scene-dump')) continue;
            found.push(...collect(full, relativePath));
        } else if (entry === languageFile) {
            found.push(relativePath);
        }
    }
    return found;
}

(async () => {
    const files = collect(cacheDirectory, '').sort();
    const buckets = { UPSTREAM: [], 'LOCAL-EDIT': [], 'LOCAL-ONLY': [] };

    for (const relative of files) {
        const expected = expectedHash(relative);
        const actual = await fileHash(path.join(cacheDirectory, relative));
        const kind =
            expected === undefined || expected === null
                ? 'LOCAL-ONLY'
                : actual === expected
                  ? 'UPSTREAM'
                  : 'LOCAL-EDIT';
        buckets[kind].push({ relative, expected, actual });
    }

    for (const kind of ['LOCAL-EDIT', 'LOCAL-ONLY']) {
        console.log(`--- ${kind} (${buckets[kind].length}) ---`);
        for (const file of buckets[kind]) {
            console.log(`  ${file.relative}  manifest=${file.expected} actual=${file.actual}`);
        }
    }

    console.log('--- UPSTREAM (unmodified published files) ---');
    for (const file of buckets.UPSTREAM) console.log(`  ${file.relative}`);
    console.log(
        `\nlanguage=${language} manifest=${manifestPath}\n` +
            `files=${files.length} upstream=${buckets.UPSTREAM.length} ` +
            `local-edit=${buckets['LOCAL-EDIT'].length} local-only=${buckets['LOCAL-ONLY'].length}`
    );
})();
