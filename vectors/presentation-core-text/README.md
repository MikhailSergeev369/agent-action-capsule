# Presentation core text vectors

The core's fixed text of `spec/presentation-contract-v0.md` section 6.2: the
verification banner and the line under it, the refusal, the check lists and
the rest of the core's verification section. No module and no wording pack
supplies any of it, so every page and every builder shows these words.

These vectors are derived from the specification text, not from an
implementation. Where they and the specification disagree, the specification
governs and the vectors are corrected. A runtime that draws the core's text
runs every case; today that is the TypeScript core
(`ts/src/evidence-graph-view.ts`, `ts/src/verification-page.ts`).

## Files

- `core-text.json`: every string, by role. `banner` holds the four states'
  banners; `banner_note_uncheckpointed` gives the line under a verified
  banner when records are not covered by the log's checkpoint, with its
  singular and plural forms; `check_lines` gives one line per section 6.1
  check, keyed by its `data-check` value; `check_rows` holds the one-by-one
  check lines, the `Technical name` row under each and the result words;
  `extension_meaning` holds the three meaning-cell lines of an extension
  row.
- `states.json`: one golden per banner state a runtime reaches today:
  `verified` (with and without the line under it), `failed` and `unable`. A
  case names a literal bundle (in `vectors/bundle/report-single-record.json`
  or `bundles.json`), applies RFC 6902 `patch` operations to it and renders
  it with or without SHA-256 (`digest`). `expect` is the banner's words and
  data attributes, the line under it and the refusal after it; `never` is
  what the page must not show for that state. `unable` is never drawn as `failed`. `pending` holds
  the `checking` state: its words are fixed in `core-text.json`, and its
  golden and a slow-hash fixture that holds it on screen are left to the
  viewer's four-state test.
- `bundles.json`: the one literal bundle the goldens need that
  `vectors/bundle` does not hold, a verified bundle with one of its four
  records outside the log's checkpoint. It was sealed once from a test
  fixture and is literal data from then on.
- `refusals.json`: wording packs that carry a reserved `core.` key (refused,
  and rejected by `$defs/WordingPack`) beside packs that do not, and page
  modules that rewrite, restyle, remove or restate the banner or the check
  lists during `render` (refused: the page shows the `presentation-failed`
  refusal) beside modules that only add their own content or use
  `setChromeClass` (not refused).

## Shared encodings

- A pack is given to the renderer as the JCS text of `pack`, with the SHA-256
  of those bytes as its `wording_sha256`.
- A module `action` is one of: `append` (an element `tag` with `text` and
  `data-*` attributes from `data`, appended to the module's region);
  `set-chrome-class` (the host's `setChromeClass` with the runtime's own
  chrome class); `set-banner-text`; `set-banner-data` (`data-<name>` on the
  banner); `set-banner-class` (the banner's class attribute, set directly);
  `remove-banner`; `set-banner-note-text` (the line under the banner).
