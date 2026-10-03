# AGENTS.md — how translation work is done in this repository

Audience: AI agents (and humans) picking up English (`en`) translation work for **Muvluv Girls
Garden**. Read this file before touching anything. `tools/README.md` holds the deeper history of the
working copy, `README.md` (Chinese) documents upstream's MasterData *source* schema, and the mod's own
notes live outside this repository (see [Pointers](#8-pointers)).

Everything in this repository is translation **data plus the tooling that produces it**. The game
client never reads this folder: it downloads `translation/**` from a CDN, verifies it against
`translation/manifest/en.json`, and caches it under `BepInEx\plugins\MuvluvMod\translation`.

## 0. Rules that break things when ignored

1. **Translate in this repository.** `translation/**` is the deliverable; the live copy is the one on
   the CDN branch (`CdnURL` in `MuvluvMod.cfg` → `dorimerrr/RamiLabu`, branch `main`).
2. **Work on `en` only.** Never create or edit `translation/**/zh_Hans.json` unless explicitly asked —
   that is upstream's data.
3. **Run `node manifest.js en` in the repository root after every data change.** Always pass `en`: the
   generator defaults to `zh_Hans`.
4. **Commit the data file *and* `translation/manifest/en.json` together, then push to `main`.** Nothing
   reaches the game until it is pushed; a push is the deployment.
5. **Keys are the exact strings the game renders.** Copy them from the harvest files, never retype them
   (transcription drift produces entries that can never match and is invisible in game).
6. **Never add an entry whose value equals its key, or an empty value.** The client drops those
   (`UiTextResolver.Create`), so they are dead weight in the tables.
7. **Never hand-edit `translation/manifest/**`.** It is generated.
8. **Do not edit the game cache** (`BepInEx\plugins\MuvluvMod\translation`) as if it were a source.
   With `PreferLocalFiles = false` the client re-downloads anything whose hash does not match the
   manifest, so cache edits silently disappear on the next launch.

## 1. Where things live

| path | role |
| --- | --- |
| `translation/ui/en.json` | interface text: `strings` (exact) + `templates` (numeric) |
| `translation/scenes/<sceneId>/en.json` | one scenario: flat `rendered line → translation` |
| `translation/static/en.json` | MasterData: `{ "<Class>": { "<PropertyPath>": { "<jp>": "<en>" } } }` |
| `translation/names/en.json` | `{ "speakerNames": {…}, "teamNames": {…} }` |
| `translation/manifest/en.json` | generated: one content hash per file plus `hash` |
| `manifest.js` | the manifest generator (also the reference hash implementation) |
| `app.js` | static server for local testing (`npm start` → `http://localhost:5000`) |
| `tools/sources/` | per-round sources of record (TSVs, additions JSON, harvest listings) |
| `tools/snapshots/`, `tools/reports/` | table snapshots and coverage/verification reports |
| `tools/scripts/` | harvest, build, merge and verification scripts (defaults are inside this repo) |
| `BepInEx\plugins\MuvluvMod\translation\` *(outside the repo)* | the game's cache: a downloaded copy, **not** a source of truth |
| `BepInEx\LogOutput.log`, `…\translation\scene-dump\` *(outside the repo)* | harvest output of the running game |
| `C:\Users\Andrew\Desktop\Airi` *(outside the repo)* | clone of the mod's source (`anosu/MuvluvMod`): **read-only reference** — `src\MuvluvMod\Services\UiTextResolver.cs`, `TranslationHash.cs`, `TranslationCache.cs`, and `artifacts\ui-coverage\` (a `net8.0` harness that runs the real resolver). `artifacts\` is gitignored scratch. **Never translate there.** |

Live counts at the time of writing (`hash=23508e383a4112f98340aab60d7031fd`):

| category | file | contents |
| --- | --- | --- |
| `ui` | `ui/en.json` | 1,147 strings + 294 templates |
| `names` | `names/en.json` | 655 speaker names + 41 team names |
| `static` | `static/en.json` | 67 MasterData classes, 101 property paths, 21,092 entries (many still identity) |
| `scenes` | `scenes/<id>/en.json` | 628 English scene files out of 1,120 scene directories |

Round 9 (the batch saved as `C:\Users\Andrew\Desktop\translatethis2.txt`, 478 log lines / 321 unique) added
`tools/sources/ui-round9-*.{json,tsv}` plus `tools/scripts/{build,check}-round9.js`, re-translating every
entry it named - including 92 strings and 18 templates that already had a value - and completed
`translation/scenes/10280101/en.json` (118 dump lines) after the log reported
`Scenario translation load failed: 10280101`. Its records are
`tools/reports/round9-scene-keys.json` (the lines that belong to that scene rather than the interface
table) and `tools/snapshots/ui-en-pre-round9.json`.

## 2. What the client does with the data (the rules your entries must satisfy)

### 2.1 Interface text — `translation/ui/en.json`

```json
{
    "strings":   { "自習室へ": "To the Study Room" },
    "templates": { "残り#時間": "#h left" }
}
```

* Before a lookup, the client ignores any text that contains no Japanese characters, so an entry is
  only ever consulted for Japanese source text (`UiTextResolver.ContainsJapanese`, and it is used as a
  cheap gate inside the `TMP_Text.set_text` patch).
* Exact lookup in **`strings`** comes first. A value identical to its key can never match.
* Otherwise the client normalises the rendered string — every run of digits *outside* `<…>` markup
  becomes a single `#` (`NormalizeTemplate`) — and looks it up in **`templates`**, then substitutes the
  original digit runs back positionally (`TrySubstituteDigits`).
* A template value must contain **exactly one `#` per digit run, in order**, and the string may contain
  at most 8 runs. If the counts differ, the entry is ignored *entirely* — never partially applied.
* `#` inside a tag is not a placeholder: `<color=#ff1c0b>#,#</color>` has exactly two placeholders.
* Full-width digits (`０`–`９`) count as digits. They are converted to half-width **only when the
  translated template contains no Japanese characters** (any character in `U+3000–U+30FF`,
  `U+3400–U+4DBF`, `U+4E00–U+9FFF`, `U+F900–U+FAFF`, `U+FF00–U+FFEF`). Practical consequence for
  English values: **use half-width punctuation** — a full-width `（`, `）`, `：` or space makes the
  client treat the value as Japanese and keep full-width numbers. `×` (U+00D7) is safe.
* Worked example: the game renders `残り20時間`; the normalised key is `残り#時間`; the value
  `#h left` renders as `20h left`. The same template also covers `残り7時間`.
* Unknown top-level tables are read as exact string tables, so a typo such as `"Strings"` silently
  becomes a second, unused table instead of failing loudly. Keep the two documented keys.
* A brand-new *category directory* (a sibling of `ui/`) needs no plugin change — `manifest.js` walks
  every category recursively — but it does need the manifest to be regenerated.

### 2.2 Scenario — `translation/scenes/<sceneId>/en.json`

A flat object: key = the exact line the game rendered, value = the translation.

```json
{ "ふらっと屋上に来てみると――": "I wander up to the rooftop on a whim, and――" }
```

* Keys come from the harvest dump `…\plugins\MuvluvMod\translation\scene-dump\<sceneId>.json`, whose
  keys are the untranslated rendered lines. Copy the dump's keys verbatim; never retype them.
* Lines may carry markup and prefixes — `<line-height=2.000em>`, real line breaks (`\n`), sprite tags
  such as `<sprite name=wing_blue_left>` — and the player-name placeholder `%usernameusernameuserna%`.
  Keep every marker, translate around it.
* **Choice labels are part of the same file but not part of the dump.** `ScenarioChoiceElementComponent.Apply`
  and `ScenarioHistoryCell.ApplyText` look the label up in the current scene's table, yet the harvest only
  records `Phrase.Text`, so a scene with choices needs those two keys added by hand. Compare against the
  sibling `zh_Hans.json`: the Chinese file carries every key the game looks up, and a key the dump has but
  `zh_Hans.json` does not is a sign the dump is the incomplete one.
* An untranslated line falls back to the Japanese text; nothing breaks.
* A scene is only downloaded when the manifest lists it. A file that is absent from the manifest is
  read locally only (`JsonCachePolicy.LocalOnly`), i.e. it is never fetched from the CDN.
* Scene-id ranges are in `SceneGuide.txt` (10xxxxxx main story, 20xxxxxx events, 3000xxxx tutorials,
  4000xxx1/2 character story/H, 5000xxx1/2 memory story/H, 6000xxxx, 710000xx).

### 2.3 Names — `translation/names/en.json`

```json
{ "speakerNames": { "朽葉ラミ": "Kuchiba Rami" }, "teamNames": { … } }
```

Speaker names appear in dialogue boxes; team names in team UI.

### 2.4 MasterData — `translation/static/en.json`

```json
{
    "CharacterBaseMaster": { "Name": { "桃園める": "Momozono Meru" } },
    "SkillMaster":         { "DescriptionTemplates[]::Template": { "…": "…" } }
}
```

* Property paths mirror the C# property names of the MasterData class: `::` walks into a wrapped
  object, `[]` iterates a collection (`Items[]::Text`, `DescriptionTemplates[]::Template`).
* Many entries still have `value == key`. **Those are the untranslated backlog, not data** — the client
  skips identity entries (`TranslationManager.FilterMasterDataTranslations`). Find them by comparing
  key and value, or with `tools\scripts\lookup-jp.ps1`. Deleting them is unnecessary; translating them
  is the work.
* Do not regenerate or reformat this file wholesale. Add or replace individual entries.

### 2.5 Manifest and the hash contract — `translation/manifest/en.json`

```json
{ "hash": "2668134484cc5efd4e193dedbd1c1922", "names": "…", "static": "…", "ui": "…",
  "scenes": { "10000101": "…" } }
```

* `node manifest.js en` collects every `translation/<category>/**/en.json` (except `manifest/`),
  hashes each file, and writes the manifest.
* The hash is md5 over entries sorted by **Unicode code point**, with `\0` between a key and its value
  and `\x01` between the segments of a nested path (`strings\0自習室へ\0To the Study Room\0…`). The
  client's `TranslationHash` / `StringTableHash.ComputeEntries` implements the same function.
* Therefore **formatting is hash-neutral**: indentation, key order, trailing newlines and
  `\uXXXX`-versus-literal characters do not change the hash. Changing any key or any value does.
* `hash` is the hash of the manifest itself. The client logs it every launch:
  `Translation manifest loaded. Hash: …` — compare it with `translation/manifest/en.json` to know
  whether the game actually saw your push.
* The client re-fetches the manifest on **every** launch, then verifies each cached file against its
  entry:

| policy | when | behaviour |
| --- | --- | --- |
| `Refresh` | manifest hash known, `PreferLocalFiles = false` | use the local copy if it verifies, otherwise download |
| `PreferLocal` | manifest hash known, `PreferLocalFiles = true` | any readable local file wins, no download |
| `LocalOnly` | category/file missing from the manifest | read local, never touch the network |

## 3. Translate → verify → publish

Run everything from the repository root: `C:\Users\Andrew\Desktop\RamiLabu`.

```powershell
# 1. make the change (add/replace entries in the right table)
# 2. regenerate the manifest — always pass the language, the default is zh_Hans
node manifest.js en

# 3. inspect what changed: the data file(s) plus translation/manifest/en.json, nothing else
git status --porcelain
git diff --stat

# 4. commit data + manifest together and push (this is the deployment)
git add translation/ui/en.json translation/manifest/en.json
git commit -m "ui: translate X, Y, Z"
git push origin main
```

`node manifest.js en` followed by `git status --porcelain` is also the **drift check**: a clean tree
means the committed manifest is byte-for-byte what the generator produces.

Then start the game and confirm in `BepInEx\LogOutput.log`:

```text
MuvluvMod    Fetching JSON: https://raw.githubusercontent.com/dorimerrr/RamiLabu/refs/heads/main/translation/manifest/en.json
MuvluvMod    Translation manifest loaded. Hash: 4bf84bceb9cd54994a57681f15188369
MuvluvMod    UI translation loaded. Strings: 585, Templates: 157, …
MuvluvMod    UI text refresh finished. Scanned: 176, Replaced: 36
```

* `Hash:` must equal `hash` in `translation/manifest/en.json`. If it does not, the CDN is still serving
  the old manifest (raw GitHub caching can lag a minute or two) — restart the game to re-fetch.
* `Replaced: 0` plus an `[UI] untranslated text: "…"` line naming your string means the entry does not
  match what the game renders: compare the log line character by character with your key (invisible
  differences: full-width vs half-width punctuation, a trailing space, `\\n` vs a real newline, a
  different line-height prefix).
* Other lines you may see and can ignore: `[Warning:Il2CppInterop] Class::Init signatures have been
  exhausted, using a substitute!` (signature-scanning fallback under Unity 6) and
  `[Translation.Debug] SubmitMissingScenes` reports.

### Testing before you publish

The client only reads this repository through the CDN, so pick one of these to see unpublished work:

* `[Translation.Cache] PreferLocalFiles = true` — any readable local file wins and nothing is
  downloaded. Fastest loop; remember to set it back to `false` afterwards.
* `[Translation] CdnURL = http://localhost:5000` with `npm start` running — `app.js` serves this
  repository's `translation/` tree at `http://localhost:5000/translation/…`, so the real
  manifest/verify path is exercised without pushing.

Do **not** hand-edit the cache instead. With `PreferLocalFiles = false`, a cache file whose content hash
does not match the manifest is rejected and re-downloaded on the next launch (the classic symptom is a
`JSON resource validation failed` warning in the log followed by the edit vanishing).

## 3.1 Reusable workflow for new batches

Use [WORKFLOW.md](WORKFLOW.md) and tools/workflow/cli.js for new authoring work.
The generic workflow freezes source keys separately, imports service results as drafts, requires review,
checks protected tokens and formatting, builds a preview, and applies English output with its manifest.
Historical round scripts remain for reproducibility. Run npm run check:staged before committing;
the new pre-commit hook validates staged English files and their manifest without rewriting files.
Enable it in a new checkout with npm run workflow:install-hook. npm run manifest now runs en only.
Inherited validation problems are audited separately; changed entries must pass the stricter checks.

## 4. The round workflow (translating a batch of new strings)

Rounds 4 and 5 established the pattern; every round keeps its sources of record in `tools/` so it can be
reproduced and reviewed later.

1. **Harvest.** In `BepInEx\config\MuvluvMod.cfg` set `[Translation.Ui] LogSeenText = true` and
   `[Translation.Scenario] LogSeenText = true`, then play the screens/scenes to cover.
   * UI: `BepInEx\LogOutput.log` gains `[UI] untranslated text: "…"` lines. Recording is deduplicated
     and capped at 4096 distinct strings; a string longer than 160 characters is truncated with a
     trailing `…`, and a truncated line can never be used as a key.
   * Scenario: `…\plugins\MuvluvMod\translation\scene-dump\<sceneId>.json` gains an object whose keys
     are the untranslated rendered lines (object keys are unique, so duplicates collapse).
   * Text the game is still animating is skipped until it settles, so the log holds finished strings.
   * **Freeze the harvest before you author anything.** The client rewrites `LogOutput.log` on every
     launch and keeps it open while it runs, so an uncopied harvest is gone on the next start. Keep the
     round's key list in `tools\sources\ui-roundN-harvest.json` (a JSON array of the exact rendered
     strings, in log order) next to the human-readable `ui-roundN-sources.txt`. The builders read keys
     from that JSON, so the round stays reproducible after the log is gone. Appending during a session is
     harmless — new entries land at the end and the existing indices do not move — a restart is not.
2. **Index.** `powershell -File tools\scripts\dump-log.ps1` numbers the harvest and marks each entry
   `STRING` (covered exactly), `TEMPLATE` (covered by a template), `NEEDS` (not covered) plus `[SCENE]`
   and `[TRUNCATED]` markers. Read-only: it needs the live cache/log, which is why those paths stay
   pointed at the game.
3. **Author.** Write the round's sources of record under `tools\sources\`:
   * `ui-roundN-translations.tsv` — `<harvest index><TAB>S|T<TAB>translation`
     (`S` = exact string, `T` = template, digit runs become `#`)
   * `scene-<id>-translations.tsv` — `<dump index><TAB>translation`, plus one
     `@@choice<TAB><japanese label><TAB>translation` row per choice the scene renders (the dump never
     records those, so they are keyed by their source text)
   * Escapes: `<LF>` → real line break, `<ZWSP>` → U+200B (a few of the game's own labels carry it),
     `<CRLF>` → `\r\n` **rejected** — the engine never renders a CR — and a literal backslash-n is written `\\n`
     and stays literal. A key written with a doubled backslash can never match a rendered string.
4. **Build.** Start from the newest builder: `node tools\scripts\build-round7.js` for an interface-only
   round (the harvest JSON, the TSV), or `node tools\scripts\build-scenes-round7.js` for the scenario
   files. The equivalent PowerShell builders (`build-round6.ps1`, `build-round5.ps1`) are the earlier
   rounds and stay in place for reproducibility. The builder takes the **keys from the harvest**, so a key
   can never differ from what the game rendered, and emits an additions JSON (`strings`, `templates`,
   optional `remove`). It also rejects the failure modes the client ignores silently — an empty value, a
   value equal to its key, a Japanese character in a Latin value, a template whose `#` count does not match
   the digit runs — and prints how many harvested strings are still unresolved, which must be 0 when the
   round is done. Retire superseded keys through `remove`, not by editing history.
5. **Merge.** `powershell -File tools\scripts\merge-ui-translations.ps1 -Additions tools\sources\ui-roundN.json -Prune`
   — merges the additions into `translation/ui/en.json` (sorted keys, literal `<`, `>`, `&`, `'`) and
   drops the keys listed under `remove`.
6. **Verify.** `powershell -File tools\scripts\check-coverage.ps1 -Harvest tools\sources\ui-roundN-harvest.json -Resolve`
   must show every harvested string resolving (a run without `-Harvest` reads whatever the current log
   holds, which is the *next* round's backlog); then `node manifest.js en` and `git diff --stat`.
   `tools\\scripts\\check-coverage.ps1` mirrors `UiTextResolver` (the same leading digit-run collapsing
   via an `inDigits` flag, tag-aware substitution, the substitution cap `MaxSubstitutions = 8`) — see
   §2.1.
7. **Record.** Copy the round's artifacts into `tools\sources\`, `tools\snapshots\` (table before/after)
   and `tools\reports\`, then commit data, manifest and tooling together.

## 5. Verification recipes

| command | what it proves |
| --- | --- |
| `node manifest.js en` + `git status --porcelain` | committed manifest == generated manifest (no drift) |
| `powershell -File tools\scripts\dump-log.ps1` | per-entry status of the current harvest (`STRING`/`TEMPLATE`/`NEEDS`) |
| `powershell -File tools\scripts\check-coverage.ps1 -Harvest tools\sources\ui-roundN-harvest.json -Resolve` | every harvested string resolves; prints the ones that do not. Add `-Harvest ''` to read the live log instead |
| `powershell -File tools\scripts\lookup-jp.ps1 -Snippet '<japanese>' -Max 3` | where a term sits in `static/*.json` and whether it still reads as untranslated |
| `node tools\audit-local-vs-upstream.js` | per-file verdict for the live cache: `UPSTREAM` (matches the published hash), `LOCAL-EDIT` (differs), `LOCAL-ONLY` (not in the manifest) |
| `dotnet run --project C:\Users\Andrew\Desktop\Airi\artifacts\ui-coverage\ui-coverage.csproj -- <harvest.json> translation\ui\en.json <report.txt>` | authoritative: compiles and runs the mod's real `UiTextResolver` against the harvest |

`check-coverage.ps1` is a PowerShell mirror of the resolver; the `ui-coverage` harness in the mod
checkout is the real thing. When the two disagree, the harness wins.

## 6. Runtime configuration that changes the workflow

`C:\Users\Andrew\muv_luv_girlsgardenx_cl\BepInEx\config\MuvluvMod.cfg`:

| key | value in use | effect on translation work |
| --- | --- | --- |
| `[Translation] Enable` | `true` | master switch for all translation |
| `[Translation] CdnURL` | `https://raw.githubusercontent.com/dorimerrr/RamiLabu/refs/heads/main` | where the client downloads from; every push to `main` is live here. Point it at `http://localhost:5000` to test locally |
| `[Translation] Language` | `en` | which `<language>.json` files are used — this is the language to translate |
| `[Translation.Cache] Directory` | `MuvluvMod/translation` | cache root, relative to `BepInEx\plugins` |
| `[Translation.Cache] PreferLocalFiles` | `false` | `false` = manifest-verified download (edits to the cache get reverted); `true` = any readable local file wins (local testing) |
| `[Translation.Ui] Enable` | `true` | interface translation |
| `[Translation.Ui] LogSeenText` | `true` | harvest untranslated UI text into `LogOutput.log` |
| `[Translation.Scenario] LogSeenText` | `true` | dump untranslated scenario lines into `scene-dump\` |
| `[Translation.Debug] SubmitMissingScenes` | `false` | keep off unless the client should report missing scenes upstream |
| `[Update] CheckForUpdates` | `false` | plugin self-update; unrelated to translation |

## 7. Gotchas

* `manifest.js` defaults to **`zh_Hans`**. `node manifest.js` without arguments rewrites the wrong
  manifest; always pass `en`.
* `npm install` runs `prepare: husky`. The rebuilt `.husky/pre-commit` runs the read-only staged validator, not a manifest generator. Enable it with `npm run workflow:install-hook`; generate and stage the English manifest yourself before committing.
* `core.autocrlf=true`: the worktree holds CRLF, the repository stores LF, and the generator writes
  `os.EOL` (CRLF). Line-ending warnings on `git add` are expected and harmless.
* `translation/scene-dump/` is excluded through `.git/info/exclude` (not the shared `.gitignore`), so
  runtime dumps can never be committed. Never add it to `.gitignore` — that would change the file that
  upstream's repository tracks.
* `manifest.js` only catalogues `translation/<category>/<language>.json`. Nothing under `tools/`, and
  not the scripts or docs, is hashed — editing tooling can never move a hash or reach the game.
* An entry whose value equals its key, or whose value is empty, is dropped by the client; adding such a
  placeholder does nothing at all. A harvest entry that is *already* English is the same trap in disguise:
  the UI log reports scenario text it renders too, and translating an English sentence can only produce
  the identical value.
* `Scenario translation load failed: <id>` in the log means no `translation/scenes/<id>/en.json` exists:
  build it from that scene's dump (round 9 did this for `10280101` with
  `node tools/scripts/build-scenes-round9.js`), not from the log text, whose scenario lines carry the
  substituted player name and the `<line-height=…>` prefix the key must not have. `node
  tools/scripts/check-round9.js` fails if a reported scene line is missing from that table.
* Template entries are all-or-nothing. If a value has the wrong number of `#`, the entry is ignored and
  the game keeps showing Japanese — no error, no partial translation.
* CR-bearing keys can never match (audit: `node tools/scripts/audit-scene-newlines.js` and
  `node tools/scripts/repair-newlines.js`). The game renders a line break as a bare LF: the scene dump
  holds 268 lookup keys with no CR at all, and round 8's live harvest re-captured five strings round 7
  had recorded with CRLF as bare LF, so the CRs came from the snapshot tooling, not the engine. Round 7
  swept the UI table the same way (LF twins in, CRLF keys retired through `remove`); repair remaining
  `translation/scenes/<id>/en.json` CRs with `node tools/scripts/repair-newlines.js --write` (never touch
  `zh_Hans.json`, per rule 2). CRs also sit in `translation/static/en.json` (3 `ShopProductMaster`
  value-equals-key placeholders) and in the upstream `zh_Hans` scene files — reported, not repaired.
* Rich-text markup is never digit-substituted, and `#` inside a tag is not a placeholder. Check a
  template against `<color=#…>` and `<size=…>` values before assuming an off-by-one.
* Full-width punctuation in an *English* value flips the full-width-digit conversion (see 2.1). Prefer
  half-width punctuation in `en` values.
* Adding a category directory or a scene file is picked up automatically by `manifest.js`, but the
  manifest must then be regenerated, committed and pushed — otherwise the client never sees the file.
* The `…`-truncated harvest lines (over 160 characters) cannot be used as keys. Re-harvest with
  `LogSeenText` on and capture the string from a screen that renders it shorter, or take the exact text
  from a scene dump.
* Raw GitHub can serve a stale manifest for a minute or two after a push. If the in-game hash is the old
  one, restart the client before debugging anything else.
* `zh_Hans` files are upstream's data. `npm run manifest` now generates **en only**; never pass `zh_Hans` during English work.

## 8. Pointers

* `tools/README.md` — detailed history and internals of the working copy (the junction-based setup, the
  pre-publish era, per-round detail). Its sections 1 and 7 describe an earlier wiring; trust this file
  and the current configuration for paths and values.
* `README.md` — upstream's Chinese README: the `zh_Hans` layout plus the MasterData *source* schema
  (`tables` / `flat_types`) that produced `translation/static/*.json`.
* `SceneGuide.txt` — scene-id ranges and which MasterData class feeds which screen.
* Mod source, read-only, outside this repository: `C:\Users\Andrew\Desktop\Airi` — `README_EN.md`
  ("Interface text"), `src\MuvluvMod\Services\{UiTextResolver,TranslationHash,TranslationCache,
  TranslationManager}.cs`, `src\MuvluvMod\Patches\{UiTextPatch,TranslationPatch}.cs`, and
  `artifacts\ui-coverage\` (the coverage harness). Its `artifacts\` tree is gitignored scratch and holds
  older copies of the scripts in `tools\scripts\`.
* Upstream translation repository for `zh_Hans`: `anosu/muvluvgg-translation`; this fork publishes `en`
  only.

