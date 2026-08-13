# HANDOFF — 第三方扩展工具描述补丁（B 方案）

> 交接时间：2026-08-13
> 交接方：pi（openpi 开发客户端）→ 外部 deepseek harness（接续开发）
> 测试方：pi（本客户端负责验证）
> 独立仓库：`agnitum2009/openpi-lazyload`（分支 `feat/tool-lazyload`）

---

## 1. 任务概述

第三方扩展（npm 包）的工具描述每轮全量进系统提示——token 载荷大头。
npm 包无法改源码（`pi update --all` 重装覆盖）→ 采用**本地补丁 + 升级后重放**
模式（与 `scripts/reapply-kernel-resume-patch.mjs` 同源）。

**已闭环**：context-mode（6 工具压缩，总载荷 -50%）。
**待接续**：hermes-memory → pi-lens → browser-native → web-access（同框架扩展）。

## 2. 环境与路径

```
worktree:        /home/umax/work/openpi-dev-lazyload
独立仓 remote:   lazyload-origin → https://github.com/agnitum2009/openpi-lazyload.git
主仓（勿动）:    /home/umax/work/openpi-dev（v0.2.0-complete，稳定运行）
扩展安装根:      ~/.pi/agent/npm/node_modules/<扩展名>/
pi 桥真相源:     MCP stdio 握手（见 §5）

工具链:          bun（~/.bun/bin）、node v24（~/.nvm/versions/node/v24.19.0/bin）
                命令前缀: export PATH="$HOME/.bun/bin:$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"
```

## 3. 已完成工作（commit 链，全部在 feat/tool-lazyload）

```
6b5dd44  feat(B): context-mode 补丁完整闭环 — 6 工具 -41~66%，总载荷 -50%
70c005c  feat(B): context-mode 描述补丁脚本 — 三大工具 -62~66%（双目标+重放模式）
b111ccc  docs: 懒加载设计 + 对抗性评估（worktree 独立开发起点）
958a2a9  perf: P1 工具描述压缩 — openpi 增量 -13%（对抗评估校准后）
```

关键文件：
- `scripts/patch-context-mode-descriptions.mjs` — 补丁脚本（框架模板）
- `docs/tool-description-patch-playbook.md` — 运行手册（重放/验证/扩展指南）
- `docs/tool-lazyload-design.md` + `docs/tool-lazyload-adversarial-eval.md` — 设计与对抗评估

## 4. 补丁框架结构（接续开发的模板）

```js
// scripts/patch-context-mode-descriptions.mjs 的核心结构：
const TARGETS = [bundle路径, server.js路径];   // 每扩展的目标文件
const DESCRIPTIONS = { toolName: "压缩后描述" }; // 纯文本（数组 join 或 String.raw）
// findDescription(): 结构锚定（registerTool("x",{...description:）+
//   引号类型检测（` 模板 / ' 折叠字符串）
// renderDescription(): 按引号类型渲染（单引号转义 \n、模板转义反引号）
// 流程: --check 幂等 → 备份 *.bak-tool-descriptions → 倒序替换 → 报告节省
```

## 5. 验证协议（测试方 = pi 执行）

**唯一可靠验证 = MCP stdio 握手**（headless `pi -p -e <ext>` 不可靠——
MCP 桥异步 spawn 时序导致工具时有时无）：

```bash
# 探针模式（/tmp/token-bench/mcp-probe3.mjs 已有）：
# 1. spawn <扩展的 server bundle>（stdio）
# 2. JSON-RPC: initialize → tools/list → 断言工具数 + 总描述字符
# 3. tools/call 实际执行 1 个补丁工具 → 断言输出
# 4. 补丁脚本 --check → exit 0
```

**接续开发方交付物**（每个扩展）：
1. `scripts/patch-<ext>-descriptions.mjs`（或扩展统一框架）
2. 压缩前后对比表（MCP tools/list 实测）
3. 功能调用验证记录（tools/call 输出）

**pi 测试方动作**：运行脚本 → MCP 握手验证 → 功能调用 → 报告结果回传。

## 6. 待接续任务（优先级序）

| # | 扩展 | 已知载荷增量 | 目标文件定位提示 |
|---|---|---|---|
| 1 | **pi-hermes-memory** | +4,982 tok | `~/.pi/agent/pi-hermes-memory/`（本地安装，非 npm）——先确认加载入口与工具定义文件 |
| 2 | **pi-lens** | +4,575 tok | `~/.pi/agent/npm/node_modules/pi-lens/dist/`（~15 工具：lens_diagnostics/lsp_diagnostics/symbol_search/project_report/module_report/read_symbol 等） |
| 3 | **pi-agent-browser-native** | +3,684 tok | `npm/node_modules/pi-agent-browser-native/dist/`（agent_browser 单工具超长描述） |
| 4 | **pi-web-access** | +2,628 tok | `npm/node_modules/pi-web-access/`（web_search/fetch_content/get_search_content） |
| 5 | pi-mcp-adapter | +1,137 tok | 低优先（mcp/mcpScript 网关） |

**压缩原则**（对抗评估约束，不可违反）：
- ✅ 可压：哲学段落、方法论说明、冗余 EXAMPLE、重复解释
- ❌ 不可压：WHEN 触发条件、安全契约（sandbox 边界/purge 确认/凭据警告）、
  参数 schema、env 变量名、TTL/缓存语义、行为约束（guidelines）

## 7. 已知陷阱（必须遵守）

1. **bundle 混淆变量名**：minified bundle 里插值变量被重命名（`${bunNote}`→`${vU}`）
   → NEW 描述**纯文本，禁止 `${}` 占位符**（否则运行时 ReferenceError）
2. **单引号折叠**：无插值描述在 bundle 折叠为单引号字符串（`\n` 转义）——
   锚定必须检测引号类型（`` ` `` 或 `'`），渲染按类型转义
3. **模板内反引号**：NEW 含反引号时模板格式必须转义 `\``
4. **备份**：首次 apply 前写 `*.bak-tool-descriptions`
5. **幂等**：`--check` 必须 exit 0/1 语义正确（已应用=0）

## 8. 纪律与约束（不可违反）

- 所有开发/提交**只在 worktree**（`/home/umax/work/openpi-dev-lazyload`），
  推送到 `lazyload-origin`（独立仓）
- **主仓 `/home/umax/work/openpi-dev` 禁止任何新改动**（稳定运行 + 权威连接）
- 用户私有文件永不提交：`extensions/file-search/src/binaries.ts`、
  `extensions/ui-customization/footer.ts`/`footer.test.ts`、
  `extensions/subagents/docs/design-plan.md`、`effect-v4-notes.md`、
  `extensions/background-terminals/docs/implementation-guide.md`、`package-lock.json`
- **不做 PR**（独立仓开发；成熟后整体转移给主仓远端作者——转移是用户决策）
- P3（内核 deferred）已关闭——不依赖内核能力，openpi 侧/补丁侧可做为止
- 提交信息用中文摘要 + 英文关键词（历史风格一致）

## 9. 测试回传协议（pi 侧）

接续开发方完成一个扩展后，在独立仓提交并**通知 pi 测试**：
1. pi 拉取（`git -C /home/umax/work/openpi-dev-lazyload pull lazyload-origin feat/tool-lazyload`）
2. pi 运行补丁脚本 + MCP 握手 + 功能调用
3. pi 回传：通过/失败 + 实测数据（压缩前后对比）+ 问题定位

## 10. 完成判据（扩展全部落地时）

- 4 大扩展补丁脚本就位（hermes-memory/pi-lens/browser-native/web-access）
- 每个：MCP 工具全注册 ✓、总载荷节省 ≥30% ✓、功能调用正常 ✓、幂等 ✓
- 运行手册覆盖表更新
- 全部提交独立仓
