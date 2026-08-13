# openpi 工具载荷全局实测报告（现状 vs 基线）

> 日期：2026-08-13
> 口径：每工具 desc + JSON(parameters) + promptSnippet + promptGuidelines 字符合计；
> 1 tok ≈ 4 字符换算（量级对比用）。测量脚本：
> `scripts/probe/measure-token-payload.mjs`（内核/扩展）+ `scripts/probe/mcp-tools-probe.mjs`（MCP stdio）。
> 基线：docs/tool-lazyload-design.md（40.6k tok/轮 = 内核 6.3k + openpi 9.9k + 第三方 24.4k）。

---

## 1. 结论

- **现状（工具定义口径）**：内核 5,413 + openpi 31,897 + 第三方 87,542 =
  **124,852 字符 ≈ 31.2k tok/轮**（44 工具）。
- **按设计文档同口径折算**：40.6k → **~36.0k tok（整体 -11.3%）**，
  其中第三方描述补丁 **-4.2k tok**、openpi P1 静态压缩 **-0.4k tok**（pi 实测
  33,741→32,223 字符 = -4.5%；958a2a9 提交信息中的 -13% 为笔误口径，已纠错）。
- **真实会话端到端实测（pi 2026-08-14）**：最简消息 input tokens
  40,694 → 36,427 = **-4,267 tok（-10.5%）**，与第三方补丁核算 -4,070 tok
  一致（context-mode -2.1k + hermes -0.8k + lens -1.0k + web-access -0.17k）。
- 剩余大头全部是被对抗评估判定不可压的参数 schema（第三方 params 合计
  ~50k 字符）——静态压缩已到约束天花板；进一步收益 = P2 包重组（按需加载组）。

## 2. 三块明细（现状实测）

### 2.1 内核（pi runtime 内置，7 工具）——5,413 字符 ≈ 1,353 tok

| 工具 | ALL | 工具 | ALL |
|---|---|---|---|
| read 673 / bash 590 / edit 1,699 / write 427 / grep 1,017 / find 587 / ls 420 | | |

### 2.2 openpi 自身（25 工具，含 P1 -4.5%）——32,223 字符 ≈ 8,056 tok（pi 复测值）

| 扩展 | ALL | 扩展 | ALL |
|---|---|---|---|
| tasks（3 工具，session_start 注册） | 3,058 | workflows（3） | 6,254 |
| goal（3） | 2,280 | ask-user（2） | 4,138 |
| subagents（6） | 7,616 | context-pivot（1） | 765 |
| background-terminals（5） | 3,099 | plan-mode（1） | 584 |
| setup（1） | 4,098 | | |

### 2.3 第三方扩展——87,542 字符 ≈ 21,886 tok

| 扩展 | 工具 | 现状 ALL | 补丁前 ALL | 节省 |
|---|---|---|---|---|
| context-mode（MCP stdio） | 11 | 18,340 | 26,818 | -8,478（-32%） |
| pi-hermes-memory | 6 | 12,888 | 16,096 | -3,208（-20%） |
| pi-lens | 14 | 29,529 | 33,504 | -3,975（-12%） |
| pi-web-access | 4 | 8,560 | 9,359 | -799（-9%） |
| pi-mcp-adapter | 2 | 3,615 | 4,125 | -510（-12%） |
| pi-agent-browser-native | 1 | 12,387 | 同左 | 跳过（用户决策） |
| @narumitw/pi-chrome-devtools | 6 | 2,223 | 同左 | 未补丁 |
| cc-safety-net / pi-continue / pi-usage-bar-focus / picassio/pi-cc-patch / orca×3 | 0 工具 | 0 | — | — |

补丁合计：**-16,970 字符 ≈ -4,243 tok**。

> 注：描述（desc）口径的节省为 hermes -35%、lens -31%、web-access -31%、
> context-mode -50%、mcp-adapter -22%（见 tool-description-patch-playbook.md）；
> 本表 ALL 口径含不可压的 params/snippet/guidelines，故百分比更低。

## 3. 口径与方法

- 内核：pi runtime `createAllToolDefinitions` 实测（7 内置工具）。
- openpi：独立仓 9 个工具扩展经运行时 loader 直载，并触发 session_start
  钩子（tasks 的工具在该钩子注册）。
- 第三方：运行时 loader 直载各 `pi.extensions` 入口；context-mode 无
  进程内注册面，用 MCP stdio 握手（server.bundle.mjs）实测。
- 与设计文档基线的差异说明：设计文档内核 6.3k 含系统提示框架等非工具
  定义内容，本报告内核口径 = 纯工具定义 5,413 字符；折算对比用同口径
  相对数（-11.3%），不做绝对数强行对齐。

## 4. 保护性排除（不压缩）

- **picassio/pi-cc-patch** 与 **cc-safety-net**：Claude Code 相关扩展，
  用户决策**只测量、不做任何压缩**（防止意外）。两者实测 0 工具（仅
  钩子/命令注入）。
- **pi-agent-browser-native**：载荷 78% 为参数 schema，对抗评估约束下
  不可压，用户决策跳过（详见 tool-description-patch-playbook.md）。

## 5. 下一步

- P3（内核 deferred/setToolVisibility）已由用户决策**永久废弃**——静态
  压缩至此即为描述侧天花板。
- 剩余 openpi 侧手段 = **P2 包重组**（core/runtime/utility/system 加载组
  预设）：让用户按任务形态卸载 utility/runtime 组，纯编码会话可少载
  setup(4.1k)/workflows(6.3k)/subagents(7.6k) 等块。
