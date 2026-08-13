#!/usr/bin/env node
// 全局 token 载荷测量：三块（内核 / openpi / 第三方扩展）统一口径。
// 用法:
//   node scripts/probe/measure-token-payload.mjs --kernel
//   node scripts/probe/measure-token-payload.mjs --ext <entry-path> [entry-path...]
// 口径: 每工具 desc + JSON(parameters) + promptSnippet + promptGuidelines 字符合计。
import { createExtensionRuntime, loadExtensions } from '/home/umax/.local/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js';

function fieldSize(def) {
  return {
    desc: (def.description ?? '').length,
    params: JSON.stringify(def.parameters ?? {}).length,
    snippet: (def.promptSnippet ?? '').length,
    guidelines: (def.promptGuidelines ?? []).join('\\n').length,
  };
}

function total(f) { return f.desc + f.params + f.snippet + f.guidelines; }

function printTable(rows, grandLabel) {
  let t = { desc: 0, params: 0, snippet: 0, guidelines: 0 };
  for (const r of rows) {
    t.desc += r.f.desc; t.params += r.f.params; t.snippet += r.f.snippet; t.guidelines += r.f.guidelines;
  }
  for (const r of rows) {
    console.log('  ' + r.name.padEnd(22) + ' desc ' + String(r.f.desc).padStart(6) + ' params ' + String(r.f.params).padStart(6) + ' snippet ' + String(r.f.snippet).padStart(4) + ' guidelines ' + String(r.f.guidelines).padStart(5) + ' | ALL ' + String(total(r.f)).padStart(6));
  }
  const all = total(t);
  console.log('  ' + grandLabel + ': desc ' + t.desc + ' params ' + t.params + ' snippet ' + t.snippet + ' guidelines ' + t.guidelines + ' | ALL ' + all + ' (~' + Math.round(all / 4) + ' tok)');
  return { t, all };
}

const mode = process.argv[2];
if (mode === '--kernel') {
  const toolsMod = await import('/home/umax/.local/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/tools/index.js');
  const defs = toolsMod.createAllToolDefinitions('/tmp', {});
  const rows = Object.entries(defs).map(([name, def]) => ({ name, f: fieldSize(def) }));
  console.log('== KERNEL (pi runtime built-ins) ==');
  printTable(rows, 'KERNEL TOTAL');
  process.exit(0);
}

if (mode === '--ext') {
  const paths = process.argv.slice(3);
  if (paths.length === 0) { console.error('no extension paths'); process.exit(1); }
  const runtime = createExtensionRuntime();
  runtime.getActiveTools = () => [];
  runtime.getAllTools = () => [];
  runtime.setActiveTools = () => {};
  runtime.refreshTools = () => {};
  runtime.appendEntry = () => {};
  const stubCtx = { hasUI: false, mode: 'main', cwd: process.cwd() };
  const { extensions, errors } = await loadExtensions(paths, process.cwd(), undefined, runtime);
  let grand = { desc: 0, params: 0, snippet: 0, guidelines: 0 };
  let grandAll = 0;
  let any = false;
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    const ext = extensions[i];
    const err = errors.find((e) => e.path === path);
    console.log('== ' + path.split('/').pop() + ' (' + path + ') ==');
    if (err || !ext) {
      console.log('  LOAD ERROR: ' + (err ? err.error : 'no extension'));
      continue;
    }
    // Some extensions register tools on session_start (e.g. tasks) — fire it.
    const sessionStart = ext.handlers.get('session_start') ?? [];
    for (const h of sessionStart) {
      try { await h({}, stubCtx); } catch (err) {
        console.log('  (session_start note: ' + (err instanceof Error ? err.message : String(err)) + ')');
      }
    }
    const rows = [];
    for (const [name, { definition: def }] of ext.tools) rows.push({ name, f: fieldSize(def) });
    if (rows.length === 0) { console.log('  (no tools)'); continue; }
    any = true;
    const r = printTable(rows, 'SUB-TOTAL');
    grand.desc += r.t.desc; grand.params += r.t.params; grand.snippet += r.t.snippet; grand.guidelines += r.t.guidelines;
    grandAll += r.all;
  }
  if (any) {
    console.log('GRAND TOTAL: desc ' + grand.desc + ' params ' + grand.params + ' snippet ' + grand.snippet + ' guidelines ' + grand.guidelines + ' | ALL ' + grandAll + ' (~' + Math.round(grandAll / 4) + ' tok)');
  }
  process.exit(errors.length > 0 ? 2 : 0);
}

console.error('usage: --kernel | --ext <paths...>');
process.exit(1);
