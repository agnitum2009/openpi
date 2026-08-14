#!/usr/bin/env node
/**
 * One-shot replay of every tool-description patch (B plan, all of them).
 * Run after `pi update --all` (npm reinstall wipes the patches).
 * Each patch script is applied, then verified with --check; a summary table
 * is printed and the exit code is non-zero if anything fails.
 *
 * Usage: node scripts/reapply-description-patches.mjs
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const PATCHES = [
  ["context-mode", "patch-context-mode-descriptions.mjs"],
  ["pi-hermes-memory", "patch-hermes-memory-descriptions.mjs"],
  ["pi-lens", "patch-lens-descriptions.mjs"],
  ["pi-web-access", "patch-web-access-descriptions.mjs"],
  ["pi-mcp-adapter", "patch-mcp-adapter-descriptions.mjs"],
];

const results = [];
for (const [label, file] of PATCHES) {
  const script = join(here, file);
  const apply = spawnSync(process.execPath, [script], {
    stdio: "pipe",
    encoding: "utf8",
  });
  const check = spawnSync(process.execPath, [script, "--check"], {
    stdio: "pipe",
    encoding: "utf8",
  });
  const ok = apply.status === 0 && check.status === 0;
  results.push({
    label,
    ok,
    applyStatus: apply.status,
    checkStatus: check.status,
    detail: (apply.stderr || apply.stdout || "").trim(),
  });
}

for (const r of results) {
  console.log(
    (r.ok ? "✓" : "✗") +
      " " +
      r.label.padEnd(20) +
      " apply=" +
      (r.applyStatus ?? "killed") +
      " check=" +
      (r.checkStatus ?? "killed"),
  );
  if (!r.ok && r.detail) {
    console.log("  " + r.detail.split("\\n").slice(-2).join("\\n  "));
  }
}
const failed = results.filter((r) => !r.ok).length;
console.log(
  failed === 0
    ? "\nAll description patches applied ✓"
    : "\n" + failed + " patch(es) failed — see output above",
);
process.exit(failed === 0 ? 0 : 1);
