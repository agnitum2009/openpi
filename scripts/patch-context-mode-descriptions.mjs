#!/usr/bin/env node
/**
 * Patch context-mode tool descriptions for token efficiency.
 *
 * Context-mode's LLM tools carry long philosophy passages and EXAMPLE blocks
 * (~17k chars ~= 4.3k tokens/round). This script replaces them with
 * compressed equivalents that KEEP: trigger conditions (WHEN), safety
 * contracts (sandbox boundaries, purge confirmation), parameter schemas,
 * env-var names, and cache/TTL semantics. Only philosophy/examples/verbosity
 * are cut.
 *
 * Two targets: `server.bundle.mjs` (what the pi MCP bridge spawns) and
 * `build/server.js` (source layout). npm updates overwrite both, so re-run
 * after every `pi update --all` — the same replay pattern as
 * scripts/reapply-kernel-resume-patch.mjs. Backups: *.bak-tool-descriptions.
 *
 * Pitfalls handled:
 *  - the minified bundle collapses interpolation-free descriptions into
 *    single-quoted strings with escaped \n, while source layout keeps
 *    backtick templates — both quote styles are detected;
 *  - interpolation placeholders are renamed in the bundle (${vU} etc), so NEW
 *    descriptions are plain text with no ${} placeholders;
 *  - descriptions are matched by structural anchor, not by OLD text.
 *
 * Usage: node scripts/patch-context-mode-descriptions.mjs [--check]
 *   --check  verify whether the patch is applied (exit 0 = applied).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(
  process.env.HOME ?? "",
  ".pi/agent/npm/node_modules/context-mode",
);
const TARGETS = [
  join(ROOT, "server.bundle.mjs"),
  join(ROOT, "build/server.js"),
];

// ── Compressed descriptions (plain text only — no ${} placeholders) ────────
const DESCRIPTIONS = {
  ctx_execute: [
    "Run code in a sandboxed subprocess. Languages: JavaScript, TypeScript, Shell, Python, Perl, Ruby, Go, Rust, PHP, R, Elixir, CSharp.",
    "",
    "Think-in-Code: process data in code; only console.log() output enters your context.",
    "",
    "WHEN:",
    "  - Deriving an answer FROM data (filter/count/aggregate/parse/compare) — compute in code, print only the answer",
    "  - Output shape or size unpredictable (recursive finds, repo-wide greps, log scans, query results)",
    "  - Long-running process: pass `background: true` to detach on timeout instead of killing",
    "  - Large output with recall-by-topic later: pass `intent`; outputs over ~5KB are auto-indexed (titles + previews), retrievable via ctx_search",
    "",
    "WHEN NOT:",
    "  - Single short observational command (whoami, pwd, git status) — Bash is simpler",
    "  - File mutations or navigation (cd/ls) — use Bash/Edit/Write",
    "  - Known short fixed output — read it as-is",
    "",
    "RETURNS:",
    "  Only what your code prints. Wrap risky calls in try/catch (uncaught errors go to stderr). With `intent` over the auto-index threshold you get searchable section titles + previews, not raw stdout; drill in with ctx_search.",
  ].join("\n"),

  ctx_batch_execute: [
    "Run multiple commands in ONE call; output is auto-indexed; pass `queries` for inline matches.",
    "",
    "Concurrency parallelizes the FETCH phase; the DERIVATION phase belongs in code (print only the answer).",
    "",
    "WHEN:",
    "  - 3+ related commands (multi-issue lookups, git log+diff+blame, multi-file reads)",
    "  - Gather AND query in one round trip (pass `queries`)",
    "  - I/O-bound parallel work (pass `concurrency` 2-8)",
    "",
    "WHEN NOT:",
    "  - Single command without follow-up query — sandbox tool directly",
    "  - CPU-bound or stateful commands — keep concurrency at 1 (tests, builds, locks)",
    "",
    "RETURNS:",
    "  Auto-indexed sections per command label plus top matches; raw output not echoed fully. Concurrency>1 gives per-command timeouts; use 4-8 for I/O, 1 for CPU.",
  ].join("\n"),

  ctx_search: [
    "Search a unified knowledge base (BM25) with multi-strategy ranking (stemming + trigram, fused; typos corrected; snippets window-extracted). Covers indexed content AND auto-captured session memory (26 event categories); file sources auto-flag staleness.",
    "",
    "WHEN:",
    "  - Recall something in storage instead of re-reading raw sources",
    "  - Multiple related questions — batch in one call (one round-trip)",
    "  - Scope to one source (pass `source`, partial match ok)",
    '  - Chronological view across sessions (pass `sort: "timeline"`)',
    '  - Filter by content shape (pass `contentType: "code"|"prose"`)',
    "",
    "WHEN NOT:",
    "  - Data never stored and no session memory — capture first (gather-and-index), then query",
    "  - One ad-hoc question against unstored data — answer inline in the sandbox tool",
    "",
    "RETURNS:",
    "  Per-query ranked sections with window-extracted snippets; use 2-4 specific terms per query. Source labels: `decision`, `error`/`error-resolution`, `blocker`, `plan`, `user-prompt`, `rejected-approach`, `compaction`. Throttle counter per response; tune via CONTEXT_MODE_SEARCH_WINDOW_MS / _MAX_RESULTS_AFTER / _BLOCK_AFTER.",
    "",
    'EXAMPLE: ctx_search(queries: ["root cause", "proposed fix"], source: "issue-#683")',
    'EXAMPLE: ctx_search(queries: ["what did we decide about caching"], source: "decision", sort: "timeline")',
  ].join("\n"),
  ctx_fetch_and_index: [
    "Fetches URL content, converts HTML to markdown (JSON chunked by key paths, plain text indexed), persists it searchable, returns a small preview per source. Raw page bytes never enter your conversation.",
    "",
    "Caching: disk-cached within TTL (default 24h; pass `ttl` ms, `ttl: 0` bypasses like `force: true`); content older than 14 days is cleaned on startup.",
    "",
    "WHEN:",
    "  - Web content needed (docs, changelogs, API refs) and raw bytes should not enter context",
    "  - Multi-URL research: pass `requests` array + `concurrency` 2-8 for parallel I/O",
    "  - Repeat lookups: TTL cache hits return only a hint; stable specs: override `ttl` upward",
    "",
    "WHEN NOT:",
    "  - Content already local — store via ctx_index",
    "  - SPA-rendered pages (JS-required) — this is plain HTTP fetch, no headless browser",
    "",
    "RETURNS:",
    "  Per-source preview windows around indexable headings + indexing metadata (chunk counts, source labels, cache state). Raw content NOT echoed — retrieve on-demand via ctx_search(source: ...).",
  ].join("\n"),

  ctx_execute_file: [
    "Read a file into a sandboxed FILE_CONTENT variable and run code over it; only console.log() output enters your conversation, file bytes stay in the sandbox.",
    "",
    "WHEN:",
    "  - Want facts ABOUT a file (line count, pattern matches, parsed structure, aggregates) without seeing all of it",
    "  - Structured file (CSV/JSON/log/code) where code-level derivation is cheaper than reading verbatim",
    "  - Large file that would burn meaningful conversation memory",
    "  - Derivation output large, recall-by-topic later: pass `intent`; outputs over ~5KB auto-indexed (matching sections come back), retrievable via ctx_search",
    "",
    "WHEN NOT:",
    "  - Intending to EDIT the file — use Read so the subsequent Edit matches exact text",
    "  - One specific line with known offset — Read with offset/limit",
    "  - Small file you will consume fully — Read directly",
    "",
    "RETURNS:",
    "  Only what your code prints; FILE_CONTENT holds raw bytes in-sandbox, nothing else leaves. With `intent` over threshold you get matching sections, not full stdout.",
  ].join("\n"),

  ctx_index: [
    "Store content in a searchable knowledge base (BM25 over FTS5); splits markdown by headings, keeps code blocks intact, persists raw chunks. Full content stays in storage — retrieve on-demand via ctx_search; nothing summarized or truncated.",
    "",
    "WHEN:",
    "  - Docs from Context7, Skills, or MCP tools (API docs, framework guides, code examples)",
    "  - API references, MCP tools/list output, skill prompts too large for verbatim context",
    "  - READMEs, migration guides, changelogs; anything with code examples needing precise recall",
    "",
    "WHEN NOT:",
    "  - Logs/test output/CSV/build output — use ctx_execute_file (in-sandbox, no persistence)",
    "  - Single-use ephemeral content — keep inline or ctx_execute_file it",
    "",
    "RETURNS:",
    "  Indexing metadata: chunk counts (total, code-bearing), source label, exact ctx_search call shape. Raw content NOT echoed — lives in storage. With `path`, a content hash is stored so ctx_search auto-flags staleness.",
  ].join("\n"),
};

const check = process.argv.includes("--check");

/** Locate one tool's description value: backtick template (source layout) or
 * single-quoted collapsed string (minified bundle). */
function findDescription(source, tool) {
  const anchor = new RegExp(
    `registerTool\\("${tool}",\\s*\\{[\\s\\S]*?description:\\s*`,
  );
  const start = source.search(anchor);
  if (start < 0) return undefined;
  const descAt = source.indexOf("description:", start);
  const bt = source.indexOf("`", descAt);
  const sq = source.indexOf("'", descAt);
  const quote = bt >= 0 && (sq < 0 || bt < sq) ? "`" : "'";
  const from = source.indexOf(quote, descAt) + 1;
  let i = from;
  for (;;) {
    const end = source.indexOf(quote, i);
    if (end < 0) return undefined;
    if (source[end - 1] !== "\\" && source[end + 1] === ",") {
      return { start: from, end, old: source.slice(from, end), quote };
    }
    i = end + 1;
  }
}

/** Render a description for its quote style: single-quoted collapsed string
 * with escaped newlines (bundle) or raw template text (source). */
function renderDescription(text, quote) {
  if (quote === "'") {
    return text
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "\\'")
      .replace(/\n/g, "\\n");
  }
  // Template literal: escape bare backticks so the value does not close early.
  return text.replace(/`/g, "\\`");
}

try {
  const toolNames = Object.keys(DESCRIPTIONS);
  let allApplied = true;
  let anyLocated = false;
  let changed = false;

  for (const target of TARGETS) {
    if (!existsSync(target)) continue;
    const source = readFileSync(target, "utf8");
    const located = toolNames.map((tool) => ({
      tool,
      found: findDescription(source, tool),
    }));
    const allFound = located.every((l) => l.found !== undefined);
    const applied =
      allFound &&
      located.every(
        (l) =>
          l.found.old ===
          renderDescription(DESCRIPTIONS[l.tool], l.found.quote),
      );
    anyLocated = true;
    if (!applied) allApplied = false;
    if (applied || !allFound) continue;

    const backupPath = `${target}.bak-tool-descriptions`;
    if (!existsSync(backupPath)) writeFileSync(backupPath, source, "utf8");
    let next = source;
    for (const { tool, found } of [...located].sort(
      (a, b) => b.found.start - a.found.start,
    )) {
      next =
        next.slice(0, found.start) +
        renderDescription(DESCRIPTIONS[tool], found.quote) +
        next.slice(found.end);
    }
    writeFileSync(target, next, "utf8");
    changed = true;
    for (const { tool, found } of located) {
      const before = found.old.length;
      const after = renderDescription(DESCRIPTIONS[tool], found.quote).length;
      console.log(
        `  [${target.split("/").pop()}] ${tool.padEnd(18)} ${String(before).padStart(6)} -> ${String(after).padStart(6)} chars (-${before - after}, -${Math.round(((before - after) / before) * 100)}%)`,
      );
    }
  }

  if (!anyLocated) {
    console.error(
      "No context-mode target files found — check the extension install path.",
    );
    process.exit(1);
  }
  if (check) {
    if (allApplied) {
      console.log("Patch already applied ✓");
      process.exit(0);
    }
    console.error(
      "Patch NOT applied — run: node scripts/patch-context-mode-descriptions.mjs",
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
    "context-mode descriptions patched ✓ (backups: *.bak-tool-descriptions)",
  );
} catch (error) {
  console.error(
    `Failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
