# openpi 工具懒加载：分类分层与重新拆分组合设计

> 状态：设计稿 → 落地中（2026-08-13，基于 v0.2.0-complete 源码 + 实测 token 数据）
> 决策：**P3（内核 deferred/setToolVisibility）永久废弃**（用户决策 2026-08-13）——
> 工程以 openpi 侧/补丁侧可做为止；P1 已完成、P2 已落地为加载组预设，见 §6。
> 背景：pi+openpi 静态载荷 40.6k tokens/轮（内核 6.3k + openpi 9.9k + 其他 12 扩展 24.4k），
> 是 omp（18.2k）的 2.2 倍。行业先例（Claude Code deferred MCP schemas）已验证
> "工具名常驻 + schema 按需"的懒加载模式。

---

## 1. 现状（源码实测）

### 1.1 openpi 24 个扩展的二元结构

| 类型 | 扩展 | 工具 |
|---|---|---|
| **工具型**（9 个，23 个注册工具） | tasks(3) goal(3) subagents(6) background-terminals(5) workflows(3) ask-user(1) context-pivot(1) plan-mode(1) setup(1) | 进模型每轮请求 |
| **系统型**（15 个，无工具） | commit-task-sync / copy-all / cron / file-search / git-info / multi-signal-sync / post-edit / session-liveness / sessions / suggestions / turn-time / ui-customization / working-indicator / model-info / file-mutation-display | 命令/UI/事件注入——不占工具载荷 |

**关键事实**：工具载荷只来自 9 个扩展；15 个系统型扩展不增加每轮 token（除 UI 渲染本身）。

### 1.2 工具描述构成（实测模式）

每个工具 = `description`（模板常量引用）+ `promptSnippet` + `promptGuidelines[]` + `parameters`（schema + 每参数 description）——**全部每轮进系统提示**（system-prompt.js 组装实证）。

### 1.3 状态关联（生命周期钩子分布）

```
tasks(9 处) subagents(6) multi-signal(6) commit-task-sync(5) ui-customization(4)
suggestions(4) post-edit(4) model-info(4) goal(4) bg(4) workflows(3) turn-time(3)
```
工具型扩展全部有会话/回合状态钩子——**状态机已存在，只差"状态→工具可见性"的映射**。

### 1.4 依赖图谱

DDD 边界 clean；shared/ 内核 20+ 纯函数模块集中承载领域逻辑（agent-types / child-session / result-delivery / session-liveness / task-reconcile / worktree / editor-strip-port…）——**领域层已分离，工具层未分层**。

---

## 2. 方法论分析

### 2.1 第一性原理：工具描述的信息价值分层

工具描述的本质 = **模型决策所需的信息**。决策分两级，信息价值不同：

```
决策 1「要不要用这个工具」 → 需要：工具名 + 触发条件（何时用）
决策 2「怎么用」           → 需要：完整 schema + 参数约束 + 行为规则
```

**现状把两级信息打包全量每轮注入**——决策 2 的信息（最大头）在决策 1 未发生时即被消耗。懒加载 = **按决策时刻供给信息**：
- 决策 1 常驻（名 + 一行触发条件）
- 决策 2 按需（被选中后才拿 schema）

行业实证：Claude Code "deferred MCP tool schemas: only tool names enter context until a tool is used"；iternal.ai "tool search / dynamic tool loading can reduce context overhead by 85%"。

### 2.2 MECE：工具分类的穷尽维度

三维正交（互斥穷尽）：

| 维度 | 分档 | 判据（源码可测） |
|---|---|---|
| **A. 使用频率** | 高频 / 条件性 / 低频 | 会话每轮可用性；运行状态依赖 |
| **B. 状态依赖** | 无状态 / 入口型 / 运行态操作 | 是否有运行实体（subagent/terminal/workflow） |
| **C. 参数复杂度** | 轻（<200 字符） / 重（>500） | schema + 参数描述大小 |

→ 分类矩阵（9 个工具扩展的 23 工具）：

| 域 | 高频常驻 | 条件激活（有运行实体） | 低频/一次性 |
|---|---|---|---|
| tasks | tasks_add/update/list（3） | — | — |
| goal | create_goal/get_goal/update_goal（3） | — | — |
| subagents | subagent_spawn（入口） | subagent_wait/send/check/list/cancel（5） | — |
| background-terminals | bg_start（入口） | bg_status/list/kill/watch（4） | — |
| workflows | workflow（入口） | workflow_status/stop（2） | — |
| ask-user | — | — | ask_user（1） |
| context-pivot | — | — | context_pivot（1） |
| plan-mode | — | — | plan_ready（1） |
| setup | — | — | configure_my_pi_setup（1） |

**MECE 结论**：23 工具 = 7 常驻 + 11 条件激活 + 5 低频——**常驻只需 7 个（~30%）**。

### 2.3 Ontology：工具是实体操作的投影

工具本体的本质 = **实体 + 操作**（实体活跃性驱动工具可用性）：

```
实体           操作模式                          状态机
Task           CRUD（add/update/list）            pending→in_progress→blocked→done/dropped
Goal           生命周期（create/get/update）       active→complete/blocked
Subagent       入口+运行态（spawn→wait/send/...）  queued→running→settled
Terminal       入口+运行态（start→status/kill）    running→settled（含 pending 交付）
Workflow       入口+运行态（launch→status/stop）   running→settled/aborted
UserQuestion   一次性                           —（无状态）
Pivot          一次性                           —（>30k 阈值）
PlanMode       一次性                           —（模式切换）
Setup          一次性                           —（配置）
```

**本体论发现**：11 个"条件激活"工具全部是**运行实体上的操作**——实体存在 ↔ 操作可用。这给出懒加载的**精确触发信号**：`实体计数 > 0`（subagents manager 的 running 数、bg manager 的 running 数、workflows 的 activeRuns.size——**全部已有可订阅的公开状态**，见 shared/session-liveness.ts 的 setRunningSubagents/setRunningWorkflows）。

### 2.4 Owner 方法论（责任划分）

按开发宪章 owner 分层：每个能力域有明确 owner，owner 负责其工具的**生命周期与可见性**：

```
域          Owner 载体（源码）              可见性职责
tasks       extensions/tasks               常驻（会话级状态，owner=会话任务）
goal        extensions/goal                常驻
subagents   extensions/subagents           spawn 常驻 + 5 操作按 running>0 激活
bg          extensions/background-terminals start 常驻 + 4 操作按 running>0 激活
workflows   extensions/workflows           launch 常驻 + 2 操作按 activeRuns>0 激活
一次性域    各自扩展                         按需（schema 查询）
```

**owner 维度结论**：可见性规则与域状态机一一对应——每个域 owner 只需要声明"我的操作工具绑定哪个实体计数"。

---

## 3. 参考方案对比（pi.dev / omp / 其他开源）

| 方案 | 机制 | 可借鉴点 | 局限 |
|---|---|---|---|
| **Claude Code** | deferred MCP schemas：工具名常驻、schema 按需 | 两级信息供给的**官方实证**；MCP 工具 40-50% 上下文开销被消除 | 仅 MCP 工具；原生工具仍全量 |
| **pi.dev（内核）** | selectedTools（启动参数 -nt/-nbt）+ registerTool 加载时注册 | 已有多工具显隐的雏形 | 无运行时切换、无 schema 级懒加载 |
| **omp** | --tools 过滤 + 工具加载架构 | 用户侧工具选择的 CLI 先例 | 静态选择，非状态驱动 |
| **Cline** | 上下文条 + 自动压缩 | 上下文预算的可见性 | 不解决工具描述本身 |
| **Aider** | repo map 按需（文件映射懒加载） | "信息按需获取"的工程先例 | 领域不同（文件 vs 工具） |
| **LangGraph** | 状态化工具选择（tool_node 按状态路由） | 状态驱动工具可见性的模式 | 框架级，非 harness 级 |

**综合结论**：Claude Code 的 deferred 模式 = 终极形态（需内核支持）；omp/pi 的选择机制 = 静态中间态；**openpi 当前可自做的 = 状态驱动的描述分级 + 入口/操作拆分**。

---

## 4. 分层设计（L0/L1/L2）

```
┌─ L0 内核常驻（每轮 ~2-3k tokens）──────────────────────────────┐
│  7 工具完整描述：tasks×3 + goal×3 + plan_ready               │
│  理由：会话级状态、每轮可能使用、无运行实体依赖                  │
├─ L1 条件激活（实体活跃时注入，激活集 ~1.5-2.5k tokens）─────────┤
│  11 操作工具短描述（名称+触发条件+参数名）：                     │
│  subagent_wait/send/check/list/cancel   ← running>0 激活      │
│  bg_status/list/kill/watch              ← running>0 激活      │
│  workflow_status/stop                   ← activeRuns>0 激活   │
│  触发信号：shared/session-liveness 计数（已存在、已订阅）       │
├─ L2 按需查询（工具名+一句话常驻，schema 按 describe 拉取）──────┤
│  低频 5 工具：ask_user/context_pivot/configure_my_pi_setup    │
│  + 全部 L1 工具的完整参数 schema                              │
│  机制：内核 describe_tool(name)（Claude Code 模式）           │
└──────────────────────────────────────────────────────────────┘
```

**期望收益**（基于实测 9,855 openpi 增量）：

| 层 | 现状 | 设计后 | 省 |
|---|---|---|---|
| L0 常驻 | — | ~2.5k | — |
| L1 激活（典型无实体） | 全量 9.9k | +0（未激活） | **-75%** |
| L1 激活（有实体） | 全量 9.9k | ~4.5k | -55% |
| L2 按需 | 全量 9.9k | ~1.5k | **-85%**（需内核） |

---

## 5. 重新拆分组合

### 5.1 扩展包重组（无内核改动即可落地的一半）

按**加载单位**重拆 openpi 的 settings 条目：

```
openpi-core（常驻）         tasks + goal + plan-mode        ~2.5k/轮
openpi-runtime（条件）      subagents + bg + workflows      ~2-3k/轮（描述分级后）
openpi-utility（低频）      ask-user + context-pivot + setup
openpi-system（无工具）     15 个系统型扩展（现状不变）
```
→ 用户按任务形态选择加载（纯编码会话只挂 core；编排会话挂 core+runtime）。

### 5.2 工具描述分级（openpi 侧立即实施）

- **入口工具**（spawn/start/workflow）：完整描述（模型需要知道怎么发起）
- **操作工具**（wait/kill/stop…）：短描述（"管理运行中的 X"）+ 参数名列表，行为规则移入代码注释
- **promptGuidelines 降级**：行为约束从"每轮注入"改为"结果/错误信息里动态提示"

### 5.3 内核提案（已废弃，2026-08-13 用户决策）

> P3 永久废弃：deferred schema 与 setToolVisibility 依赖上游内核，用户决策不再推进。
> 本节仅留作历史记录；工程收益以 §6 的 P1/P2 + 第三方描述补丁为终态。

1. `ToolDefinition.deferred?: boolean`——deferred 工具只进索引（名+一行），schema 经 `describe_tool(name)` 拉取
2. `setToolVisibility(names, visible)`——运行时工具显隐（状态驱动，openpi 的 L1 触发信号直连）
3. 提案数据支撑：本设计 + 实测 9.9k→1.5k 的预期（-85%）

---

## 6. 落地路径与风险

### 路径（2026-08-13 落地状态）

1. **P1（已完成）**：静态描述压缩 **-4.5%**（pi 实测 33,741→32,223 字符，
   commit 958a2a9；提交信息中的 -13% 为笔误口径，已纠错。参数 schema 为不可压天花板）
2. **P2（已落地）**：包重组以**加载组预设**形式落地——`/openpi-setup` 新增
   `extension_load_group`（all / core-runtime / core），切换时重写包 manifest 的
   `pi.extensions` 清单，`/reload` 生效（extensions/shared/setup-config.ts +
   extensions/setup）。"状态提示注入"依赖内核工具显隐 → 随 P3 一并废弃。
3. **P3（已废弃）**：deferred schema + setToolVisibility（用户决策 2026-08-13）
4. **第三方描述补丁（B 方案，已完成）**：context-mode / hermes-memory / pi-lens /
   web-access / mcp-adapter 五扩展 -16,970 字符 ≈ -4.2k tok；browser-native 与
   cc-safety-net / pi-cc-patch 按用户决策不补丁。全局实测见
   docs/token-payload-report.md（40.6k → ~36.0k tok，整体 -11.3%；真实会话
   端到端 -10.5% ≈ -4,267 tok/轮）。

### 风险
| 风险 | 缓解 |
|---|---|
| 短描述→低频工具发现率下降 | L1 工具在激活时给完整描述；索引层保留"存在性" |
| 状态切换竞态（实体刚消失工具仍在） | 触发信号用已订阅的公开计数；调用时实体不存在→友好错误（现状已有） |
| promptGuidelines 降级→行为漂移 | 约束留在代码路径（execute 内校验）+ 结果文本提示 |
| 内核提案被拒 | P1/P2 独立成立，不依赖 P3 |

### 验收指标
- 无运行实体会话：openpi 载荷 9.9k → ≤5k（实测）
- 有运行实体会话：激活集 ≤4.5k
- 功能回归：23 工具全部可用路径 0 变化（入口工具完整描述）
