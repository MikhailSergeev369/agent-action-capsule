# SPDX-License-Identifier: BSD-3-Clause
"""The presentation core text vectors agree with spec/presentation-contract-v0.md section 6.2.

The vectors are written by hand from the specification text, so this test reads them
against it. Every string the corpus fixes appears verbatim in section 6.2, or, for the
check-list headings and the refusal of I1, elsewhere in the document. The banner states are the four the section
tables, and the reader-facing lines follow the word rules of sections 6.1 and 6.2. The
`unable` golden can never be drawn as `failed`. The corpus refuses exactly the packs that
carry a reserved `core.` key; that each refused pack is also rejected by $defs/WordingPack
is checked by schemas/check_presentation_manifest_examples.py, which has jsonschema.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[2]
VECTORS = ROOT / "vectors" / "presentation-core-text"
SPEC = ROOT / "spec" / "presentation-contract-v0.md"


def _load(name: str) -> Any:
    return json.loads((VECTORS / name).read_text(encoding="utf-8"))


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _flat(text: str) -> str:
    return re.sub(r"\s+", " ", text)


def _section_6_2() -> str:
    text = SPEC.read_text(encoding="utf-8")
    start = text.index("### 6.2 The core's fixed text")
    return _flat(text[start : text.index("## 7. The text-binding rule")])


CORE = _load("core-text.json")
STATES = _load("states.json")
REFUSALS = _load("refusals.json")


def _section_lines() -> list[str]:
    """Every reader-facing string section 6.2 itself quotes."""
    lines = list(CORE["banner"].values())
    lines += list(CORE["check_lines"].values())
    lines += [CORE["checkpoint_not_checked_note"], CORE["full_verifier_line"], CORE["scope_line"]]
    rows = CORE["check_rows"]
    lines += [rows["heading"], rows["technical_summary"]]
    lines += [r["line"] for r in rows["rows"]] + [r["technical"] for r in rows["rows"]]
    lines += list(rows["results"].values())
    lines += [CORE["empty_value"], CORE["wording_pack_refused"]]
    lines += list(CORE["coverage_line"].values())
    lines += list(CORE["unable"].values())
    lines += list(CORE["extension_meaning"].values())
    return lines


def _all_lines() -> list[str]:
    lines = _section_lines() + list(CORE["check_list_headings"].values())
    lines += [c["line"] for c in CORE["banner_note_uncheckpointed"]["cases"]]
    return lines


def test_manifest_pins_every_file_and_the_top_level_registers_them():
    manifest = _load("manifest.json")
    assert manifest["provenance"] == "spec-derived"
    pinned = {f["path"]: f["sha256"] for f in manifest["files"]}
    assert set(pinned) == {"core-text.json", "states.json", "refusals.json", "bundles.json"}
    for name, digest in pinned.items():
        assert _sha((VECTORS / name).read_bytes()) == digest, name
    top = dict(reversed(line.split("  ", 1)) for line in
               (ROOT / "vectors" / "SHA256SUMS").read_text(encoding="utf-8").splitlines())
    for path in VECTORS.iterdir():
        assert top.get(f"presentation-core-text/{path.name}") == _sha(path.read_bytes()), path.name
    corpora = json.loads((ROOT / "vectors" / "manifest.json").read_text(encoding="utf-8"))["corpora"]
    assert corpora["presentation_core_text"] == "presentation-core-text/manifest.json"


def test_banner_states_are_the_four_the_section_tables():
    rows = re.findall(r"\| ([a-z ]+) \| `([a-z]+)` \| `([^`]+)` \|", _section_6_2())
    assert {verify: words for _, verify, words in rows} == CORE["banner"]
    assert CORE["banner"]["checking"] == "Checking…"
    assert "..." not in CORE["banner"]["checking"]
    assert "’" not in CORE["banner"]["unable"]


@pytest.mark.parametrize("line", _section_lines())
def test_every_fixed_string_is_quoted_by_the_section(line: str):
    assert line in _section_6_2(), line


def test_kept_lines_are_the_documents_own():
    document = _flat(SPEC.read_text(encoding="utf-8"))
    assert CORE["refusal_unverified_bundle"] in document
    for heading in CORE["check_list_headings"].values():
        assert f"**{heading}.**" in document


def test_lines_follow_the_word_rules():
    for check, line in CORE["check_lines"].items():
        assert line.startswith("Whether "), check
        assert "verified" not in line.lower(), check
    for line in _all_lines():
        lower = line.lower()
        assert "identity" not in lower and "freshness" not in lower, line
        assert "[]" not in line and "{}" not in line, line
        assert not re.search(r"\b[a-z]+_[a-z_]+\b", line), line


def test_banner_note_forms():
    template = CORE["banner_note_uncheckpointed"]["template"]
    assert f"`{template}`" in _section_6_2()
    for case in CORE["banner_note_uncheckpointed"]["cases"]:
        n, m = case["n"], case["m"]
        expected = (template.replace("<n>", str(n)).replace("<m>", str(m))
                    .replace(" records ", " record " if m == 1 else " records ")
                    .replace(" are ", " is " if n == 1 else " are "))
        assert case["line"] == expected


def test_goldens_cover_the_reached_states_and_unable_is_never_failed():
    by_id = {c["id"]: c for c in STATES["cases"]}
    assert {c["expect"]["data_verify"] for c in by_id.values()} == {"verified", "failed", "unable"}
    for case in by_id.values():
        state = case["expect"]["data_verify"]
        assert case["expect"]["banner"] == CORE["banner"][state], case["id"]
        assert state not in case["never"]["data_verify"], case["id"]
    unable = by_id["unable"]
    assert unable["digest"] == "none"
    assert "failed" in unable["never"]["data_verify"]
    assert "unverified-bundle" in unable["never"]["data_refusal"]
    assert CORE["banner"]["failed"] in unable["never"]["text"]
    assert by_id["failed"]["expect"]["refusal"] == "unverified-bundle"
    assert by_id["verified-uncheckpointed"]["expect"]["banner_note"] in [
        c["line"] for c in CORE["banner_note_uncheckpointed"]["cases"]
    ]
    assert [p["state"] for p in STATES["pending"]] == ["checking"]


def test_golden_bundles_exist():
    for case in STATES["cases"]:
        source = json.loads((ROOT / "vectors" / case["bundle"]["file"]).read_text(encoding="utf-8"))
        assert case["bundle"]["case"] in [c["name"] for c in source["cases"]], case["id"]


def test_pack_cases_refuse_exactly_the_core_keys():
    assert {c["refused"] for c in REFUSALS["packs"]} == {True, False}
    for case in REFUSALS["packs"]:
        has_core_key = any(key.startswith("core.") for key in case["pack"]["entries"])
        assert case["refused"] == has_core_key == (not case["schema_valid"]), case["id"]


def test_module_cases_refuse_every_write_to_the_core_text():
    kept = {c["id"] for c in REFUSALS["modules"] if not c["refused"]}
    assert kept == {"own-content-only", "chrome-class-through-host"}
    kinds = {c["action"]["kind"] for c in REFUSALS["modules"] if c["refused"]}
    assert kinds == {"set-banner-text", "set-banner-data", "set-banner-class",
                     "remove-banner", "append", "set-banner-note-text"}
    states = {c["id"] for c in STATES["cases"]}
    for case in REFUSALS["modules"]:
        assert case.get("state", "verified") in states, case["id"]
