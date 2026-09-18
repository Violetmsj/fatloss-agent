---
name: dg-piagent
description: |
  pi-agent SDK（@earendil-works/pi-coding-agent / @earendil-works/pi-ai）的离线文档检索器。
  当用户问 pi-agent 的 API 怎么调、某类型有哪些字段/方法、某个事件何时触发、扩展如何拦截工具调用、
  session 如何持久化、compaction / provider / 工具白名单等机制如何工作时，先在本技能的 references/
  里定位（scenarios 按意图查、sdk_doc 按 API 查），再回 node_modules 源码核实后再作答。
  触发关键词：createAgentSession、AgentSession、session.subscribe、session.prompt、pi.on、defineTool、
  ExtensionAPI、DefaultResourceLoader、SessionManager、SettingsManager、ModelRegistry、ModelRuntime、
  pi-coding-agent、pi-ai、@earendil-works、事件类型、工具白名单、compaction、SSE 流式、多 Agent。
  只做「查文档 + 核实」，不主动引导安装、升级、脚手架搭建或打包发布 pi-agent 应用。
---

# pi-agent SDK 文档检索

## 干什么 / 不干什么

**干**: 回答 pi-agent SDK 的 API 与机制问题。检索顺序固定为「意图总表 → SDK API 索引 → node_modules 源码兜底」，
查到就引文件、给结论；查不到就明说查不到，不凭空推断。

**不干**: 不引导 `npm install`、版本升级评估、项目脚手架、`.pi/` 目录规划、打包发布。
用户明确问这些时才处理，且要说明这不是本技能的主场。

## 版本漂移提醒 ⚠️

`references/` 下的文档对齐到 **pi-coding-agent v0.83.0**，本仓库实装 **0.85.1**。

- 文档与源码冲突时，**以 `node_modules/@earendil-works/**/dist/**/*.d.ts` 为准**，并顺手指出文档过期点。
- 涉及 0.83 → 0.85 之间可能变动的 API，优先走源码兜底协议的第 3 层。
- 遇 `pi-ai` import 失败，先查 `node_modules/@earendil-works/pi-ai/dist/compat.d.ts` 的 `export *` 列表，确认符号归属哪个入口。

## 核心心智模型（帮助定位文档）

```
createAgentSession()  ← 组装入口(Provider + 工具 + 资源)
       │
       ├── session.prompt(text)          ← 驱动 Agent 主循环
       │
       ├── session.subscribe(handler)    ← 外部订阅层
       │     多数事件与扩展层共有(turn_*/message_*/tool_execution_*/agent_start/agent_end/agent_settled)
       │     外部层独有: queue_update / compaction_* / session_info_changed 等 session 状态事件
       │
       └── 扩展(pi.on)                   ← 内部扩展层
             扩展独有(仅这 6 个 subscribe 收不到):
               context / tool_call / tool_result / before_agent_start / input / model_select
```

**最大集成坑**: `context` / `tool_call` / `tool_result` / `before_agent_start` / `input` / `model_select` 这 6 个是**扩展独有事件**，
用 `session.subscribe` 监听会**静默失败**（handler 被调用但 type 分支永不命中，无报错），必须写成扩展走 `pi.on`。
详见 [04-events.md](references/sdk_doc/04-events.md)。

> 需要"agent 真正结束"信号时订阅 **`agent_settled`** 而非 `agent_end`——前者保证所有 retry/compaction/queue 处理完才触发，
> 每 prompt 一次，两层都派发。详见 [04-events.md 坑 1](references/sdk_doc/04-events.md#坑-1不要把-agent_end-当成流程结束的唯一信号)。

---

## 检索第一步：意图总表

按「我要知道什么」找文件。场景编号保留在文件名，向后兼容。

### 1. 启动与组装

| 我想知道... | 详见 |
|--------|------|
| 最简跑起来的写法 | [A01](references/scenarios/A01-minimal-startup.md) |
| 选模型 / 推理深度 | [A02](references/scenarios/A02-model-selection.md) |
| 改系统提示词 / 人设 | [A03](references/scenarios/A03-system-prompt.md) |
| 指定 cwd | [A05](references/scenarios/A05-custom-cwd.md) |
| 加载 `.pi/` 目录扩展文件 | [A06](references/scenarios/A06-load-extensions.md) |
| 完全手动组装所有组件 | [H01](references/scenarios/H01-full-control.md) |

### 2. 工具系统

| 我想知道... | 详见 |
|--------|------|
| 写自定义工具(查 DB/调 API) | [D01](references/scenarios/D01-custom-tool.md) |
| 工具白名单(禁用部分工具) | [A04](references/scenarios/A04-tool-whitelist.md) |
| 动态注册 / 覆盖内置工具 | [D02](references/scenarios/D02-dynamic-tools.md) |
| 工具调用前确认(安全闸门) | [D04](references/scenarios/D04-confirm-destructive.md) |
| 工具结果自定义渲染 | [D05](references/scenarios/D05-tool-result-render.md) |
| 限制工具只在特定目录执行 | [D06](references/scenarios/D06-protected-paths.md) |

### 3. 扩展与事件 ⭐(最常用)

| 我想知道... | 详见 |
|--------|------|
| 写一个完整的扩展 | [E02](references/scenarios/E02-extension-basics.md) |
| 拦截 / 修改工具调用 | [E01](references/scenarios/E01-tool-intercept.md) |
| 在生命周期阶段触发逻辑 | [E04](references/scenarios/E04-lifecycle-hooks.md) |
| 拦截 / 变换用户输入 | [E05](references/scenarios/E05-input-transform.md) |
| 流式处理工具输出 | [E06](references/scenarios/E06-streaming-transform.md) |
| ⭐ **Web/SSE 流式进度集成** | [E11](references/scenarios/E11-sse-progress-streaming.md) |
| turn 开始时预加载数据 | [G04](references/scenarios/G04-preload-context.md) |

### 4. 持久化与会话

| 我想知道... | 详见 |
|--------|------|
| 持久化会话 / 断点续聊 | [F01](references/scenarios/F01-session-persistence.md) |
| 运行时切换 / 恢复 / 分叉 | [F02](references/scenarios/F02-session-runtime.md) |
| 中止正在运行的 prompt | [F04](references/scenarios/F04-abort-session.md) |
| steer() 注入消息到队列 | [F05](references/scenarios/F05-steer-session.md) |
| 注入外部上下文 / 记忆 | [G01](references/scenarios/G01-context-injection.md) |

> F01 同时覆盖: 获取会话 ID/路径、纯内存会话(`SessionManager.inMemory()`)
> F05 同时覆盖: 读取/操作历史消息(`session.state.messages`)

### 5. 上下文与记忆

| 我想知道... | 详见 |
|--------|------|
| 加载/过滤/创建自定义 Skill | [C01](references/scenarios/C01-custom-skill.md) |
| 定义 Prompt 模板(`/command`) | [C02](references/scenarios/C02-prompt-templates.md) |
| 注入虚拟 AGENTS.md 指令 | [C03](references/scenarios/C03-context-files.md) |
| 自定义压缩策略 | [G02](references/scenarios/G02-custom-compaction.md) |
| 自动总结历史对话 | [G03](references/scenarios/G03-auto-summarize.md) |

### 6. Provider 与认证

| 我想知道... | 详见 |
|--------|------|
| 配置 API Key / OAuth | [B01](references/scenarios/B01-auth-config.md) |
| 管理 settings 配置项 | [B02](references/scenarios/B02-settings.md) |
| 获取可用模型列表 | [B03](references/scenarios/B03-available-models.md) |
| 自定义 Provider(智谱等) | [H02](references/scenarios/H02-custom-provider.md) |
| 企业接口能否接入 + 出 models.json 初稿 | [H07](references/scenarios/H07-enterprise-interface.md) |
| 用 Faux Provider 做测试 | [H03](references/scenarios/H03-faux-provider.md) |
| 项目信任(project_trust 何时触发) | [B04](references/scenarios/B04-project-trust.md) |

### 7. 多 Agent 与运行时环境

| 我想知道... | 详见 |
|--------|------|
| 多 Agent 协作 | [H06](references/scenarios/H06-multi-agent.md) |
| 打包发布 Pi Package | [I01](references/scenarios/I01-pi-package.md) |
| 分发扩展(`.piplugin`) | [I02](references/scenarios/I02-distribute-extension.md) |
| 扩展引用第三方依赖 | [I03](references/scenarios/I03-extension-deps.md) |
| Sandbox 沙箱隔离 | [I04](references/scenarios/I04-sandbox.md) |
| 子 Agent 调度 | [I05](references/scenarios/I05-subagent.md) |

### 8. 项目结构

| 我想知道... | 详见 |
|--------|------|
| 目录建议 / 规模演进 / 常见错误 | [project-structure.md](references/project-structure.md) |

> `references/scenarios/` 共 42 篇，上表已全部索引。若目录里出现上表未收录的新文件，直接翻该文件即可。

---

## 检索第二步：SDK API 索引

按包/模块查 API。每个条目指向 `references/sdk_doc/` 下的详细文档。

### @earendil-works/pi-coding-agent(核心 SDK)

| 模块 | 说明 | 详细 |
|------|------|------|
| `createAgentSession` | 创建会话主入口,接收全部配置 | [01](references/sdk_doc/01-create-agent-session.md) |
| `AgentSession` | prompt / steer / abort / setModel / dispose / subscribe | [02](references/sdk_doc/02-agent-session.md) |
| `AgentSessionRuntime` | newSession / switchSession / fork | [03](references/sdk_doc/03-agent-session-runtime.md) |
| **事件系统** | 全部事件类型、触发时机、数据结构、集成踩坑 | [04](references/sdk_doc/04-events.md) |
| `ModelRuntime` / `ModelRegistry` | 模型/认证运行时（v0.80.8+）+ 扩展兼容包装器 | [05](references/sdk_doc/05-auth-model-registry.md) |
| `defineTool` / 工具系统 | 自定义工具定义、内置工具、参数 schema | [06](references/sdk_doc/06-tools.md) |
| `ExtensionAPI` | pi.on / pi.registerTool / pi.registerCommand / pi.ui | [07](references/sdk_doc/07-extensions-api.md) |
| `DefaultResourceLoader` | system prompt / skills / prompts / context files / extensions | [08](references/sdk_doc/08-resource-loader.md) |
| `Skill` 接口 | Skill 数据结构与加载机制(渐进式披露) | [09](references/sdk_doc/09-skills.md) |
| `PromptTemplate` | `/command` 模板 | [10](references/sdk_doc/10-prompt-templates.md) |
| Context Files (AGENTS.md) | 项目级指令文件机制 | [11](references/sdk_doc/11-context-files.md) |
| `SessionManager` | create / continueRecent / open / list / inMemory | [12](references/sdk_doc/12-session-manager.md) |
| `SettingsManager` | applyOverrides / flush / drainErrors | [13](references/sdk_doc/13-settings-manager.md) |

### @earendil-works/pi-ai(AI 层)与高级主题

| 模块 | 说明 | 详细 |
|------|------|------|
| `getModel` / Custom Provider | 按 provider/id 查模型 / 自定义 Provider 注册 | [16](references/sdk_doc/16-custom-provider.md) |
| Compaction | 上下文窗口压缩机制 | [18](references/sdk_doc/18-compaction.md) |
| Pi Package | 打包、发布、版本管理 | [20](references/sdk_doc/20-pi-package.md) |
| 多 Agent 架构 | 多 Agent 协作模式 | [21](references/sdk_doc/21-multi-agent.md) |
| 扩展推荐 SOP | 按用户需求实时查 npm + 给出推荐清单（用户主动询问时触发） | [22](references/sdk_doc/22-extension-recommender.md) |

> 完整 sdk_doc 索引直接翻 `references/sdk_doc/` 目录（TUI/UI API/RPC 模式等 CLI 专属低频项已从本 skill 剔除，需要时查 SDK 源码）。

---

## 检索第三步：源码兜底协议 ⭐

当 `scenarios/` 和 `sdk_doc/` 都回答不了时，**不要凭空推断**——直接查 `node_modules` 内的包内容。
pi-agent 的 npm 包**自带文档、示例和类型**，装了 SDK 的项目都自动拥有。

**触发信号**: 类型/字段/方法名在 skill 内 grep 不到、签名未列出、实际行为与描述冲突、集成场景超出已覆盖模式。

**4 层优先级**(信息密度从高到低,先用上层):

| 优先级 | 查什么 | 最适合 |
|--------|--------|--------|
| 1 | `pi-coding-agent/examples/sdk/0X-*.ts` | 「怎么做 X」 |
| 2 | `pi-coding-agent/docs/*.md` | 「X 是什么 / 有哪些能力」 |
| 3 | `*/dist/**/*.d.ts` | 「X 有哪些字段/方法」 |
| 4 | `*/dist/**/*.js` | 「X 为什么这样行为」 |

> 完整路径导航表(三个包自带内容不对称)、检索配方、降级策略 → [source-fallback.md](references/source-fallback.md)

**作答要求**: 走源码兜底得到的结论，回答时标明结论来自源码而非 skill 文档，并给出具体文件路径。

---

## 资源

**官方源码参考**: `packages/coding-agent/src/`(SDK)、`packages/agent/src/`(Agent 核心)、`packages/ai/src/`(AI 抽象)
