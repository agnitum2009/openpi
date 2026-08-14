#!/usr/bin/env node
/**
 * Patch pi-lens tool descriptions for token efficiency.
 *
 * pi-lens loads in-process (pi.extensions -> dist/index.js) and registers
 * 14 tools. In-process baseline (runtime loader probe): 12,912 chars of
 * tool descriptions per round. This script compresses the descriptions in
 * dist/index.js only — the surface the pi runtime actually registers.
 *
 * Compressed descriptions KEEP: WHEN/selection triggers, mode semantics,
 * safety contracts (executeCommand allowlist, dry-run defaults, suppress
 * comment + rule requirement, read-guard semantics), param names and the
 * op/mode contracts that the parameter schemas do NOT already carry.
 * Parameter schemas, promptSnippet and promptGuidelines are NOT touched
 * (schemas + behavioral guidelines are must-keep per adversarial eval).
 *
 * pi update --all reinstalls the package and wipes the patch — re-run this
 * script afterwards (same replay pattern as reapply-kernel-resume-patch).
 * Backups: dist/index.js.bak-tool-descriptions.
 *
 * Usage: node scripts/patch-lens-descriptions.mjs [--check]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.env.HOME ?? "", ".pi/agent/npm/node_modules/pi-lens");
const TARGETS = [join(ROOT, "dist/index.js")];

// Compressed descriptions — plain text only: no ${} placeholders, no backticks.
const DESCRIPTIONS = {
  lsp_navigation: [
    "Navigate code using LSP (Language Server Protocol). LSP is enabled by default; disable with --no-lsp.",
    "",
    "Operations — full list in the operation param:",
    "- typeDefinition: definition of a symbol's TYPE",
    "- declaration: extern/forward declaration (distinct from definition)",
    "- findSymbol: document symbols in a file (kind/top-level/exact filters)",
    "- workspaceSymbol: symbols across the project",
    "- rename_file: preview/apply LSP-aware file rename",
    "- prepareCallHierarchy: callable item at position (feeds incoming/outgoingCalls)",
    "- incomingCalls: callers of this; outgoingCalls: functions/methods CALLED by this",
    "- executeCommand: server-advertised command (HARDENED: allowlisted; dry-run by default — apply:true to run)",
    "",
    "Line/character are 1-based; pass symbol for auto column resolution, symbol#N for the Nth occurrence.",
  ].join("\n"),

  lens_diagnostics: [
    "Query pi-lens's diagnostic state. mode=delta/all are cache-only and instant; mode=full is an expensive active project-wide LSP scan merged with cached runner state.",
    "",
    "IMPORTANT: unlike lsp_diagnostics (LSP only), this covers ALL dispatch runners: LSP, tree-sitter rules, ast-grep security rules, biome/ruff/eslint lint, complexity, and more.",
    "",
    "mode=delta (default): current turn's warnings — fixable + code quality/style/complexity (actionable-warnings + code-quality-warnings caches).",
    "",
    "mode=all: blocking errors and warnings with actual messages (line, rule, text) for every file EDITED this session. Unedited files with pre-existing errors do NOT appear — not a full project scan. Use before declaring work done; stale blocking errors from earlier turns remain visible.",
    "",
    "mode=full: EXPENSIVE active scan — project-wide LSP diagnostics (including unedited files), merged/deduplicated with mode=all cached state. refreshRunners=cheap/all/cached triggers a FRESH run of the heavyweight analyzers (see param); de-duped against concurrent runs, bounded by trivy ~180s.",
  ].join("\n"),

  module_report: [
    "Structured, navigable overview of a source module — token-efficient substitute for a whole-file read. Returns each symbol's name/kind/signature/line-range (+ first-line doc summary when attached), inline callbacks/closures/lambdas with stable handles, who-uses-this, risk flags, and ranked recommendedReads. To read a symbol's body: read/read_symbol with offset=startLine, limit=endLine-startLine+1 on THIS report's path. Prefer this before a full read.",
    "",
    "Degrades to outline-only without a cached graph; semantic.source reports whether graph data was used.",
    "",
    "blastRadius:true adds the cross-file blast radius — transitive dependents as ranked read args ('change this → verify these files'). Read-only over the cached graph; omitted on a cold cache.",
    "",
    "view='compact' returns a line-oriented rendering instead of JSON — same data, ~quarter of the token cost. An outline shows shape, not bodies — it does NOT count as having read a symbol's body for editing; use read_symbol for that.",
  ].join("\n"),

  project_report: [
    "Project-level orientation from the review graph — 'orient me in this project' before drilling in. Funnel: project_report → module_report → read_symbol.",
    "",
    "Six capped, ranked sections: trust header (graph freshness, coverage, edge mix); hubs (top fan-in files — contract surface); entry points (near-zero fan-in / high fan-out — activation/CLI/mains); subsystem map (import cycles + layering violations); risk hotspots (fan-in × max per-symbol cyclomatic complexity); suspected dead weight (zero-importer files, low-confidence — dynamic imports/runtime registration/test-only reachability produce false positives). Every file line carries a suggestedNext module_report call. Structural facts only. Read-only over the cached graph: available:false with a retry hint on a cold cache; kicks off a background build (never blocks).",
    "",
    "view='compact' returns a line-oriented rendering instead of JSON (cheapest). Pass focus to re-rank sections toward a task hint (does not expand scope).",
  ].join("\n"),

  symbol_search: [
    "Ranked identifier search over the persisted word index (BM25 + priors demoting tests/vendor/docs) — 'which files are most relevant to <query>' by identifier. Funnel: symbol_search → module_report → read_symbol. Each hit's startLine/endLine mark its best-matching line (offset=startLine, limit=endLine-startLine+1 for a one-line peek); use module_report on file for the real outline. Returns available:false with a retry hint if the index isn't built yet — self-builds in the background (never blocks this call).",
  ].join("\n"),

  read_symbol: [
    "Verbatim source of a single named symbol or module_report callback handle — a targeted, cheap alternative to a whole-file read. Pair with module_report: module_report finds the symbol/callback handle, read_symbol shows its body. Unlike an outline, this delivers the actual lines, so it counts as having read that symbol for the read-before-edit guard. Includes an attached doc comment. Accepts a dotted Class.method name, falling back to a plain top-level lookup when the qualifier doesn't resolve. A miss embeds the ~3 nearest symbol names in the file so a typo self-corrects without a second call. When multiple same-file symbols share a name (overloads), the first is returned with an ambiguous note; pass kind to pick a specific one.",
  ].join("\n"),

  read_enclosing: [
    "Verbatim source of the smallest useful symbol/callback enclosing a line in a file. Use after ast_grep_search/diagnostics/LSP locations for exact body text without a whole-file read. Tree-sitter only (no LSP or graph build); records read-guard coverage.",
  ].join("\n"),

  ast_grep_search: [
    "Search code using AST-aware pattern matching. IMPORTANT: use specific AST patterns, NOT text search.",
    "",
    "GOOD patterns (single AST node): function $NAME() { $$$BODY }; fetchMetrics($ARGS); import { $NAMES } from '$PATH'; console.log($MSG)",
    "BAD patterns (multiple nodes / raw text): missing parens (use it($TEST)); incomplete code; arbitrary text without code structure",
    "",
    "Prefer specific patterns with context over bare identifiers. Use 'paths' to scope to specific files/folders. Avoid 'selector' unless you know the exact AST node kind (it narrows search roots, doesn't extract fields). Use 'context' to show surrounding lines. If zero matches: retry once with a simpler AST pattern, then ast_grep_dump a representative snippet, then grep.",
  ].join("\n"),

  ast_grep_replace: [
    "Replace code using AST-aware pattern matching. IMPORTANT: use specific AST patterns, not text. Dry-run by default (apply=true to apply).",
    "",
    "GOOD: pattern='console.log($MSG)' rewrite='logger.info($MSG)'; pattern='var $X' rewrite='let $X'; pattern='function $NAME() { }' rewrite='' (delete)",
    "BAD (will error): raw text without code structure; missing parentheses (it($TEST), not it'text'); incomplete code fragments",
    "",
    "Use 'paths' to scope to specific files/folders.",
  ].join("\n"),

  ast_grep_outline: [
    "Syntax-only code structure (symbols, imports, exports, members) via ast-grep outline. Fast, local, no index/LSP/cross-file semantics — useful where pi-lens's extractor is weak, or for a raw second opinion.",
    "",
    "Prefer module_report for pi-lens-aware navigation (who-uses-this, blast radius).",
    "",
    "Returns JSON: per file, items[] with name/symbolType/signature/range, isExported/isImport, nested members[] (with isPublic), ready read args on every entry. NOTE: structure only — an outline is NOT a read of a symbol's body (use read_symbol/read_enclosing).",
  ].join("\n"),

  lsp_diagnostics: [
    "Get errors, warnings, and hints from language servers for a file or directory. Use BEFORE builds to proactively check for issues. Directories: auto-detects file extensions, scans matching files.",
  ].join("\n"),

  lens_diagnostic_mark: [
    "Record a disposition for a lens_diagnostics finding, using the exact filePath/rule/message/line it was reported with. false-positive/suppress persist across sessions; defer lasts only for the current session (resurfaces next time); flagged marks it for you to fix and shows up tagged in a later mode=full. suppress additionally writes a pi-lens-ignore: <rule> comment into the source above the flagged line — rule is required for suppress. The line is verified/reanchored against current diagnostics: a live diagnostic at a different line overrides the one you passed. When suppressing several findings in the SAME file in one turn, work bottom-up (highest line first) — each inserted comment shifts later lines down.",
  ].join("\n"),
};

// ast_grep_dump: its factory takes the tool name as a variable (name: name),
// so it needs a function anchor instead of a name anchor.
const DUMP_DESCRIPTION =
  "Dump the tree-sitter AST for a source snippet using ast-grep CLI. Use when ast_grep_search finds no matches and you need exact node kinds/field names/nesting. Named nodes only by default; includeAnonymous=true adds punctuation/CST nodes.";

// pi_lens_activate_tools: its description is a template with a catalog
// interpolation — compress the intro and the catalog summaries, keep ${catalog}.
const ACTIVATE_INTRO =
  "Activate situational pi-lens tools that stay registered but inactive by default (keeps the default tool list lean). Call ONCE with the tools you need — they become callable starting the NEXT turn. Available:\n";
const ACTIVATE_CATALOG_TAIL = "${catalog}";

// LAZY_TOOL_CATALOG summaries (shown in pi_lens_activate_tools's description).
// froms = every historical variant (replay-safe across tightening passes).
const CATALOG_REPLACEMENTS = [
  {
    froms: [
      "AST-aware structural code search across ~40 languages (ast-grep patterns).",
    ],
    to: "AST structural code search (~40 languages).",
  },
  {
    froms: ["AST-aware structural code rewrite/refactor (ast-grep patterns)."],
    to: "AST structural code rewrite/refactor.",
  },
  {
    froms: [
      "Syntax-only file/dir structure (symbols/imports/exports/members) via ast-grep outline \\u2014 no index/LSP.",
      "Syntax-only file/dir structure (symbols/imports/exports/members), no index/LSP.",
    ],
    to: "Syntax-only file/dir structure (symbols/imports/exports/members).",
  },
  {
    froms: [
      "Dump the tree-sitter AST for a source snippet to discover node kinds/field names.",
    ],
    to: "Dump tree-sitter AST of a snippet to discover node kinds/fields.",
  },
  {
    froms: [
      "IDE-style LSP navigation: definition, references, implementation, rename, call hierarchy.",
    ],
    to: "LSP navigation: definition, references, implementation, rename, call hierarchy.",
  },
  {
    froms: [
      "Record a disposition for a diagnostic: false-positive / suppress (inline ignore comment) / defer (this session) / flagged (to fix).",
      "Disposition for a diagnostic: false-positive / suppress (inline ignore comment) / defer (session) / flagged (to fix).",
      "Diagnostic disposition: false-positive / suppress (inline ignore comment) / defer (session) / flagged (to fix).",
    ],
    to: "Disposition: false-positive / suppress (inline ignore comment) / defer (session) / flagged (to fix).",
  },
];

const check = process.argv.includes("--check");

function assertPlain(text, label) {
  if (
    text.includes(String.fromCharCode(36) + "{") ||
    text.includes(String.fromCharCode(96))
  ) {
    throw new Error(
      "NEW description for " +
        label +
        " contains ${} or a backtick — keep it plain text.",
    );
  }
}

function findStringEnd(source, quote, from, terminator) {
  let i = from;
  for (;;) {
    const end = source.indexOf(quote, i);
    if (end < 0) return undefined;
    if (source[end - 1] !== "\\" && source[end + 1] === terminator) return end;
    i = end + 1;
  }
}

function findJsonStringEnd(source, from) {
  let i = from;
  for (;;) {
    const end = source.indexOf('"', i);
    if (end < 0) return undefined;
    let bs = 0;
    for (let k = end - 1; k >= from && source[k] === "\\"; k--) bs++;
    if (bs % 2 === 0 && source[end + 1] === ",") return end;
    i = end + 1;
  }
}

// First description inside a given factory function.
function locateInFactory(source, factoryName) {
  const fnAt = source.indexOf("function " + factoryName);
  if (fnAt < 0) return undefined;
  const d = /description:\s*([\x60"'])/.exec(source.slice(fnAt, fnAt + 600));
  if (!d) return undefined;
  const quote = d[1];
  const start = fnAt + d.index + d[0].length;
  const end =
    quote === '"'
      ? findJsonStringEnd(source, start)
      : findStringEnd(source, quote, start, ",");
  if (end === undefined) return undefined;
  return { start, end, quote };
}

// Locate the factory description of one tool: find 'name: "tool"', then the
// first description: within the next 400 chars. Tries later name occurrences
// if the first one has no adjacent description.
function locateTool(source, toolName) {
  const re = new RegExp('name:\\s*"' + toolName + '"', "g");
  let m;
  while ((m = re.exec(source)) !== null) {
    const region = source.slice(m.index, m.index + 400);
    const d = /description:\s*([\x60"'])/.exec(region);
    if (!d) continue;
    const quote = d[1];
    const start = m.index + d.index + d[0].length;
    const end =
      quote === '"'
        ? findJsonStringEnd(source, start)
        : findStringEnd(source, quote, start, ",");
    if (end === undefined) continue;
    return { start, end, quote };
  }
  return undefined;
}

function renderDescription(text, quote) {
  if (quote === '"') {
    return text
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n");
  }
  if (quote === "'") {
    return text
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "\\'")
      .replace(/\n/g, "\\n");
  }
  return text; // template literal: plain text, backticks already rejected
}

function unescapeJson(raw) {
  try {
    return JSON.parse('"' + raw + '"');
  } catch {
    return raw;
  }
}

try {
  for (const [label, text] of Object.entries(DESCRIPTIONS))
    assertPlain(text, label);
  assertPlain(DUMP_DESCRIPTION, "ast_grep_dump");
  assertPlain(ACTIVATE_INTRO, "pi_lens_activate_tools intro");
  for (const r of CATALOG_REPLACEMENTS) assertPlain(r.to, "catalog summary");

  let allApplied = true;
  let anyLocated = false;
  let changed = false;

  for (const target of TARGETS) {
    if (!existsSync(target)) {
      console.error("Missing target file: " + target);
      allApplied = false;
      continue;
    }
    const source = readFileSync(target, "utf8");
    const basename = target.split("/").pop();
    anyLocated = true;

    // Catalog summary replacements (exact text; froms = historical variants).
    const catStates = CATALOG_REPLACEMENTS.map((r) => ({
      ...r,
      applied: source.includes(r.to),
    }));
    for (const r of catStates) if (!r.applied) allApplied = false;
    const missingCat = catStates.find(
      (r) => !r.applied && !r.froms.some((f) => source.includes(f)),
    );
    if (missingCat) {
      console.error(
        "[!] catalog summary not found: " +
          missingCat.to.slice(0, 40) +
          " — layout changed; re-derive manually.",
      );
      allApplied = false;
      continue;
    }

    // Template-block anchors (static tools + dump + activate).
    const anchors = Object.entries(DESCRIPTIONS).map(([tool, text]) => ({
      tool,
      text,
      found: locateTool(source, tool),
    }));
    anchors.push({
      tool: "ast_grep_dump",
      text: DUMP_DESCRIPTION,
      found: locateInFactory(source, "createAstDumpToolWithName"),
    });
    anchors.push({
      tool: "pi_lens_activate_tools",
      text: ACTIVATE_INTRO + ACTIVATE_CATALOG_TAIL,
      found: locateInFactory(source, "createActivateToolsTool"),
    });

    const missing = anchors.filter((a) => !a.found);
    if (missing.length > 0) {
      console.error(
        "[!] not located: " +
          missing.map((m) => m.tool).join(", ") +
          " — layout changed; re-derive manually.",
      );
      allApplied = false;
      continue;
    }

    const blocksApplied = anchors.every(
      (a) =>
        source.slice(a.found.start, a.found.end) ===
        renderDescription(a.text, a.found.quote),
    );
    if (!blocksApplied) allApplied = false;
    if (blocksApplied && catStates.every((r) => r.applied)) continue;

    const backupPath = target + ".bak-tool-descriptions";
    if (!existsSync(backupPath)) writeFileSync(backupPath, source, "utf8");

    // Single descending-position pass over ALL edits (anchors + text replaces).
    const edits = [];
    for (const { tool, found, text } of anchors) {
      const before =
        found.quote === '"'
          ? unescapeJson(source.slice(found.start, found.end)).length
          : found.end - found.start;
      edits.push({
        label: tool,
        start: found.start,
        end: found.end,
        replacement: renderDescription(text, found.quote),
        before,
        after: text.length,
      });
    }
    for (const r of catStates) {
      if (r.applied) continue;
      const from = r.froms.find((f) => source.includes(f));
      if (!from) continue;
      const at = source.indexOf(from);
      if (at >= 0)
        edits.push({
          label: "catalog: " + from.slice(0, 24),
          start: at,
          end: at + from.length,
          replacement: r.to,
          before: from.length,
          after: r.to.length,
        });
    }
    edits.sort((a, b) => b.start - a.start);
    let next = source;
    for (const e of edits) {
      next = next.slice(0, e.start) + e.replacement + next.slice(e.end);
      console.log(
        "  [" +
          basename +
          "] " +
          e.label.padEnd(26) +
          " " +
          String(e.before).padStart(5) +
          " -> " +
          String(e.after).padStart(5) +
          " chars (-" +
          (e.before - e.after) +
          ", -" +
          Math.round(((e.before - e.after) / e.before) * 100) +
          "%)",
      );
    }
    writeFileSync(target, next, "utf8");
    changed = true;
  }

  if (!anyLocated) {
    console.error(
      "No pi-lens target files found — check the extension install path.",
    );
    process.exit(1);
  }
  if (check) {
    if (allApplied) {
      console.log("Patch already applied ✓");
      process.exit(0);
    }
    console.error(
      "Patch NOT applied — run: node scripts/patch-lens-descriptions.mjs",
    );
    process.exit(1);
  }
  if (!allApplied && !changed) {
    console.error(
      "Some description blocks were not located — the extension layout changed; re-derive manually.",
    );
    process.exit(1);
  }
  console.log(
    "pi-lens descriptions patched ✓ (backup: dist/index.js.bak-tool-descriptions)",
  );
} catch (error) {
  console.error(
    "Failed: " + (error instanceof Error ? error.message : String(error)),
  );
  process.exit(1);
}
