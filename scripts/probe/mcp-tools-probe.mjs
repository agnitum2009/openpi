#!/usr/bin/env node
// MCP stdio 探针（含参数口径）：spawn server.bundle.mjs → initialize → tools/list。
// 打印每工具 desc + inputSchema JSON 长度 + 合计。用于 context-mode（无进程内注册面）。
import { spawn } from "node:child_process";
const BUNDLE =
  process.env.HOME +
  "/.pi/agent/npm/node_modules/context-mode/server.bundle.mjs";
const child = spawn(process.execPath, [BUNDLE], {
  stdio: ["pipe", "pipe", "pipe"],
});
let buf = "";
const send = (m) => child.stdin.write(JSON.stringify(m) + "\n");
child.stdout.on("data", (c) => {
  buf += c.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    try {
      const m = JSON.parse(line);
      if (m.id === 1)
        send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
      else if (m.id === 2) {
        const tools = m.result?.tools ?? [];
        let desc = 0,
          params = 0;
        for (const t of tools) {
          desc += (t.description ?? "").length;
          params += JSON.stringify(t.inputSchema ?? {}).length;
          console.log(
            t.name.padEnd(22) +
              " desc " +
              String((t.description ?? "").length).padStart(6) +
              " params " +
              String(JSON.stringify(t.inputSchema ?? {}).length).padStart(6),
          );
        }
        console.log(
          "TOTAL: desc " +
            desc +
            " params " +
            params +
            " ALL " +
            (desc + params) +
            " (~" +
            Math.round((desc + params) / 4) +
            " tok) tools=" +
            tools.length,
        );
        child.kill();
        process.exit(0);
      }
    } catch {}
  }
});
child.on("exit", (c) => {
  if (!buf) {
    console.error("exit", c);
    process.exit(1);
  }
});
send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "probe", version: "0" },
  },
});
setTimeout(() => {
  child.kill();
  process.exit(1);
}, 20000);
