#!/usr/bin/env node
/**
 * Patch pi-mcp-adapter tool descriptions for token efficiency.
 *
 * pi-mcp-adapter loads in-process (pi.extensions -> ./index.ts) and registers
 * 2 tools: mcp (proxy gateway; description built from static prefix/usage
 * block + config-driven server lists) and mcpScript (scripted multi-call).
 * Static-only baseline (loader probe, empty HOME): mcp 1,193 + mcpScript 804
 * = 1,997 chars. Dynamic server/instruction summaries are config-driven and
 * untouched.
 *
 * Compressed parts KEEP: WHEN triggers (mcp vs mcpScript vs direct call),
 * usage-mode shapes, OAuth actions, mode-priority contract, tools.search/
 * describe/call return shapes. Only verbose repetition is cut.
 *
 * pi update --all wipes the patch — re-run afterwards (same replay pattern).
 * Backups: *.bak-tool-descriptions.
 *
 * Usage: node scripts/patch-mcp-adapter-descriptions.mjs [--check]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(
  process.env.HOME ?? "",
  ".pi/agent/npm/node_modules/pi-mcp-adapter",
);
const TARGETS = [join(ROOT, "direct-tools.ts"), join(ROOT, "index.ts")];

const PREFIX_TEXT =
  "MCP gateway — server status, tool search/describe, auth, and single MCP tool calls. For several MCP calls with logic between them use mcpScript; call non-MCP Pi tools directly, not through mcp.\\n";

const USAGE_BLOCK = [
  "desc += `\\nUsage:\\n`;",
  'desc += `  mcp({ }) → status; mcp({ server: "name" }) → list tools; mcp({ search: "query" }) → search tools; mcp({ describe: "tool_name" }) → tool details/parameters; mcp({ instructions: "name" }) → server instructions; mcp({ connect: "name" }) → connect + refresh metadata\\n`;',
  'desc += `  mcp({ tool: "name", args: {...} }) → call a tool (object args; JSON string ok); mcp({ action: "ui-messages" }) → completed-UI-session messages; mcp({ action: "auth-start", server }) → OAuth browser URL; mcp({ action: "auth-complete", server, args: { redirectUrl } }) → finish OAuth\\n`;',
  "desc += `  Mode: action > tool (call) > connect > describe > instructions > search > server (list) > nothing (status)`;",
].join("\n");

const MCPSCRIPT_TEXT =
  "Run trusted JavaScript that makes multiple MCP tool calls in one request — loop, filter, chain, or fan out between calls. For a single MCP call/search/describe/status/auth, use the mcp tool instead.\\n\\nDiscover: await tools.search({ query }) → { items: [{ path, name, server, description? }], total, hasMore, nextOffset }. Inspect: await tools.describe({ path }) → descriptor with inputTypeScript. Call: tools.call(path, args) → { ok: true, data } or { ok: false, error: { code, message } }; direct flat calls work when the name is known. Use emit(value) for user-visible output. Load the mcp-scripting skill for the full guide.";

const check = process.argv.includes("--check");

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

function findTemplateEnd(source, from) {
  let i = from;
  for (;;) {
    const end = source.indexOf("`", i);
    if (end < 0) return undefined;
    if (source[end - 1] !== "\\" && source[end + 1] === ";") return end;
    i = end + 1;
  }
}

function locatePrefix(source) {
  const m = source.indexOf("let desc = `");
  if (m < 0) return undefined;
  const start = m + "let desc = `".length;
  const end = findTemplateEnd(source, start);
  if (end === undefined) return undefined;
  return { start, end };
}

function locateUsageBlock(source) {
  const start = source.indexOf("desc += `\\nUsage:\\n`;");
  if (start < 0) return undefined;
  const modeAt = source.indexOf("Mode: action > tool (call) > connect", start);
  if (modeAt < 0) return undefined;
  const end = source.indexOf("`;", modeAt);
  if (end < 0) return undefined;
  return { start, end: end + 2 };
}

function locateMcpScript(source) {
  const nameAt = source.indexOf('name: "mcpScript"');
  if (nameAt < 0) return undefined;
  const region = source.slice(nameAt, nameAt + 400);
  const d = /description:\s*([\\x60"'])/.exec(region);
  if (!d) return undefined;
  const quote = d[1];
  const start = nameAt + d.index + d[0].length;
  const end = findJsonStringEnd(source, start);
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
  return text;
}

try {
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
    if (basename === "direct-tools.ts") {
      anchors.push({
        label: "mcp prefix",
        found: locatePrefix(source),
        text: PREFIX_TEXT,
        quote: "`",
      });
      anchors.push({
        label: "mcp usage block",
        found: locateUsageBlock(source),
        raw: USAGE_BLOCK,
      });
    } else {
      anchors.push({
        label: "mcpScript description",
        found: locateMcpScript(source),
        text: MCPSCRIPT_TEXT,
        quote: '"',
      });
    }

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

    const blocksApplied = anchors.every((a) =>
      a.raw !== undefined
        ? source.slice(a.found.start, a.found.end) === a.raw
        : source.slice(a.found.start, a.found.end) ===
          renderText(a.text, a.quote ?? "`"),
    );
    if (!blocksApplied) allApplied = false;
    if (blocksApplied) continue;

    const backupPath = target + ".bak-tool-descriptions";
    if (!existsSync(backupPath)) writeFileSync(backupPath, source, "utf8");

    const edits = anchors
      .filter((a) => a.found)
      .sort((a, b) => b.found.start - a.found.start);
    let next = source;
    for (const a of edits) {
      const before = a.found.end - a.found.start;
      const replacement =
        a.raw !== undefined ? a.raw : renderText(a.text, a.quote ?? "`");
      const after = replacement.length;
      next =
        next.slice(0, a.found.start) + replacement + next.slice(a.found.end);
      console.log(
        "  [" +
          basename +
          "] " +
          a.label.padEnd(24) +
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
      "No pi-mcp-adapter target files found — check the extension install path.",
    );
    process.exit(1);
  }
  if (check) {
    if (allApplied) {
      console.log("Patch already applied ✓");
      process.exit(0);
    }
    console.error(
      "Patch NOT applied — run: node scripts/patch-mcp-adapter-descriptions.mjs",
    );
    process.exit(1);
  }
  if (!allApplied && !changed) {
    console.error(
      "Some blocks were not located — the extension layout changed; re-derive manually.",
    );
    process.exit(1);
  }
  console.log(
    "pi-mcp-adapter descriptions patched ✓ (backups: *.bak-tool-descriptions)",
  );
} catch (error) {
  console.error(
    "Failed: " + (error instanceof Error ? error.message : String(error)),
  );
  process.exit(1);
}
