# 第三方扩展工具描述补丁——运行手册

> 状态：context-mode / pi-hermes-memory / pi-lens / pi-web-access /
> pi-mcp-adapter 已闭环；browser-native 跳过（用户决策，见下文）。
> pi 测试端验收（2026-08-13）：测试 1-5 全过——幂等+重放 ✓、toolCount 与
> desc 合计精确一致（0 波动）、功能调用全过；测试 6（重启后真实 session）也过：
> web_search 描述为压缩版（逐字确认）、memory_search / symbol_search /
> get_search_content 会话内实调正常。B 方案全数闭环。
> 配套：`scripts/patch-context-mode-descriptions.mjs`（B 方案第一批）

## 目的

第三方扩展（npm 包）的工具描述每轮全量进系统提示，是 token 载荷大头
（实测：context-mode 11 工具 17,069 字符 ≈ 4.3k tokens/轮）。
npm 包无法直接改源码（`pi update --all` 会重装覆盖），因此采用
**本地补丁 + 升级后重放**模式（与 `scripts/reapply-kernel-resume-patch.mjs`
同源）。

## 覆盖与收益（context-mode，实测 MCP tools/list 真相源）

| 工具 | 压缩前 | 压缩后 | 节省 |
|---|---|---|---|
| ctx_execute | 3,101 | 1,105 | -64% |
| ctx_batch_execute | 2,176 | 727 | -66% |
| ctx_search | 3,402 | 1,289 | -62% |
| ctx_fetch_and_index | 2,276 | 982 | -57% |
| ctx_execute_file | 2,168 | 988 | -54% |
| ctx_index | 1,547 | 916 | -41% |
| **合计（11 工具）** | **17,069** | **8,591** | **-50%** |

**保留**：WHEN 触发条件、安全契约（sandbox/FILE_CONTENT 边界、purge 确认）、
参数 schema、env 变量名、TTL/缓存语义。
**压缩**：Think-in-Code 哲学段落、ranking 原理说明、冗余 EXAMPLE。

### pi-hermes-memory（进程内 loader 探针实测，2026-08-13）

| 工具 | 压缩前 | 压缩后 | 节省 |
|---|---|---|---|
| skill_manage | 3,391 | 1,516 | -55% |
| memory_replace | 1,631 | 1,334 | -18% |
| memory_remove | 1,620 | 1,323 | -18% |
| memory_add | 1,615 | 1,318 | -18% |
| memory_search | 549 | 280 | -49% |
| session_search | 492 | 319 | -35% |
| **合计（6 工具）** | **9,298** | **6,090** | **-35%** |

验证：进程内加载 6 工具全注册 ✓；memory_add / skill_manage / memory_search
实际调用成功（沙箱 HOME，不碰真实数据）✓；--check 幂等 ✓。
补充：desc+params+snippet+guidelines 合计 16,096 → 12,888 字符（-20%）。
注意：hermes-memory 是 TS 源码包（pi.extensions → src/index.ts，jiti 进程内
加载），无 MCP stdio 入口，故用运行时 loader 直载探针代替 MCP 握手
（/tmp/token-bench/ext-probe.mjs + ext-call.mjs）。

### pi-lens（进程内 loader 探针实测，2026-08-13）

| 工具 | 压缩前 | 压缩后 | 节省 |
|---|---|---|---|
| lsp_navigation | 1,943 | 808 | -58% |
| lens_diagnostics | 1,745 | 1,063 | -39% |
| module_report | 1,463 | 979 | -33% |
| project_report | 1,312 | 976 | -26% |
| ast_grep_search | 983 | 735 | -25% |
| lens_diagnostic_mark | 907 | 717 | -21% |
| pi_lens_activate_tools | 901 | 723 | -20% |
| read_symbol | 867 | 737 | -15% |
| ast_grep_outline | 758 | 546 | -28% |
| symbol_search | 673 | 511 | -24% |
| ast_grep_replace | 567 | 459 | -19% |
| read_enclosing | 317 | 252 | -21% |
| ast_grep_dump | 251 | 237 | -6% |
| lsp_diagnostics | 225 | 194 | -14% |
| **合计（14 工具）** | **12,912** | **8,937** | **-31%** |

验证：进程内加载 14 工具全注册 ✓；pi_lens_activate_tools / symbol_search
实际调用成功 ✓；--check 幂等 ✓（desc+params+snippet+guidelines 合计
33,504 → 29,529 字符，-12%）。
### pi-web-access（进程内 loader 探针实测，2026-08-13）

| 工具 | 压缩前 | 压缩后 | 节省 |
|---|---|---|---|
| web_search | 1,595 | 1,004 | -37% |
| fetch_content | 369 | 327 | -11% |
| get_search_content | 120 | 98 | -18% |
| source_check | 119 | 90 | -24% |
| **合计（4 工具）** | **2,203** | **1,519** | **-31%** |

验证：进程内加载 4 工具全注册 ✓；get_search_content 实际调用成功（结构化
错误路径）✓；--check 幂等 ✓。snippet 另压 571 → 456（-20%）；
desc+params+snippet+guidelines 合计 9,359 → 8,560 字符（-9%）。
注意：目标 = index.ts（TS 源码包，进程内注册）。provider 全量名单在参数
schema 枚举里，描述中的重复名单按"冗余列表"删除，但保留 array/all/
显式选择语义、凭据要求（OpenAI/xAI）、auto-select 优先级规则与 SearXNG
偏好。fetch_content / get_search_content 的描述含 ${...} 插值（存储注记与
来源工具名动态拼接，随 toolNames 配置变化）——补丁只替换静态前缀、插值
原样保留。

### pi-mcp-adapter（进程内 loader 探针实测，2026-08-13）

| 工具 | 压缩前 | 压缩后 | 节省 |
|---|---|---|---|
| mcp | 1,478 | 1,144 | -23% |
| mcpScript | 804 | 628 | -22% |
| **合计（2 工具）** | **2,282** | **1,772** | **-22%** |

验证：进程内加载 2 工具全注册 ✓；mcp / mcpScript 探针 execute 路径返回
结构化响应 ✓（裸 loader 无 session 钩子 → not_initialized 为预期；
真实会话内 mcp({}) 状态/搜索为权威功能验证，待 pi 会话复核）；
--check 幂等 ✓。静态部分 mcp 1,193 → 859（-28%）——动态的
server/instructions 摘要是配置驱动，不可压。
注意：mcp 的 description 是运行时拼接（buildProxyDescription：静态前缀 +
Usage 块 + 配置动态段），补丁只压静态段；mcpScript 描述含
tools.search/describe/call 返回形状契约，全部保留。

### pi-agent-browser-native（跳过，2026-08-13，用户决策）

实测（进程内 loader 探针）：agent_browser 单工具 desc 519 + params 9,724 +
snippet 130 + guidelines 2,014 = 12,387 字符。参数 schema 占 78%——上游已刻意
精简（params.js 注释 "Keep descriptions terse: Pi sends this schema every
turn"；RUNTIME_PROMPT_GUIDELINES 注释 "keep small"）。对抗评估约束（参数
schema、行为约束 guidelines 不可压）下可压空间 ≈3%，-30% 判据在本扩展结构上
不可达 → 用户决策跳过，不补丁。若未来放宽约束可重开。

注意：目标 = dist/index.js（pi 桥进程内注册面）。pi-lens 另有 MCP stdio
入口 dist/mcp/server.js，是另一表面，未打补丁——lazy 工具的 description
含运行时拼接（LAZY_TOOL_CATALOG + ${catalog}），补丁脚本对 catalog 摘要
与静态 intro 分别处理，froms 多候选支持多轮收紧重放。

## 运行

```bash
# 应用补丁（双目标：server.bundle.mjs + build/server.js）
node scripts/patch-context-mode-descriptions.mjs

# 校验（幂等；exit 0 = 已应用）
node scripts/patch-context-mode-descriptions.mjs --check
```

## 重放流程（每次 `pi update --all` 后）

```bash
pi update --all          # npm 包重装 → 补丁被冲掉
node scripts/patch-context-mode-descriptions.mjs   # 重放（自动）
node scripts/patch-context-mode-descriptions.mjs --check  # 确认
node scripts/patch-hermes-memory-descriptions.mjs   # 重放（自动）
node scripts/patch-hermes-memory-descriptions.mjs --check  # 确认
node scripts/patch-lens-descriptions.mjs            # 重放（自动）
node scripts/patch-lens-descriptions.mjs --check    # 确认
node scripts/patch-web-access-descriptions.mjs       # 重放（自动）
node scripts/patch-web-access-descriptions.mjs --check  # 确认
node scripts/patch-mcp-adapter-descriptions.mjs         # 重放（自动）
node scripts/patch-mcp-adapter-descriptions.mjs --check # 确认

# 或一键全量重放（全部补丁 apply + --check，末尾汇总）：
node scripts/reapply-description-patches.mjs
```

## 验证方法（不依赖 pi 时序）

headless `pi -p -e <ext>` 测第三方扩展**不可靠**（MCP 桥异步 spawn 时序——
工具时有时无）。真相源 = **MCP stdio 握手**：

```bash
# 工具完整性 + 描述载荷（见 /tmp 探针模式）
# 1. spawn server.bundle.mjs，initialize → tools/list
# 2. 断言 11 工具全注册 + 总字符数
# 3. tools/call ctx_execute 实际执行一次
```

## 已知陷阱（补丁开发实录）

1. **bundle 混淆变量名**：插值 `${bunNote}` 在 minified bundle 里被重命名
   （`${vU}`）——NEW 描述必须**纯文本无 `${}` 占位符**
2. **单引号折叠**：无插值描述在 bundle 里折叠为单引号字符串（`\n` 转义）——
   锚定需检测引号类型（` 或 `'`），渲染时按类型转义
3. **模板内反引号**：NEW 描述含反引号（如 `` `background: true` ``）时，
   模板格式必须转义为 `\`` 防提前闭合
4. **备份**：首次 apply 前写 `*.bak-tool-descriptions`（回滚用）

## 扩展到其他扩展

1. 定位扩展的目标文件（pi 桥实际加载的 bundle）
2. 读原文（保留安全段、压缩哲学段）
3. `DESCRIPTIONS` 追加条目（纯文本、数组 join）
4. `TARGETS` 加入目标文件路径
5. 应用 + MCP 握手验证 + 功能调用验证
6. 更新本手册覆盖表

**路线图**：hermes-memory（4,982 tok）→ pi-lens（4,575）→ browser-native
（3,684）→ web-access（2,628）——同框架扩展即可。
