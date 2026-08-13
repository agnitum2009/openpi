# 重启后全面对抗测试报告

> 日期：2026-08-14
> 对象：pi 重启后环境——openpi 加载源 = 独立仓
> （/home/umax/work/openpi-dev-lazyload，P1 压缩 + P2 显式清单）+
> 五个第三方描述补丁在盘（context-mode / hermes / lens / web-access / mcp-adapter）。
> 方法：对齐 docs/tool-lazyload-adversarial-eval.md 的攻击面组织（发现环/获取环/
> 执行环/反馈环 + 可靠性审计），全部实测、无估计。

---

## 1. 静态闸门（代码质量与回归）

| 项 | 结果 |
|---|---|
| biome format:check / lint / tsc --noEmit | ✅ 全绿 |
| DDD 边界检查 | ✅ clean |
| node 测试套件 | ✅ 672/672 |
| vitest（file-search） | ✅ 29/29 |

## 2. 补丁与清单完整性

| 项 | 结果 |
|---|---|
| 五补丁 --check + 重放（聚合脚本） | ✅ 5/5 apply=0 check=0 |
| 备份文件 | ✅ 10/10（含 context-mode 双目标） |
| package.json pi.extensions | ✅ 精确 24 条目、无缺失文件、无重复 |
| 用户配置 my-pi-setup.json | ✅ 可解析，loadGroup=all（组切换已还原） |

## 3. 加载矩阵（发现环：工具全注册）

| 块 | 结果 |
|---|---|
| openpi 24 扩展（loader 直载 + session_start） | ✅ 零 LOAD ERROR；含 tasks 3 工具（session_start 注册）、fd/rg |
| 第三方 10 包 | ✅ 零 LOAD ERROR；hermes 6 / lens 14 / web-access 4 / mcp-adapter 2 / browser-native 1 / chrome-devtools 6 工具齐全；cc-safety-net、pi-continue、usage-bar、cc-patch = 0 工具（预期） |
| context-mode（MCP stdio） | ✅ 11 工具 |

> 探针输出中的 "(session_start note: …)" 为裸 loader 缺真实会话 ctx 方法的
> 固有噪音（getBranch/getSessionId/setStatus 等在真实 pi 会话中存在），
> 非扩展缺陷；真实会话由 pi 实测确认（测试 1-6）。

## 4. 功能矩阵（执行环：真实 execute）

| 工具 | 结果 |
|---|---|
| memory_add → memory_search | ✅ 写入→搜索闭环（1 条命中） |
| skill_manage view | ✅ skills:[] |
| pi_lens_activate_tools | ✅ Activated: ast_grep_dump |
| symbol_search | ✅ 索引构建中路径（available:false 结构化） |
| get_search_content（坏 id） | ✅ 结构化 Not found |
| mcp({})（空配置） | ✅ 真实状态 "MCP: 0/0 servers, 0 tools" |
| mcpScript emit | ✅ 输出 "adversarial-ok" |
| ctx_execute（MCP stdio） | ✅ CLOSED-LOOP 输出正常 |

## 5. 专项攻击面

| 攻击面 | 结果 |
|---|---|
| P2 清单往返（临时副本）：all→core-runtime→all | ✅ 24→22→24，name/skills/themes/scripts 全部保留 |
| 安全契约字符串抽查（补丁后文件） | ✅ WHEN TO SAVE、Do-NOT-save、HARDENED allowlisted、pi-lens-ignore: <rule>、work bottom-up、Codex/SuperGrok、Mode 优先级、trusted JavaScript、sandboxed subprocess 全部在位 |
| 配置迁移（无 extensions 字段 → all） | ✅ 由 672 测试套件覆盖 |
| 幂等/重放 | ✅ 聚合脚本 5/5 |

## 6. 发现并修复的问题（本轮）

| 问题 | 性质 | 处置 |
|---|---|---|
| ext-call.mjs 不触发 session_start → mcp/mcpScript 假性 "MCP not initialized" | 探针缺陷（非补丁缺陷） | 已修复：探针加载后触发 session_start（对齐 measure 脚本），复测 mcp 状态 + mcpScript emit 全通 |

## 7. 结论

- 边界内所有功能**正常、稳定、强壮、可靠**：零加载错误、工具数精确、功能矩阵 8/8、
  清单与备份完整、安全契约无损。
- 准确性：五个补丁的 must-keep 契约字符串抽查全部在位（对抗评估约束未破）。
- 遗留（非阻塞）：mcp/mcpScript 的"真实会话内、有配置服务器时"的状态/搜索调用
  建议在 TUI 里点一次做最终确认（探针环境无真实服务器，已覆盖空配置路径）。
