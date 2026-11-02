# DeepSeek Harness 插件迁移调研

调研日期：2026-11-01（北京时间）。下文保留迁移前的调研结论；随后已基于本机 0.2.1-rc.5 的真实 SDK 实施插件、构建与隔离宿主验收，实际交付状态见 [DSH 验收记录](dsh-migration-acceptance.md)。`master` 与 RC 接口存在差异，实施以锁定版本为准。

## 结论

架构上可行：让减脂领域逻辑共用，保留 pi Extension，新增 DeepSeek Harness（下称 DSH）插件。当前未发现必须删除 pi 才能接入 DSH 的技术要求。这是基于接口与项目代码的工程判断，不代表已经完成运行兼容验证。

建议按用户偏好，以 DSH 为主要迁移目标；pi 作为兼容入口保留。先在 DSH 原生界面完成业务闭环，再决定是否将现有 Vue 聊天页接到 DSH。双插件、双界面、旧聊天历史无损迁移是三个独立目标，投入不同。

## 文档时效与版本

- 文档入口从 [DeepSeek 官网 Harness 页面](https://www.deepseek.com/zh/harness/) 跳转确认，使用 [官方开发者文档](https://deepseek-harness.github.io/deepseek-harness/develop/basic/) 和 `deepseek-ai/deepseek-harness` 仓库，未以社区教程作为 API 依据。
- 调研时 [官方 Releases](https://github.com/deepseek-ai/deepseek-harness/releases) 顶部列出 `v0.2.1-rc.5`（10 月 30 日）和 `v0.2.2-alpha.2`（10 月 28 日），均标为预发布。这里记录的是发布页观察结果，未核验 npm dist-tag 或用户安装版本。
- [官方 README](https://github.com/deepseek-ai/deepseek-harness/blob/master/README.zh.md) 明确仍处于开发者预览，并预告可能出现破坏兼容的变更。正式实施前应锁定一个版本/提交，重新检查对应类型与示例；本报告涉及 `master` 的 API 不能直接视为上述 RC 版本的承诺。

## DSH 插件如何开发

### 入口、依赖与资源生命周期

DSH 插件可导出 `name`、`inject` 和 `apply(ctx)`，通过 Cordis 上下文注册能力；`inject` 声明所需服务。SQLite 连接等自行创建的资源应通过 `ctx.effect()` 提供清理函数。不能把 pi 的会话退出事件直接改成关闭整个 DSH 插件的共享连接。[官方入门教程](https://deepseek-harness.github.io/deepseek-harness/develop/basic/)

对本项目的建议：同一插件实例共享业务仓储连接，每个减脂会话拥有独立记忆调度器。会话释放停止自己的后台任务，插件卸载再关闭自身拥有的数据库连接；具体清理顺序需测试。

### 工具协议

模型工具由 `ctx.tools.register()` 注册。当前官方 `defineTool` 使用参数描述、`output.schema`、返回规范 JSON 值的 `execute(args, exec)`，以及生成模型可见内容的 `output.render`。UI 所需持久元数据可通过 `output.presentationMeta` 提供。[工具编写参考](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-tool.zh.md)

这与本项目 pi 工具返回的 `{ content, details, terminate? }` 不同，不能只替换包名。同名 `defineTool` 不是同一套协议。DSH 当前源码还显式要求工具声明输出契约。[工具注册源码](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/tools/src/index.ts)

建议只抽取需要共用的业务操作，分别编写两端的参数与结果包装。TypeBox 仍可用于共享业务校验；不必为了迁移把整个项目改成 DSH schema。暂不建设能转换所有 schema 的通用框架。输出中的 `undefined` 需要按业务选择省略或改成明确的 `null`。

### 专用 Agent 与作用域

DSH 的 preset 可以组合工具、提示词和技能；同一进程允许多种组合。因此可以提供一个独立减脂 preset，避免给所有编程聊天都注入减脂人设和记忆。[Preset 官方说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/preset/agent-preset-registry/README.zh.md)

注意：当前 `ctx.tools.restrict()` 要求 agent 作用域，主要过滤全局工具，作用域内另行注册的工具仍然可见。因此需要对实际工具集合做验收，不能把 pi 的 `setActiveTools()` 机械翻译成一次全局 restrict 调用。[工具限制源码](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/tools/src/index.ts)

### 提示词、记忆与辅助模型请求

`ctx.systemPrompt.section()` 提供有序提示词段，动态上下文另有 provider 机制，可作为共享减脂规则与当前记忆的接入点。[系统提示词说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/system-prompt/README.zh.md)

生命周期应按 DSH 的真实语义重新连接：`agent/status`、收件箱事件和 `whenIdle()` 用于协调活动与停稳，不能将某个 `turn/end` 一概视为 pi 的 `agent_settled`。公开 Agent 支持创建、恢复、取消和作用域注册。[Agent 官方说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/agent/README.zh.md)

记忆提取与报告总结可通过 DSH 的 `ctx.llm.stream()` 接入模型服务，再适配为现有的文本生成依赖；不要调用主会话来生成这些后台结果。[LLM 服务说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/llm/llm/README.zh.md)

### 命令与问卷

DSH 提供 `ctx.commands.register()`，可承接 `/profile`、`/memories` 等直接操作；该命令面针对交互式 UI，不能假定所有无界面集成都具备它。[命令说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/interaction/commands/README.zh.md)

DSH 另有 `ctx.userQuestions`，支持结构化问题、选项与自由输入，以及等待/续答流程，可用于建档与食物分量澄清。[用户交互参考](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/user-questions.zh.md)

两端问卷编码不同：项目选项有独立 `value`，DSH 文档中的选中值使用选项标签；需要映射，不能假定返回对象一致。现有 Web `terminate: true` 的结束当前回合行为也须重新实现并验证取消与迟到回答。

### 界面与安装

DSH 可通过客户端插件扩展聊天业务节点及渲染器。官方 Conversation 示例使用 React 客户端能力，现有 Vue 单文件组件不能作为这些节点直接加载；仍可选择保留独立 Vue 网站，通过后端桥接。[Conversation 扩展参考](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/conversation.zh.md)

正式分发建议使用 bundle：包声明 `dsh.bundle.patch`，由 patch 装配插件；发布文档支持 npm 包及预构建 tarball 安装，并提供 `engines.dsh` 兼容范围声明。开发阶段可以先使用本地 patch。[打包与安装教程](https://deepseek-harness.github.io/deepseek-harness/develop/basic/publish)

## 当前项目的迁移范围

以下来自本地代码检查，而非对 DSH 的运行测试。

| 当前部分 | 复用判断 | 实施内容 |
|---|---|---|
| `src/profile.ts`、`src/energy-calculation.ts` | 高 | 保持计算与校验规则 |
| `src/database.ts`、`src/daily-record-store.ts`、`src/memory-store.ts` | 高 | 保持表结构；显式传入数据路径，适配资源归属 |
| `src/knowledge/`、`knowledge_doc/` | 高 | 保留 Chroma 与嵌入服务，适配配置及工具结果 |
| `src/reports/` | 高 | 已有 `SummaryGenerator` 注入点，替换调用模型的包装 |
| `src/tools/*.ts` | 业务可复用，工具外壳需改 | 当前使用 pi `defineTool`；拆出操作，分别包装 |
| `.pi/extensions/fatloss-agent.ts` | 保留为 pi 入口 | 新增 DSH 入口，避免两端各复制整套业务 |
| `.pi/SYSTEM.md` | 主要内容可复用 | 抽取共用规则；改写命令、问卷、报告链接等宿主约定 |
| `src/memory-runtime.ts` | 调度主体可复用 | `MemoryCoordinator` 已注入外部能力，但文件仍包含 pi 导入；拆开调度与 pi 接线 |
| `src/tools/memories.ts` | 部分复用 | 目前从 pi 当前分支读取用户证据；新增 DSH 消息来源适配 |
| `src/calorie-researcher.ts`、`src/nutrition-estimation.ts` | 部分复用 | 接口仍带 `ExtensionContext`，默认实现创建 pi 子会话；需 DSH 检索实现 |
| `src/onboarding.ts`、`src/tools/ask-user.ts` | 校验和字段可复用 | 重接 DSH 问卷，覆盖取消、断线和续答 |
| `src/server/conversation-registry.ts`、`agent-stream.ts`、`messages.ts` | 与 pi 耦合较深 | 若现有 Web 要切换到 DSH，需要会话和流协议适配 |
| `web/src/` 的建档、画像、报告页 | 可按接口保留 | 若嵌入 DSH 原生 UI，则另做客户端视图 |
| pi JSONL 聊天记录 | 暂不承诺直接续聊 | 与 DSH 会话模型分开处理，可先归档查询，另立历史导入任务 |

本地还有两个容易遗漏的依赖：报告工具直接调用 `ctx.modelRegistry.complete()`，联网估算使用 `@pi-plugins/websearch`。只迁移扩展入口仍会留下 pi 运行时依赖。

## 必须验证的行为差异

1. **记忆上下文的持久化。** 当前 pi 接线每次读取有效记忆，注释明确不追加到聊天历史；DSH 动态上下文有持久快照语义。须验证更新、过期和删除后，下一步有效上下文是否正确，不能承诺删除 SQLite 记录等同于删除旧日志。[DSH 上下文类型源码](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/system-prompt/src/index.ts)
2. **真实用户证据。** DSH 的 `followup`、`steer`、`inject` 都可以投递 user 角色消息。记忆适配必须结合消息来源识别人类原话；仅看 `role === "user"` 可能误收提示词快照、调度或插件通知。[Agent 消息语义](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/agent/README.zh.md)
3. **检索子 Agent 的能力隔离。** 官方 spawn 后端不继承父聊天，但会复用宿主服务，并有自己的 preset；父 agent 的局部工具限制不会自动带给子级。必须配置独立检索组合并验证仅有预期检索能力，不能访问画像和写库工具。[Spawn 后端说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/subagent/subagent-spawn-in-process/README.zh.md)
4. **数据位置。** `ProfileRepository` 默认以 `process.cwd()` 定位数据库。在 DSH 宿主中可能指向其他工作区，因此必须明确选择既有数据目录或迁移副本；Chroma、食物数据和报告地址也要核对。
5. **同时运行。** 双插件可用不代表可以无条件共享所有运行状态。初期分别拥有聊天记录，先顺序访问同一业务库；跨进程写库、记忆版本冲突和后台重复提取要单独验证。
6. **报告链接。** 现有工具输出 `/reports/:id`，在 DSH 页面中会指向 DSH 自己的站点。需提供可访问的业务站点地址，或适配 DSH 客户端页面。
7. **原生 SQLite。** 当前使用 `node:sqlite`；必须核对目标 DSH 启动环境的 Node 版本与模块可用性，包括桌面环境，不能只凭本机 Node 24 可用就推断所有发行形态都可用。

## 推荐实施顺序与验收

建议结构仅表达依赖方向，不要求立即重排整个仓库：

```text
共用领域代码：画像 / 每日记录 / 计算 / 记忆仓储 / RAG / 报告
    ├── pi 接线与工具包装 → 既有 TUI、既有 Web
    └── DSH 接线与工具包装 → 减脂 preset、DSH 原生界面
```

1. **最小可行验证。** 锁定 DSH 版本；用临时 SQLite 副本接入读取画像、能量计算、一次饮食记录和查询。验证真实模型能调用工具，数值与现有领域逻辑一致，卸载后能重新加载，且不会影响其他 Agent。
2. **完整业务迁移。** 补齐饮食/运动修改与删除、RAG、报告、建档和问卷。沿用领域测试，两端适配分别验证参数错误、取消和持久结果。DSH 先用通用工具卡片与文本报告，专用表单视图后续补齐。
3. **记忆与检索迁移。** 验证批量/空闲提取、输入打断、释放后禁止迟到写库、消息证据映射、忘记与过期语义；验证检索子级的实际可用工具及结构化结果。
4. **保留 pi 的回归验证。** 同一业务用例在两端产生相同领域结果；各自聊天记录独立。完成仓库要求的后端类型检查与测试，涉及 `web/` 再执行前端检查、测试与构建。
5. **分发与界面决策。** 打包为独立 DSH bundle，在干净 profile 安装；验证构建产物包含业务模块与所需静态资源，再明确支持的宿主版本范围。若保留现有 Vue 聊天体验，则继续实现 DSH → 既有 `/api` / AI SDK UI Message Stream 适配。

第 1 步是实施前最有价值的验证：能够尽早发现 schema、作用域、SQLite 或版本问题。当前没有证据需要为迁移先放弃 pi；若后续兼容维护成本过高，可依照用户优先级停止维护 pi 接线，保留同一份业务核心与 DSH 插件。

## 本次交付边界

已完成官方文档检索、部分官方源码核对、本地耦合点分析与迁移验收设计。没有安装依赖、操作真实业务数据库、启动 DSH、修改业务实现或执行迁移；由于仅新增调研文档，未运行业务测试。运行兼容性、确切版本支持范围、旧聊天导入和完整 UI 保真仍待实施验证。
