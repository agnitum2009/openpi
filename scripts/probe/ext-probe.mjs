#!/usr/bin/env node
// 进程内扩展工具探针：用 pi 运行时 loader 直接加载扩展，捕获注册的工具定义。
// 用法: [HOME=<temp>] node scripts/probe/ext-probe.mjs <extension-entry-path> [--text]
// 输出: 每工具 desc/params/snippet/guidelines 字符数 + TOTALS + toolCount。
// 注意: 写状态的扩展（hermes-memory/web-access）请给临时 HOME，避免动真实数据。
// 进程内扩展工具探针：用 pi 运行时 loader 直接加载扩展，捕获注册的工具定义。
// 用法: HOME=<temp> node ext-probe.mjs <extension-entry-path> [--text]
import { createExtensionRuntime, loadExtensions } from "/home/umax/.local/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js";

const args = process.argv.slice(2);
const withText = args.includes("--text");
const extPath = args.find((a) => !a.startsWith("--"));
if (!extPath) {
  console.error("usage: node ext-probe.mjs <ext-entry> [--text]");
  process.exit(1);
}
const { extensions, errors } = await loadExtensions(
  [extPath], process.cwd(), undefined, createExtensionRuntime(),
);
if (errors.length) {
  console.error("LOAD ERRORS:");
  console.error(JSON.stringify(errors, null, 2));
  process.exit(1);
}
const ext = extensions[0];
if (!ext) {
  console.error("no extension loaded");
  process.exit(1);
}
const rows = [];
let total = 0, totalDesc = 0, totalParams = 0, totalSnippet = 0, totalGuidelines = 0;
for (const [name, { definition: d }] of ext.tools) {
  const desc = (d.description ?? "").length;
  const params = JSON.stringify(d.parameters ?? {}).length;
  const snippet = (d.promptSnippet ?? "").length;
  const guidelines = (d.promptGuidelines ?? []).join("\n").length;
  total += desc + params + snippet + guidelines;
  totalDesc += desc; totalParams += params; totalSnippet += snippet; totalGuidelines += guidelines;
  rows.push({ name, desc, params, snippet, guidelines });
}
rows.sort((a, b) => b.desc - a.desc);
console.log("name".padEnd(18), "desc".padStart(7), "params".padStart(8), "snippet".padStart(8), "guidelines".padStart(11));
for (const r of rows) {
  console.log(r.name.padEnd(18), String(r.desc).padStart(7), String(r.params).padStart(8), String(r.snippet).padStart(8), String(r.guidelines).padStart(11));
}
console.log(`TOTALS: desc=${totalDesc} params=${totalParams} snippet=${totalSnippet} guidelines=${totalGuidelines} ALL=${total} (~${Math.round(total / 4)} tok) toolCount=${rows.length}`);
if (withText) {
  for (const [name, { definition: d }] of ext.tools) {
    console.log(`\n===== TOOL: ${name} =====`);
    console.log(d.description);
  }
}
process.exit(0);
