# 项目长期笔记

## 架构现状

- 减脂陪伴 Agent 以 **pi 扩展**形式实现：`.pi/extensions/fatloss-agent.ts`，跑在 pi CLI/TUI 里（`npm run tui`）。
  不是自建宿主——项目里没有 `createAgentSession` 调用。
- 扩展负责：`pi.registerTool`（画像/记忆/知识检索工具）、`pi.registerCommand`（`/onboard`、`/profile`）、
  `pi.on` 生命周期钩子（记忆 runtime：`input` / `context` / `agent_settled` / `session_*`）。
- 数据：SQLite（`data/fatloss.sqlite`）+ Chroma（`data/chroma/`）。
- SDK 实装版本 **0.85.1**（`package.json` 锁定）；技能文档基线仍是 0.83.0。

## 数据存储注意

- SQLite 用 Node 内置 `node:sqlite` 的 `DatabaseSync`（`src/database.ts`），**未显式开启 WAL**。
  若将来 Python 后端与 pi 进程（TS 扩展）同时读写 `data/fatloss.sqlite`，必须先开 WAL，
  否则默认 journal 模式下跨进程写入会锁冲突。

## 小马的技术选型偏好

- Web 后端想用 **Python** 写（明确理由：想锻炼 Python 能力），不倾向写 Node。
- 注意硬约束：路线 C「进程内嵌 SDK」**只能用 Node.js**，与 Python 后端互斥；
  要 Python 后端就只能走 RPC（pi CLI 当宿主）或「Python 主后端 + Node 薄 Agent 服务」双层。

## WebUI / App 对接调研结论（2026-09-18）

**pi 自带 RPC 模式**（`pi --mode rpc`），JSONL over stdio，官方定位就是"嵌入其他应用 / 自定义 UI"。这是对接的现成通道。

三条路线：
- **A. pi-web**（github Epsilondelta-ai/pi-web，Go+Astro 单二进制）：0 改动，支持 inline 回答扩展的
  select/input 对话框、有移动端响应式 UI、AG-UI SSE 端点。缺点是通用 coding agent 风格（文件树/Git/Shell）。
- **B. 自建前端 + RPC 子进程**：改 2 行 + 写 Node 后端做 JSONL↔SSE 转发。最快见效。
  官方有 `RpcClient`（`dist/modes/rpc/rpc-client.js`，类型完整）但**未从 index.d.ts 导出**，属内部 API。
- **C. 自建宿主 `createAgentSession`**（官方推荐给 Node 用户，dg-piagent 作者教程也选这条）：单进程、无 IPC、
  可控性最强。但见下方「建档问卷陷阱」。

### ⚠️ 建档问卷陷阱（自建宿主 C 方案下会真出 bug，已用源码证实）

`runner.js:270`：`uiContext = uiContext ? wrap(...) : noOpUIContext`；`runner.js:319`：`hasUI() = uiContext !== noOpUIContext`。
SDK 直调不注入 UI context 时，`noOpUIContext` 的行为是：
`select → undefined`、`confirm → false`、`input → undefined`（全部静默，不报错）。

对照 `src/onboarding.ts`：
- `choose()` 拿 undefined → 转 null → 建档静默取消（用户以为没反应）
- `collectProfile()` 第 117 行 `ctx.ui.confirm(...)` 返回 false → `while(true)` 重新循环 → **死循环**

结论：**走 C 方案必须先解决建档**。两个办法：(1) 注入 UI context（`setUIContext` 非公开导出）；
(2) 建档前端化——Web/App 原生表单收集 12 项直接写库，agent 只通过 `get_current_profile` 读。后者才是正解：
对话框式建档本来就是 TUI 的妥协，Web 上应该用真正的表单（滑块/日期/多选卡片）。

**必须改的两处阻塞点**（都是硬编码的 tui 判断）：
- `src/onboarding.ts:170` `if (ctx.mode !== "tui")` → 改 `if (!ctx.hasUI)`
- `.pi/extensions/fatloss-agent.ts:55` `ctx.mode === "tui"` → 改 `ctx.hasUI`

**兼容性已核实**：
- 建档只用了 `select / input / confirm / notify`，RPC 模式全部支持（转成 `extension_ui_request` /
  `extension_ui_response` 子协议）→ 问卷天然能变 Web 表单。
- 记忆模块的 `pi.on("input")` 等事件在 ExtensionRunner 层派发（runner.js），与运行模式无关 → RPC 下正常。
- 工具注册、命令注册与 mode 无关；RPC 的 `get_commands` 能列出扩展命令供前端渲染。

**约束**：RPC 是 stdio，移动端跑不了 node 进程 → App 必须 C/S，与 WebUI 共用同一个 HTTP+SSE 后端。
单 pi 进程 = 单会话；自用够，多用户要每会话一进程。
