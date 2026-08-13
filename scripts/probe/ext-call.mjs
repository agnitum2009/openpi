#!/usr/bin/env node
// 功能调用探针：加载扩展后直接执行一个工具的真实 execute，打印结构化结果。
// 用法: [HOME=<temp>] node scripts/probe/ext-call.mjs <ext-entry> <toolName> <json-params>
// 注意: 写状态的扩展请给临时 HOME；pi_lens_activate_tools 等需要 get/setActiveTools
//       的工具已内置内存桩实现。
// 建议用前缀赋值（HOME=<temp> node ...），避免 export 污染整个 shell。
console.error("[probe] HOME=" + (process.env.HOME ?? "<unset>"));
// 功能调用探针：加载扩展后直接执行一个工具的真实 execute，断言输出。
// 用法: HOME=<temp> node ext-call.mjs <ext-entry> <toolName> <json-params>
import {
  createExtensionRuntime,
  loadExtensions,
} from "/home/umax/.local/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js";

const args = process.argv.slice(2);
const [extPath, toolName, paramsJson] = args;
if (!extPath || !toolName || !paramsJson) {
  console.error(
    "usage: HOME=<temp> node ext-call.mjs <ext-entry> <toolName> <json-params>",
  );
  process.exit(1);
}
const runtime = createExtensionRuntime();
// Benign in-memory stubs so tools that read/write the active tool list work.
let activeTools = [];
runtime.getActiveTools = () => activeTools;
runtime.setActiveTools = (names) => {
  activeTools = Array.isArray(names) ? [...names] : activeTools;
};
runtime.refreshTools = () => {};
const { extensions, errors } = await loadExtensions(
  [extPath],
  process.cwd(),
  undefined,
  runtime,
);
if (errors.length) {
  console.error("LOAD ERRORS:", JSON.stringify(errors, null, 2));
  process.exit(1);
}
const ext = extensions[0];
const entry = ext?.tools.get(toolName);
if (!entry) {
  console.error("tool not found:", toolName);
  process.exit(1);
}
const params = JSON.parse(paramsJson);
const result = await entry.definition.execute("probe-call", params, undefined);
const text = JSON.stringify(result);
console.log("RESULT:", text.length > 600 ? text.slice(0, 600) + "…" : text);
process.exit(0);
