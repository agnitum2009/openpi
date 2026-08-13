#!/usr/bin/env node
/**
 * Patch pi-web-access tool descriptions for token efficiency.
 *
 * pi-web-access loads in-process (pi.extensions -> index.ts) and registers
 * 4 tools: web_search, source_check, fetch_content, get_search_content.
 * In-process baseline (runtime loader probe): 2,203 chars of tool
 * descriptions per round.
 *
 * Compressed descriptions KEEP: provider selection semantics (array/all/
 * explicit-only set), credential requirements (OpenAI/xAI), queries
 * guidance, includeContent/workflow/curator semantics, auto-select and
 * SearXNG preference rules, storage-retrieval contracts. The provider
 * enumeration itself lives in the parameter schema enum, so the long
 * duplicated lists in the description are dropped (redundant example
 * removal — same principle as context-mode). Interpolation placeholders
 * (${fetchContentStorageNote} / ${storedContentSources}) are preserved
 * verbatim. Parameter schemas and promptGuidelines are NOT touched.
 *
 * pi update --all reinstalls the package and wipes the patch — re-run this
 * script afterwards (same replay pattern as reapply-kernel-resume-patch).
 * Backups: index.ts.bak-tool-descriptions.
 *
 * Usage: node scripts/patch-web-access-descriptions.mjs [--check]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(
  process.env.HOME ?? "",
  ".pi/agent/npm/node_modules/pi-web-access",
);
const TARGETS = [join(ROOT, "index.ts")];

// Compressed texts — plain text only: no ${} placeholders, no backticks.
const WEB_SEARCH_DESCRIPTION = [
  "Search the web with any supported provider (list in provider param): an array searches only those providers simultaneously; 'all' searches every eligible provider except DuckDuckGo, AnySearch, xAI, Bright Data, SerpBase (those five need explicit selection). Returns an AI-synthesized answer with source citations.",
  "",
  "OpenAI search needs Codex or an OpenAI API key; xAI needs SuperGrok/X Premium or an API key.",
  "",
  "For comprehensive research prefer queries (plural) with 2-4 varied angles; each query gets its own synthesized answer.",
  "",
  "includeContent:true fetches full page content in the background. Searches auto-open the interactive browser curator and stream results live; workflow 'none' skips curation, 'auto-summary' skips it. The configured provider is used when provider is omitted or auto; omit provider unless overriding. Without a configured provider, auto-selects OpenAI when suitable, then other eligible providers in priority order; configured SearXNG is preferred first for local/private search.",
].join("\n");

const SOURCE_CHECK_DESCRIPTION =
  "Claim check against web sources: bounded machine-readable evidence with passage citations.";

// fetch_content: static prefix; ${fetchContentStorageNote} is preserved.
const FETCH_CONTENT_STATIC = [
  "Fetch URL(s), extract readable content as markdown. mode 'raw' = exact HTTP response bodies; mode 'answer' + prompt = answer from fetched content only. Direct image URLs return resized images. Supports YouTube transcripts, GitHub repos, PDFs, local videos. ",
].join("\n");
const FETCH_CONTENT_INTERP = "${fetchContentStorageNote}";

// get_search_content: static prefix; ${storedContentSources} is preserved.
const GET_SEARCH_CONTENT_STATIC =
  "Retrieve slices / matching passages in a previous ";
const GET_SEARCH_CONTENT_INTERP = "${storedContentSources}";

// promptSnippet compressions (snippets are not behavioral guidelines).
const SNIPPETS = {
  webSearch:
    "Web research. Prefer {queries:[...]} with 2-4 varied angles; omit provider unless overriding the configured default.",
  fetchContent:
    "Fetch readable/raw URL content, images, GitHub repos, videos; mode answer uses only the fetched source.",
  sourceCheck:
    "Verify a claim with structured source evidence and passage citations.",
};

const check = process.argv.includes("--check");

function assertPlain(text, label) {
  if (
    text.includes(String.fromCharCode(36) + "{") ||
    text.includes(String.fromCharCode(96))
  ) {
    throw new Error(
      "NEW text for " +
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

// First field value after the tool's name expression.
function locateField(source, nameExpr, fieldName, maxScan) {
  const nameAt = source.indexOf(nameExpr);
  if (nameAt < 0) return undefined;
  const region = source.slice(nameAt, nameAt + maxScan);
  const re = new RegExp(fieldName + ":\\s*\\n?\\s*([\\x60\"'])");
  const d = re.exec(region);
  if (!d) return undefined;
  const quote = d[1];
  const start = nameAt + d.index + d[0].length;
  const end =
    quote === '"'
      ? findJsonStringEnd(source, start)
      : findStringEnd(source, quote, start, ",");
  if (end === undefined) return undefined;
  return { start, end, quote };
}

function renderText(text, quote) {
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
  assertPlain(WEB_SEARCH_DESCRIPTION, "web_search");
  assertPlain(SOURCE_CHECK_DESCRIPTION, "source_check");
  assertPlain(FETCH_CONTENT_STATIC, "fetch_content static");
  assertPlain(GET_SEARCH_CONTENT_STATIC, "get_search_content static");
  for (const [label, text] of Object.entries(SNIPPETS))
    assertPlain(text, "snippet " + label);

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

    const anchors = [];
    // web_search description (full replace).
    const ws = locateField(
      source,
      "name: toolNames.webSearch",
      "description",
      400,
    );
    anchors.push({
      label: "web_search description",
      found: ws,
      text: WEB_SEARCH_DESCRIPTION,
      interp: null,
    });
    // source_check description (full replace).
    const sc = locateField(
      source,
      "name: toolNames.sourceCheck",
      "description",
      400,
    );
    anchors.push({
      label: "source_check description",
      found: sc,
      text: SOURCE_CHECK_DESCRIPTION,
      interp: null,
    });
    // fetch_content description (static prefix, keep interpolation).
    const fc = locateField(
      source,
      "name: toolNames.fetchContent",
      "description",
      400,
    );
    if (fc && fc.quote === "`") {
      const interpAt = source.indexOf(FETCH_CONTENT_INTERP, fc.start);
      if (interpAt >= 0 && interpAt < (fc.end ?? Infinity)) fc.end = interpAt;
    }
    anchors.push({
      label: "fetch_content description",
      found: fc,
      text: FETCH_CONTENT_STATIC,
      interp: FETCH_CONTENT_INTERP,
    });
    // get_search_content description (static prefix, keep interpolation).
    const gc = locateField(
      source,
      "name: toolNames.getSearchContent",
      "description",
      400,
    );
    if (gc && gc.quote === "`") {
      const interpAt = source.indexOf(GET_SEARCH_CONTENT_INTERP, gc.start);
      if (interpAt >= 0 && interpAt < (gc.end ?? Infinity)) gc.end = interpAt;
    }
    anchors.push({
      label: "get_search_content description",
      found: gc,
      text: GET_SEARCH_CONTENT_STATIC,
      interp: GET_SEARCH_CONTENT_INTERP,
    });
    // snippets (web_search / fetch_content / source_check).
    anchors.push({
      label: "web_search snippet",
      found: locateField(
        source,
        "name: toolNames.webSearch",
        "promptSnippet",
        3000,
      ),
      text: SNIPPETS.webSearch,
      interp: null,
    });
    anchors.push({
      label: "fetch_content snippet",
      found: locateField(
        source,
        "name: toolNames.fetchContent",
        "promptSnippet",
        3000,
      ),
      text: SNIPPETS.fetchContent,
      interp: null,
    });
    anchors.push({
      label: "source_check snippet",
      found: locateField(
        source,
        "name: toolNames.sourceCheck",
        "promptSnippet",
        3000,
      ),
      text: SNIPPETS.sourceCheck,
      interp: null,
    });

    const missing = anchors.filter((a) => !a.found);
    if (missing.length > 0) {
      console.error(
        "[!] not located: " +
          missing.map((m) => m.label).join(", ") +
          " — layout changed; re-derive manually.",
      );
      allApplied = false;
      continue;
    }

    const blocksApplied = anchors.every(
      (a) =>
        source.slice(a.found.start, a.found.end) ===
        renderText(a.text, a.found.quote),
    );
    if (!blocksApplied) allApplied = false;
    if (blocksApplied) continue;

    const backupPath = target + ".bak-tool-descriptions";
    if (!existsSync(backupPath)) writeFileSync(backupPath, source, "utf8");

    const edits = anchors
      .filter((a) => a.found)
      .sort((a, b) => b.found.start - a.found.start);
    let next = source;
    for (const { label, found, text } of edits) {
      const rawBefore = source.slice(found.start, found.end);
      const before =
        found.quote === '"' ? unescapeJson(rawBefore).length : rawBefore.length;
      // interp anchors only replace the static prefix; the original
      // interpolation stays in place after found.end.
      const replacement = renderText(text, found.quote);
      const after = text.length;
      next = next.slice(0, found.start) + replacement + next.slice(found.end);
      console.log(
        "  [" +
          basename +
          "] " +
          label.padEnd(28) +
          " " +
          String(before).padStart(5) +
          " -> " +
          String(after).padStart(5) +
          " chars (-" +
          (before - after) +
          ", -" +
          Math.round(((before - after) / before) * 100) +
          "%)",
      );
    }
    writeFileSync(target, next, "utf8");
    changed = true;
  }

  if (!anyLocated) {
    console.error(
      "No pi-web-access target files found — check the extension install path.",
    );
    process.exit(1);
  }
  if (check) {
    if (allApplied) {
      console.log("Patch already applied ✓");
      process.exit(0);
    }
    console.error(
      "Patch NOT applied — run: node scripts/patch-web-access-descriptions.mjs",
    );
    process.exit(1);
  }
  if (!allApplied && !changed) {
    console.error(
      "Some text blocks were not located — the extension layout changed; re-derive manually.",
    );
    process.exit(1);
  }
  console.log(
    "pi-web-access descriptions patched ✓ (backup: index.ts.bak-tool-descriptions)",
  );
} catch (error) {
  console.error(
    "Failed: " + (error instanceof Error ? error.message : String(error)),
  );
  process.exit(1);
}
