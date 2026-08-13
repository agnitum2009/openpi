# 第三方扩展工具描述补丁——运行手册

> 状态：context-mode 已闭环（2026-08-13）
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
