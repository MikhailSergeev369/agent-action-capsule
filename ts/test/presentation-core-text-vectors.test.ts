// @vitest-environment jsdom

// The core's fixed text against vectors/presentation-core-text (presentation
// contract section 6.2): every string the corpus fixes is the string this
// runtime draws, each state golden renders as the corpus says (and `unable`
// never as `failed`), a wording pack that carries a reserved `core.` key is
// refused, and a module that writes the banner or the check lists during its
// render collapses the page to the presentation-failed refusal.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyBundle } from "../src/bundle.js";
import {
  CHECKPOINT_COVERAGE_LINE,
  UNABLE_TO_VERIFY_LINES,
  VERIFICATION_BANNER,
  WORDING_PACK_REFUSED,
  renderEvidenceGraph,
  uncheckpointedLine,
} from "../src/evidence-graph-view.js";
import { jcs, setSha256FallbackForTesting } from "../src/json.js";
import {
  PresentationRegistry,
  type PresentationManifest,
  type PresentationModule,
} from "../src/presentation-registry.js";
import {
  buildVerificationPageModel,
  CHECK_RESULT_WORDS,
  CHECK_ROWS_HEADING,
  CHECKED_ON_THIS_PAGE,
  CHECKPOINT_NOT_CHECKED_NOTE,
  CHECKS_SCOPE_LINE,
  EXTENSION_INTERPRETED,
  EXTENSION_NOT_INTERPRETED,
  EXTENSION_SHOWN_BY_MODULE,
  FAILED_ON_THIS_PAGE,
  FULL_VERIFIER_LINE,
  NOT_CHECKED_ON_THIS_PAGE,
  TECHNICAL_NAME,
  VERIFICATION_CHECK_WORDS,
} from "../src/verification-page.js";

type Obj = Record<string, unknown>;

const VECTORS = resolve(process.cwd(), "..", "vectors");
const read = (...path: string[]): Obj =>
  JSON.parse(readFileSync(resolve(VECTORS, ...path), "utf8")) as Obj;

interface CoreText {
  banner: Record<"checking" | "verified" | "failed" | "unable", string>;
  banner_note_uncheckpointed: {
    cases: { n: number; m: number; line: string }[];
  };
  refusal_unverified_bundle: string;
  unable: { reason: string; command: string; no_command: string };
  check_list_headings: { page: string; failed: string; not_checked: string };
  check_lines: Record<string, string>;
  checkpoint_not_checked_note: string;
  full_verifier_line: string;
  scope_line: string;
  check_rows: {
    heading: string;
    technical_summary: string;
    rows: { line: string; technical: string }[];
    results: Record<string, string>;
  };
  empty_value: string;
  coverage_line: { not_established: string; withheld: string };
  extension_meaning: {
    interpreted: string;
    module_content: string;
    not_interpreted: string;
  };
  wording_pack_refused: string;
}

interface StateCase {
  id: string;
  bundle: { file: string; case: string };
  patch: { op: string; path: string; value: unknown }[];
  digest: "available" | "none";
  expect: {
    data_verify: string;
    banner: string;
    data_uncheckpointed: string | null;
    banner_note: string | null;
    refusal: string | null;
  };
  never: { data_verify: string[]; data_refusal: string[]; text?: string[] };
}

interface ModuleAction {
  kind: string;
  tag?: string;
  text?: string;
  data?: Record<string, string>;
  name?: string;
  value?: string;
}

const CORE = read(
  "presentation-core-text",
  "core-text.json",
) as unknown as CoreText;
const STATES = read("presentation-core-text", "states.json") as unknown as {
  cases: StateCase[];
  pending: { state: string; banner: string }[];
};
const REFUSALS = read("presentation-core-text", "refusals.json") as unknown as {
  packs: { id: string; pack: Obj; refused: boolean }[];
  modules: {
    id: string;
    state?: string;
    action: ModuleAction;
    refused: boolean;
  }[];
};

// RFC 6902, the one operation the corpus uses; any other is loud.
function patched(bundle: unknown, patch: StateCase["patch"]): unknown {
  const copy = structuredClone(bundle) as Obj;
  for (const op of patch) {
    if (op.op !== "replace") throw new Error(`unsupported patch op ${op.op}`);
    const keys = op.path.split("/").slice(1);
    const last = keys.pop()!;
    let at = copy;
    for (const key of keys) at = at[key] as Obj;
    if (!(last in at))
      throw new Error(`replace of a missing member ${op.path}`);
    at[last] = op.value;
  }
  return copy;
}

const stateCase = (id: string): StateCase =>
  STATES.cases.find((c) => c.id === id)!;

function goldenBundle(c: StateCase): unknown {
  const source = read(c.bundle.file) as { cases: Obj[] };
  const found = source.cases.find((x) => x.name === c.bundle.case);
  if (found === undefined) throw new Error(`no case ${c.bundle.case}`);
  return patched(found.bundle, c.patch);
}

afterEach(() => {
  vi.unstubAllGlobals();
  setSha256FallbackForTesting(true);
});

describe("the core's strings are the corpus's", () => {
  it("banner, the line under it and the unable lines", () => {
    expect(VERIFICATION_BANNER).toEqual(CORE.banner);
    expect(VERIFICATION_BANNER.checking).toBe("Checking…");
    expect([...STATES.pending.map((p) => p.banner)]).toEqual([
      VERIFICATION_BANNER.checking,
    ]);
    for (const { n, m, line } of CORE.banner_note_uncheckpointed.cases)
      expect(uncheckpointedLine(n, m)).toBe(line);
    expect(UNABLE_TO_VERIFY_LINES).toEqual({
      banner: CORE.banner.unable,
      reason: CORE.unable.reason,
      command: CORE.unable.command,
      noCommand: CORE.unable.no_command,
    });
  });

  it("the check lists and the lines around them", () => {
    expect({
      page: CHECKED_ON_THIS_PAGE,
      failed: FAILED_ON_THIS_PAGE,
      not_checked: NOT_CHECKED_ON_THIS_PAGE,
    }).toEqual(CORE.check_list_headings);
    expect(VERIFICATION_CHECK_WORDS).toEqual(CORE.check_lines);
    expect(CHECKPOINT_NOT_CHECKED_NOTE).toBe(CORE.checkpoint_not_checked_note);
    expect(FULL_VERIFIER_LINE).toBe(CORE.full_verifier_line);
    expect(CHECKS_SCOPE_LINE).toBe(CORE.scope_line);
  });

  it("the one-by-one checks, their technical names and results", async () => {
    const bundle = goldenBundle(stateCase("verified"));
    const model = buildVerificationPageModel(
      bundle,
      await verifyBundle(bundle),
    );
    expect(
      model.checks.map((c) => ({ line: c.name, technical: c.technical })),
    ).toEqual(CORE.check_rows.rows);
    expect(CHECK_ROWS_HEADING).toBe(CORE.check_rows.heading);
    expect(TECHNICAL_NAME).toBe(CORE.check_rows.technical_summary);
    expect(CHECK_RESULT_WORDS).toEqual(CORE.check_rows.results);
  });

  it("coverage, extension and wording-pack lines", () => {
    expect(CHECKPOINT_COVERAGE_LINE).toEqual(CORE.coverage_line);
    expect({
      interpreted: EXTENSION_INTERPRETED,
      module_content: EXTENSION_SHOWN_BY_MODULE,
      not_interpreted: EXTENSION_NOT_INTERPRETED,
    }).toEqual(CORE.extension_meaning);
    expect(WORDING_PACK_REFUSED).toBe(CORE.wording_pack_refused);
  });
});

async function renderState(c: StateCase): Promise<HTMLElement> {
  const bundle = goldenBundle(c);
  if (c.digest === "none") {
    vi.stubGlobal("crypto", undefined);
    setSha256FallbackForTesting(false);
  }
  const root = document.createElement("main");
  await renderEvidenceGraph(bundle, root);
  return root;
}

describe("state goldens", () => {
  it.each(STATES.cases.map((c) => [c.id, c] as const))("%s", async (_id, c) => {
    const root = await renderState(c);
    const banners = root.querySelectorAll<HTMLElement>("[data-verify]");
    expect(banners).toHaveLength(1);
    const banner = banners[0]!;
    expect(banner.textContent).toBe(c.expect.banner);
    expect(banner.dataset.verify).toBe(c.expect.data_verify);
    expect(banner.dataset.uncheckpointed ?? null).toBe(
      c.expect.data_uncheckpointed,
    );
    expect(
      root.querySelector('[data-banner-note="uncheckpointed"]')?.textContent ??
        null,
    ).toBe(c.expect.banner_note);
    const refusals = [
      ...root.querySelectorAll<HTMLElement>("[data-refusal]"),
    ].map((e) => e.dataset.refusal);
    expect(refusals).toEqual(
      c.expect.refusal === null ? [] : [c.expect.refusal],
    );
    for (const verify of c.never.data_verify)
      expect(root.querySelector(`[data-verify="${verify}"]`)).toBeNull();
    for (const refusal of c.never.data_refusal)
      expect(root.querySelector(`[data-refusal="${refusal}"]`)).toBeNull();
    for (const text of c.never.text ?? [])
      expect(root.textContent).not.toContain(text);
    if (c.expect.refusal === "unverified-bundle")
      expect(root.textContent).toContain(CORE.refusal_unverified_bundle);
    if (c.expect.data_verify === "unable")
      expect(banner.className).not.toMatch(/failed/u);
  });

  it("an empty list on the verification page reads none, never []", async () => {
    const root = await renderState(stateCase("verified"));
    const page = root.querySelector('[data-page="verification"]')!;
    const label = [...page.querySelectorAll("dt")].find(
      (dt) => dt.textContent === "suppressed fields",
    )!;
    expect(label.nextElementSibling?.textContent).toBe(CORE.empty_value);
    expect(page.textContent).not.toContain("[]");
  });
});

const packInput = (pack: Obj): { pack: string; sha256: string } => {
  const text = new TextDecoder().decode(jcs(pack));
  return {
    pack: text,
    sha256: createHash("sha256").update(text, "utf8").digest("hex"),
  };
};

describe("a wording pack cannot supply the core's text", () => {
  it.each(REFUSALS.packs.map((c) => [c.id, c] as const))(
    "%s",
    async (_id, c) => {
      const root = document.createElement("main");
      await renderEvidenceGraph(
        goldenBundle(stateCase("verified")),
        root,
        undefined,
        {
          wording: packInput(c.pack),
        },
      );
      const line = root.querySelector<HTMLElement>(
        '[data-refusal="wording-pack-core-key"]',
      );
      if (c.refused) expect(line?.textContent).toBe(CORE.wording_pack_refused);
      else expect(line).toBeNull();
      // Either way the banner is the core's.
      expect(root.querySelector("[data-verify]")?.textContent).toBe(
        CORE.banner.verified,
      );
    },
  );
});

// The corpus's module actions; a case naming any other kind is a corpus
// error, never a refusal.
const ACTION_KINDS = [
  "append",
  "set-chrome-class",
  "set-banner-text",
  "set-banner-data",
  "set-banner-class",
  "remove-banner",
  "set-banner-note-text",
];

// A fallback page module that matches any verified evidence-bundle/v2 and
// performs one corpus action on the page during its render.
function actingModule(action: ModuleAction): PresentationModule {
  const manifest = {
    spec_version: "aac.presentation-manifest/v0",
    id: "org.example.acting-view/v0",
    presentation_api: "aac.presentation-api/v0",
    runtime_min: "0.1.0",
    trust_class: "trusted-executable",
    requires: { bundle_kind: "evidence-bundle/v2" },
    audiences: ["*"],
    formats: ["html", "fragment", "embedded"],
    fallback: true,
    executable: { carrier: "module-slot", script_sha256: "0".repeat(64) },
  } as PresentationManifest;
  return {
    manifest,
    canRender: () => true,
    buildModel: () => ({}),
    render: (_model, host) => {
      const banner = host.L0.querySelector<HTMLElement>("[data-verify]")!;
      const own = document.createElement("p");
      own.dataset.actingModule = "";
      own.textContent = "module content";
      host.L1.append(own);
      switch (action.kind) {
        case "append": {
          const el = document.createElement(action.tag!);
          el.textContent = action.text!;
          for (const [k, v] of Object.entries(action.data ?? {}))
            el.dataset[k] = v;
          host.L1.append(el);
          return;
        }
        case "set-chrome-class":
          host.setChromeClass("oi");
          return;
        case "set-banner-text":
          banner.textContent = action.text!;
          return;
        case "set-banner-data":
          banner.dataset[action.name!] = action.value!;
          return;
        case "set-banner-class":
          banner.className = action.value!;
          return;
        case "remove-banner":
          banner.remove();
          return;
        case "set-banner-note-text":
          host.L0.querySelector("[data-banner-note]")!.textContent =
            action.text!;
          return;
        default:
          throw new Error(`unknown corpus action ${action.kind}`);
      }
    },
  };
}

describe("a module cannot write the core's text", () => {
  it.each(REFUSALS.modules.map((c) => [c.id, c] as const))(
    "%s",
    async (_id, c) => {
      expect(ACTION_KINDS).toContain(c.action.kind);
      const registry = new PresentationRegistry();
      registry.register(actingModule(c.action));
      const root = document.createElement("main");
      await renderEvidenceGraph(
        goldenBundle(stateCase(c.state ?? "verified")),
        root,
        undefined,
        { registry },
      );
      const banners = root.querySelectorAll<HTMLElement>("[data-verify]");
      expect(banners).toHaveLength(1);
      expect(banners[0]!.textContent).toBe(CORE.banner.verified);
      expect(banners[0]!.dataset.verify).toBe("verified");
      const failed = root.querySelector('[data-refusal="presentation-failed"]');
      if (c.refused) {
        expect(failed).not.toBeNull();
        expect(root.querySelector("[data-acting-module]")).toBeNull();
        expect(banners[0]!.className).toBe("");
      } else {
        expect(failed).toBeNull();
        expect(root.querySelector("[data-acting-module]")).not.toBeNull();
      }
      if (c.action.kind === "set-chrome-class")
        expect(banners[0]!.className).toBe("oi oi-banner oi-banner-ok");
      const golden = stateCase(c.state ?? "verified");
      expect(
        root.querySelector('[data-banner-note="uncheckpointed"]')
          ?.textContent ?? null,
      ).toBe(golden.expect.banner_note);
    },
  );

  it("a section module that writes the banner is refused the same way", async () => {
    const sections = new PresentationRegistry();
    sections.register(actingModule({ kind: "set-banner-text", text: "Fine" }));
    const root = document.createElement("main");
    await renderEvidenceGraph(
      goldenBundle(stateCase("verified")),
      root,
      undefined,
      { registry: new PresentationRegistry(), sections },
    );
    expect(
      root.querySelector('[data-refusal="presentation-failed"]'),
    ).not.toBeNull();
    expect(root.querySelector("[data-verify]")?.textContent).toBe(
      CORE.banner.verified,
    );
    expect(root.querySelector("[data-acting-module]")).toBeNull();
  });

  it("a module that removes the wording-pack refusal line is refused", async () => {
    const module = actingModule({ kind: "set-chrome-class" });
    const registry = new PresentationRegistry();
    registry.register({
      ...module,
      render: (_model, host) => {
        host.L0.querySelector(
          '[data-refusal="wording-pack-core-key"]',
        )?.remove();
        const own = document.createElement("p");
        own.dataset.actingModule = "";
        host.L1.append(own);
      },
    });
    const root = document.createElement("main");
    const pack = REFUSALS.packs.find((c) => c.refused)!.pack;
    await renderEvidenceGraph(
      goldenBundle(stateCase("verified")),
      root,
      undefined,
      { registry, wording: packInput(pack) },
    );
    expect(
      root.querySelector('[data-refusal="presentation-failed"]'),
    ).not.toBeNull();
    expect(
      root.querySelector('[data-refusal="wording-pack-core-key"]')?.textContent,
    ).toBe(CORE.wording_pack_refused);
    expect(root.querySelector("[data-acting-module]")).toBeNull();
  });

  it("a change made before setChromeClass is still caught", async () => {
    const module = actingModule({ kind: "set-chrome-class" });
    const render = module.render;
    const registry = new PresentationRegistry();
    registry.register({
      ...module,
      render: (model, host, services) => {
        host.L0.querySelector("[data-verify]")!.textContent = "All good";
        return render(model, host, services);
      },
    });
    const root = document.createElement("main");
    await renderEvidenceGraph(
      goldenBundle(stateCase("verified")),
      root,
      undefined,
      {
        registry,
      },
    );
    expect(
      root.querySelector('[data-refusal="presentation-failed"]'),
    ).not.toBeNull();
    expect(root.querySelector("[data-verify]")?.textContent).toBe(
      CORE.banner.verified,
    );
  });
});

describe("an extension the page's module uses is the module's content", () => {
  it("reads as shown by the module, while one nothing reads reads not interpreted", async () => {
    // An extension kind the core has no reader for, so it is engaged when
    // present and nothing in the core interprets it.
    const kind = "x-example-terms/v1";
    const bundle = {
      ...(goldenBundle(stateCase("verified")) as Obj),
      extensions: { [kind]: { terms: "net 30" } },
    };
    const module = actingModule({ kind: "set-chrome-class" });
    const requiring: PresentationModule = {
      ...module,
      manifest: {
        ...module.manifest,
        id: "org.example.terms-view/v0",
        requires: {
          bundle_kind: "evidence-bundle/v2",
          extensions: { required: [kind] },
        },
      } as PresentationManifest,
      render: () => undefined,
    };
    const meaning = async (registry: PresentationRegistry) => {
      const root = document.createElement("main");
      await renderEvidenceGraph(structuredClone(bundle), root, undefined, {
        registry,
      });
      expect(root.querySelector("[data-verify]")?.textContent).toBe(
        CORE.banner.verified,
      );
      const row = root.querySelector<HTMLElement>(
        `tr[data-extension-id="${kind}"]`,
      )!;
      return [row.lastElementChild?.textContent, row.dataset.shownByModule];
    };
    const registry = new PresentationRegistry();
    registry.register(requiring);
    expect(await meaning(registry)).toEqual([
      CORE.extension_meaning.module_content,
      "",
    ]);
    expect(await meaning(new PresentationRegistry())).toEqual([
      CORE.extension_meaning.not_interpreted,
      undefined,
    ]);
  });
});
