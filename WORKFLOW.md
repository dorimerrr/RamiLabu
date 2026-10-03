# RamiLabu translation workflow

This is the current English authoring workflow. Node.js 18+ is sufficient; its commands need no npm install.
The published translation paths and Airi runtime formats are unchanged. Existing translations and historical
round artifacts remain available as unreviewed reference material. Work on a branch until ready to publish.

## Repository responsibilities

- `translation/`: mod-compatible output. Never author in the game cache or Airi checkout.
- `tools/batches/<name>/`: frozen source capture, source inventory, and human review worksheet.
- `tools/builds/<name>/`: ignored, disposable preview output and change plan.
- `tools/workflow/`: reusable CLI, validation, tests, style guide, and approved glossary.
- `tools/sources/`, `tools/snapshots/`, `tools/reports/`, `tools/scripts/`: historical round records and scripts.

Upstream MuvluvMod reads names, static MasterData and scenes. Airi additionally reads UI strings/templates
and produces UI logs/scene dumps. A new manifest category needs an actual mod consumer to have an effect.

## 1. Freeze a source batch

```powershell
npm run workflow -- import --kind scene --scene 10280101 --input C:/path/to/scene-dump/10280101.json --out tools/batches/scene-10280101
npm run workflow -- import --kind ui --input C:/path/to/harvest.json --out tools/batches/ui-next
npm run workflow -- import --kind ui-log --input C:/path/to/LogOutput.log --out tools/batches/ui-session
npm run workflow -- import --kind static --input translation/static/en.json --only-untranslated --class SkillMaster --limit 100 --out tools/batches/skill-backlog
npm run workflow -- import --kind names --input translation/names/en.json --out tools/batches/name-review
```

Import never overwrites a batch. It preserves the input as capture.txt, hashes it, and saves sources.json.
It creates work.json with pending entries. IDs derive from the target file and exact lookup path, not array indices.
UI numeric variants share a normalized key but retain every captured sample. Full-width digits are recognized.
`--only-untranslated` selects entries not already covered by usable values in the current English target.
`--limit N` bounds any import; `--class`/`--property` select a MasterData group and `--table` selects a names table.
Use small contextually related batches for the large static backlog; a selected CR-bearing source still needs recapture.
Existing translations are retained as references in sources.json, not automatically marked reviewed.

Scene input is a flat JSON dictionary keyed by source lines. Include choice keys copied from the Chinese sibling
when the dump does not include them. UI input is either a string array or a strings/templates dictionary.
Static and names imports use their runtime dictionary shapes. Duplicate JSON keys, CR-bearing sources, and
truncated UI-log entries are rejected. A scene/UI source ending naturally in an ellipsis is not automatically
considered truncated when imported from full JSON.

Scene dumps supply neighboring lines in captured order, not full scene structure or speaker identity.
`--context context.json` can add verified context keyed by each exact source string:

```json
{"Japanese source": {"speaker": "Verified speaker", "sceneNotes": "Screen/branch/emotional context"}}
```

Logs can mix scenario text with UI text. Review the classification before translating; skip scene lines in a UI
batch with a reason and import their exact scene-dump keys separately. Freeze the log before restarting the game.
Do not silently strip line-height prefixes or substitute player names into scenario keys.

## 2. Author or import translation drafts

Edit only the translation, status and note fields in work.json. Statuses are pending, draft, reviewed, and skipped.
Use draft until the wording has been reviewed in context. A skipped entry requires an explanatory note.
Never edit capture.txt, sources.json, IDs, source keys, or target paths. The worksheet is bound to its source hash.

For manual translation or a future external service:

```powershell
npm run workflow -- requests --batch tools/batches/ui-next --out tools/batches/ui-next/requests.json
```

Requests include stable IDs, source text, existing reference translations, context, STYLE.md and glossary.json.
No network call is made and no external service is configured. A service adapter must return this JSON shape:

```json
{
  "schema": 1,
  "sourceFingerprint": "copy this value from requests.json",
  "entries": [{"id": "copy a source ID", "translation": "English draft"}]
}
```

```powershell
npm run workflow -- draft --batch tools/batches/ui-next --input response.json
npm run workflow -- validate --batch tools/batches/ui-next
```

Responses may contain a subset of pending IDs. Unknown/duplicate IDs, changed source fields, altered tokens,
and overwrites of existing work are rejected before the worksheet is saved. Imports always create drafts.
Review each draft, set its status to reviewed, and record uncertainties in note. Linguistic quality is a human
review responsibility; preservation checks cannot establish correct characterization, lore or mechanics.

## 3. Validate, preview and apply

```powershell
npm run workflow -- validate --batch tools/batches/ui-next --complete
npm run workflow -- build --batch tools/batches/ui-next --out tools/builds/ui-next
```

All entries must be reviewed or explicitly skipped. Build validates before writing its output directory.
It preserves exact keys, markup attributes/order, brace/player placeholders, literal escape sequences,
zero-width spaces and LF counts. UI # counts must match individually, outside tags, and stay within eight.
UI templates reject Japanese/full-width characters that inhibit ASCII digit conversion. Japanese identifiers
inside protected placeholders are permitted for scenes/static data.

Preview output contains only changed English files, a generated candidate manifest, and plan.json. Inspect it
before applying. Static output updates individual JSON values/additions without reformatting the entire file.
Unrelated table entries remain intact. A changed target file invalidates the batch baseline and requires a new
import/reconciliation; an altered preview is rejected. Apply has rollback for ordinary write failures, but a
process crash/power failure across multiple files is not a filesystem transaction: inspect git status and
regenerate the English manifest if interrupted.

```powershell
npm run workflow -- apply --build tools/builds/ui-next
npm run check
```

Apply writes English files only and runs the existing manifest generator for en. It never commits or pushes.
Source keys and resource removals are deliberately unsupported by this workflow; reconcile an intentional
retirement separately, with evidence from the actual resolver, before changing the validation policy.

## 4. Commit and publish

```powershell
npm test
npm run workflow:install-hook
node manifest.js en
git diff --stat
# Stage the changed en data, its manifest, and the frozen batch records together.
npm run check:staged
```

The hook checks the staged Git index, including staged file content and manifest hashes. It does not mutate,
stage, or regenerate anything. Changed entries must pass preservation checks; inherited problems do not block
unrelated commits. `npm run audit` reports inherited backlog and structural issues; the printed samples are
limited to 20, with the total count included. Repository checks do not establish game-side property existence.

`npm run manifest` now generates en only. No dependency changed. Husky installation remains optional; the
install-hook command directly enables .husky in this checkout. Future checkouts must install/enable hooks too.
Once reviewed, commit data and manifest together. Merge/push to main only when ready: main is the live CDN.
Airi can test unpublished output through the local server or PreferLocalFiles as described in AGENTS.md.

## Verification boundaries

The new JS resolver mirrors the inspected Airi source and has focused tests for tags, full-width digits,
placeholder counts, safety failures and staged index behavior. The external real-resolver harness remains
authoritative if they disagree. No harness build or game launch is required by this CLI.

Existing round-specific scripts are kept for reproducibility, but use this CLI for new batches. Existing UI
template warnings, static identity values, and inherited untranslated prose are not silently rewritten.
