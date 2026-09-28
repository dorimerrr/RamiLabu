# tools — English translation working material

Repository: `C:\Users\Andrew\Desktop\RamiLabu`, published as `dorimerrr/RamiLabu` (branch `main`) and
served to the game through `CdnURL`.
Live game cache: `C:\Users\Andrew\muv_luv_girlsgardenx_cl\BepInEx\plugins\MuvluvMod\translation`.

> **Current state (2026-09-27).** Sections [1](#1-how-the-working-copy-and-the-game-are-wired),
> [2](#2-what-the-working-copy-adds-and-what-it-only-mirrors) and [7](#7-publishing) describe the
> pre-publish setup and are kept here as history. Today:
>
> * the repository has a single remote, `origin` = `https://github.com/dorimerrr/RamiLabu.git`, and one
>   branch, `main` (no `ansen`, no `upstream`, no branch `en`);
> * `CdnURL` points at that repository and `PreferLocalFiles = false`, so the published manifest governs
>   what the client loads;
> * the cache categories are plain directories, **not junctions**;
> * `ui` **is** published in `translation/manifest/en.json`;
> * pushing to `main` is the deployment — it is live, not pending permission.
>
> For paths, schemas, commands and the publish checklist use [`../AGENTS.md`](../AGENTS.md) (English,
> agent-facing); the sections below keep the round-by-round history and the reasoning behind the setup.

This directory is **not** part of the published translation data: it holds the build scripts, the
translation sources of record (TSV/JSON as authored, before they are merged into a table) and the
coverage reports. Neither this fork nor `anosu/muvluvgg-translation` carries a `LICENSE` file — worth
settling before the repository is opened up any further.

## 1. How the working copy and the game are wired

Remotes (then, and now):

```text
anson-era setup
ansen     https://github.com/ansen-test/muvluvgg-translation.git   (the fork; push target)
upstream  https://github.com/anosu/muvluvgg-translation.git        (read-only; push URL disabled)

today
origin    https://github.com/dorimerrr/RamiLabu.git                (published; branch main)
```

Branch `en` held the English work, and `main` stayed a pristine mirror of `ansen/main`, so everything
the working copy added was `git diff ansen/main..en`. The published repository replaced that: it has one
branch, `main`, and its history is the whole contribution.

| path under `plugins\MuvluvMod\translation\` | kind then → now | target |
| --- | --- | --- |
| `names` | junction → plain directory | `RamiLabu\translation\names` |
| `static` | junction → plain directory | `RamiLabu\translation\static` |
| `scenes` | junction → plain directory (only when a scene is fetched) | `RamiLabu\translation\scenes` |
| `ui` | junction → plain directory | `RamiLabu\translation\ui` |
| `manifest` | real directory | runtime copy, refreshed from the CDN on every launch |
| `scene-dump` | real directory | runtime output of `[Translation.Scenario] LogSeenText` |

While the four authored categories were junctions, a file the game wrote *is* the repository file:
editing `…\plugins\MuvluvMod\translation\ui\en.json` edited `RamiLabu\translation\ui\en.json`, and the
build scripts that write scene files wrote straight into the worktree. With plain directories that no
longer holds — the repository is the source of truth, the cache is a download — so translation data is
edited in `RamiLabu\translation\**` and republished (`node manifest.js en`, commit, push). The scripts
in `tools\scripts\` follow that rule: their defaults read and write the repository and take only
`BepInEx\LogOutput.log` and `scene-dump\` from the game.

`manifest` deliberately stays a plain directory. `TranslationCache.LoadManifestAsync` refreshes the
manifest from the CDN on every launch (it is never `PreferLocal`), so a junction there would let the
game overwrite the generated `translation\manifest\en.json` and dirty the worktree.
`scene-dump` stays a plain directory because it is machine output, not translation data.

`BepInEx\config\MuvluvMod.cfg` (backup: `MuvluvMod.cfg.bak-20260926`):

| section | key | value | why |
| --- | --- | --- | --- |
| `Translation` | `Enable` | `true` | translation on |
| `Translation` | `CdnURL` | `…/dorimerrr/RamiLabu/refs/heads/main` | the published repository that serves `en` |
| `Translation` | `Language` | `en` | English tables |
| `Translation.Cache` | `Directory` | `MuvluvMod/translation` | cache root, relative to `BepInEx\plugins` |
| `Translation.Cache` | `PreferLocalFiles` | `false` | the published manifest governs; cache edits are re-downloaded |
| `Translation.Ui` | `Enable` | `true` | interface translation |
| `Translation.Ui` | `LogSeenText` | `true` | harvest untranslated interface text into `LogOutput.log` |
| `Translation.Scenario` | `LogSeenText` | `true` | dump untranslated scenario lines into `scene-dump\` |

Why `PreferLocalFiles = false` (`TranslationCache.LoadResourceAsync`, `Utility.Caching.JsonCachePolicy`):

| policy | when it is chosen | effect |
| --- | --- | --- |
| `Refresh` | manifest hash known, `PreferLocalFiles` off | verified local copy, otherwise download |
| `PreferLocal` | manifest hash known, `PreferLocalFiles` on | **any readable local copy wins; no download** |
| `LocalOnly` | category/file absent from the manifest | read local, never touch the network |

With `PreferLocalFiles = false` the client verifies a cached file against the manifest hash and
re-downloads it whenever they differ, so the cache is disposable and the repository is authoritative: an
edit that has not been published disappears on the next launch. That is the historical
"`JSON resource validation failed`" trap — a local edit to the cache with a stale manifest. To work on
unpublished data, set `PreferLocalFiles = true` or point `CdnURL` at the local server (`npm start` →
`http://localhost:5000`); both are documented in `../AGENTS.md`.

## 2. What the working copy adds, and what it only mirrors

`node tools\audit-local-vs-upstream.js` on the cache, 2026-09-26:

| verdict | files |
| --- | --- |
| `UPSTREAM` (hash equals the published manifest) | `names/en.json`, `static/en.json`, 16 cached scene files |
| `LOCAL-ONLY` (no manifest entry at all) | `ui/en.json`, `scenes/30010101/en.json`, `scenes/61001401/en.json` |

Upstream, `translation/scenes/30010101/` and `translation/scenes/61001401/` exist but hold only
`zh_Hans.json`, and `translation/ui/` does not exist at all. So the English contribution is exactly
those three files, plus the regenerated `translation/manifest/en.json`; every other file is ansen's
data, byte for byte.

The snapshot above predates publishing: it was taken while the fork still mirrored `ansen/main`, which is
why `ui/en.json` had no manifest entry at all. In the published repository `translation/ui/` is part of
the manifest, and the same audit reports `ui/en.json` as `UPSTREAM` whenever it matches the published
hash. Re-run the command for current verdicts instead of trusting the table.

The import is commit `3c3935d` ("Add English interface table and two translated scenes") on `en`:
3 new files + the manifest, `716 insertions(+), 3 deletions(-)`.

**Manifest parity was proven before importing anything.** On the pristine fork,
`node manifest.js en` regenerated ansen's committed `translation/manifest/en.json` with an identical
`hash` (`ca79f5dd933c0718fb58cdc5a2fb8fc8`) and an empty `git status`, so the repository's generator
and the plugin's `TranslationHash`/`StringTableHash.ComputeEntries` agree. After the import the same
command yields `ui=3bee8df6c8597d72661950b8dad5a39f`, `scenes.30010101=9a557280ec63410300944e989e31ce37`,
`scenes.61001401=67f9e7921fb15a72514d140734621a9f`, with `static=964a5113d6d55e6af6b8da719ea6e643`
and `names=2dc6a5f14c94920c3e2513586a7eaa38` unchanged and `scenes=623`.

Sizes and counts at import: `ui\en.json` 89,291 B (556 strings + 146 templates = 702 entries),
`static\en.json` 3,372,023 B (ansen's table, untouched), `names\en.json` 37,320 B,
`scenes\30010101\en.json` 15 entries, `scenes\61001401\en.json` 22 entries — no empty values, and
`manifest\en.json` now reports `hash=2668134484cc5efd4e193dedbd1c1922` over 623 scenes.

## 3. Rounds so far

| round | date | scope | sources of record | builder | artifacts |
| --- | --- | --- | --- | --- | --- |
| 1–3 | ≤ 2026-09-23 | first interface table, built from `[UI] untranslated text:` log lines | `sources\ui-harvest.json`, `ui-harvest.txt`, `ui-harvest-escaped.txt`, `ui-round3a.json`, `ui-round3b.json`, `ui-additions.json` | `scripts\merge-ui-translations.ps1` | `snapshots\ui-en-backup-before-round4.json` (49,026 B) |
| 4 | 2026-09-25 | interface batch 4 + scene `61001401` | `sources\ui-round4-translations.tsv`, `sources\scene-61001401-translations.tsv` | `scripts\build-round4.ps1` → `sources\ui-round4.json` + merge | `snapshots\ui-en-after-round4.json` (60,695 B), `reports\ui-round4-report.txt` |
| 5 | 2026-09-26 | interface batch 5 + scene `30010101` | `sources\ui-round5-translations.tsv`, `sources\ui-round5-sources.txt`, `sources\scene-30010101-translations.tsv` | `scripts\build-round5.ps1` → `sources\ui-round5.json` + merge | `snapshots\ui-en-pre-round5.json` (60,695 B), `translation\ui\en.json` 89,291 B |
| 6 | 2026-09-27 | interface batch 6: 38 harvested strings plus the two navigation labels the harvest never logged (`生徒`, `サークル`) | `sources\ui-round6-harvest.json` (frozen keys), `sources\ui-round6-sources.txt`, `sources\ui-round6-translations.tsv`, `sources\ui-round6-extras.json` | `scripts\build-round6.ps1` → `sources\ui-round6.json` + merge | `reports\ui-round6-report.txt`, `translation\ui\en.json` 585 strings + 157 templates |

Both scene files were built dump-first: the keys are the phrases the game itself rendered
(`<scene-id>.json` in `scene-dump\`), and the TSV only supplies values, so a table entry cannot drift
from the rendered string. Round 4 also retired two keys that carry a doubled backslash
(`…\\n全ワールド…`, `…\\nキャラクターのスキル…`) through the `remove` list, because such a key can never
match the rendered text.

Interface coverage is scored against the real resolver, not a re-implementation:
`C:\Users\Andrew\desktop\Airi\artifacts\ui-coverage\` is a `net8.0` harness that includes
`..\..\src\MuvluvMod\Services\UiTextResolver.cs` and calls `UiTextResolver.Create`/`TryResolve`
itself, so it has to stay in the mod workspace where the plugin source lives:

```powershell
dotnet run --project C:\Users\Andrew\desktop\Airi\artifacts\ui-coverage\ui-coverage.csproj -- `
    <harvest.json> C:\Users\Andrew\desktop\RamiLabu\translation\ui\en.json <report.txt>
```

Its latest report is archived as `reports\ui-coverage-report.txt`; `scripts\check-coverage.ps1` is the
PowerShell mirror of the same rules (exact match, then digit-run template, tags excluded).

## 4. Everyday commands

Run from `C:\Users\Andrew\desktop\RamiLabu` unless a path says otherwise.

```powershell
# the manifest is generated by hand: always pass the language, the default is zh_Hans
node manifest.js en

git status --porcelain          # what the working copy changed
git diff ansen/main..en --stat  # the whole contribution, one line per file

# provenance audit: UPSTREAM vs LOCAL-EDIT vs LOCAL-ONLY for the live cache
node tools\audit-local-vs-upstream.js
node tools\audit-local-vs-upstream.js --language en

powershell -File tools\scripts\check-coverage.ps1 -Resolve   # or -ShowEscapes
powershell -File tools\scripts\check-coverage.ps1 -Harvest tools\sources\ui-round6-harvest.json -Resolve
powershell -File tools\scripts\build-round6.ps1        # interface-only round: keys from the frozen harvest
powershell -File tools\scripts\dump-log.ps1                  # index the harvest, [SCENE] markers
powershell -File tools\scripts\lookup-jp.ps1 -Snippet '親愛度' -Max 3
powershell -File tools\scripts\merge-ui-translations.ps1     # merges sources\ui-additions.json (-Prune honours "remove")
```

The scripts default to the repository paths, so `build-*.ps1` writes `ui\en.json` and
`scenes\<id>\en.json` straight into the worktree; only `LogOutput.log` and `scene-dump\` are read from
the game.

Taking an upstream update (`zh_Hans` fixes, new `zh_Hans` scene files): the published repository has a
single remote, so add `ansen` / `upstream` as remotes if you need them, merge, then `node manifest.js en`
and commit the data and the manifest together. `main` has no upstream tracking branch, so `git pull`
alone does nothing useful.

## 5. Round 6 — static MasterData

`translation\static\en.json` is ansen's single MasterData table (schema documented in the repository
`README.md`: `tables.<class>.<property>` plus `flat_types`). It is one large file, so do not hand-edit
it: keep the round's entries in `tools\sources\static-round6-translations.tsv` and merge them with a
builder, exactly like the interface rounds (`build-round4.ps1` is the template: read the indexed
listing, apply the TSV rows, verify, write). Then `node manifest.js en`, `git diff --stat`, commit.

Two things make the gap list:

- `scripts\lookup-jp.ps1 -Snippet <term>` prints the `ZH` and `EN` value at the same path, so an `EN`
  that is still Chinese is visible in one command.
- Diff `translation\static\en.json` against `translation\static\zh_Hans.json` path by path: a path
  whose two values are identical is a leftover of the Chinese table, and the script
  `check-coverage.ps1` style verification (escape/newline markers intact) applies to it as well.

Keep the round's artifacts in the same subfolders (`sources\`, `reports\`, snapshots of the table
before and after) so the next round can be reproduced from the repository alone.

## 6. Gotchas

- `manifest.js` defaults to `zh_Hans`. Always pass `en`.
- Do not run `npm install` here: it only installs Husky, whose `pre-commit` hook regenerates the
  `zh_Hans` manifest and aborts when translation files are untracked. `core.hooksPath` is unset, so no
  hook runs — the `en` manifest is generated by hand.
- `core.autocrlf=true`: the worktree holds CRLF, the repository stores LF. The generator writes CRLF,
  so a warning can appear on `git add` even when the content is unchanged.
- The client **rewrites `LogOutput.log` at every launch** and holds it open while it runs, so a harvest must be frozen into `sources\ui-roundN-harvest.json` before a round is authored, and the round scripts read the file with `FileShare.ReadWrite` instead of `File.ReadAllText`.
- `translation/scene-dump/` is listed in `.git/info/exclude` (not the shared `.gitignore`) so runtime
  dumps can never be committed.
- `[Translation.Debug] SubmitMissingScenes = true` still reports scenes without a translation to the
  mod's debug endpoint. Scenes `30010101` and `61001401` no longer qualify: their files exist locally.
- `PreferLocalFiles = false` means the published manifest decides: a file that is present locally but
  does not match its published hash is replaced by the download. Publish through the repository instead.
- A file the CDN serves but that has no local copy is simply downloaded into the cache, and it no longer
  appears in the worktree (the categories are plain directories now). Copy it into
  `RamiLabu\translation\**` only if it belongs to this fork.
- The pre-junction cache is preserved at `plugins\MuvluvMod\translation.orig` (with
  `MuvluvMod.cfg.bak-20260926` as the config backup). Delete both once the game has been started and
  the tables have been verified in game.
- Running the game with `Translation.Ui.LogSeenText` / `Translation.Scenario.LogSeenText` on appends
  to `BepInEx\LogOutput.log` and `scene-dump\`; both feeds are the input of the next round.

## 7. Publishing

Published. The English tables, `translation/manifest/en.json` and this `tools/` tree are on `main` of
`dorimerrr/RamiLabu`, which is what `CdnURL` points at, so a push is the deployment: regenerate the
manifest with `node manifest.js en`, commit the data and the manifest together, push.

Neither this fork nor `anosu/muvluvgg-translation` carries a `LICENSE` file — worth settling before the
repository is opened up any further.

If the work is ever offered upstream, the natural split is still one PR per category: the interface table
plus manifest, the scene files, and later the static additions as added entries rather than a whole-file
replacement of ansen's table.

## 8. Fallback: a cache without junctions

`tools\sync-to-cache.ps1` copies the authored categories from the repository into a plain cache
directory. It refuses to run when the cache root is a reparse point and skips category junctions,
never copies `manifest` (the plugin refreshes it from the CDN) and never copies `scene-dump`:

```powershell
powershell -File tools\sync-to-cache.ps1 -Repository C:\Users\Andrew\desktop\RamiLabu `
    -Cache C:\Users\Andrew\muv_luv_girlsgardenx_cl\BepInEx\plugins\MuvluvMod\translation -Language en
```

The junctions are gone, so this is now the way to (re)seed the cache with published files. It cannot make
unpublished edits stick: the client verifies a copied file against the manifest and re-downloads it when
the hash differs (`PreferLocalFiles = false`).

## Layout

```text
tools/
|-- README.md                      this file
|-- audit-local-vs-upstream.js     UPSTREAM / LOCAL-EDIT / LOCAL-ONLY audit of the cache
|-- sync-to-cache.ps1              fallback copy into a non-junctioned cache
|-- scripts/                       build and inspection scripts (build-round4/5, check-coverage,
|                                  dump-log, lookup-jp, merge-ui-translations)
|-- sources/                       TSV/JSON sources of record, as authored per round
|-- snapshots/                     ui\en.json before/after a round
`-- reports/                       coverage and verification reports
```


