# Repository Guidelines

## 项目架构

这是一个单仓库、单用户的中文减脂陪伴 Agent。根项目承担 Node.js 后端、pi-agent 运行时、TUI 扩展、SQLite 长期数据和 Chroma RAG；`web/` 是独立的 Vue 工作区，只通过 `/api` 使用后端能力，不直接访问模型、数据库或会话文件。

两种交互入口共用同一套业务能力：

- TUI：pi CLI 加载 `.pi/extensions/fatloss-agent.ts`，直接使用 Agent 工具、画像和长期记忆。
- Web：浏览器请求 Express，后端为每个聊天会话恢复独立 `AgentSession`，再将 pi-agent 事件转换成 AI SDK UI Message Stream。
- 共享层：画像、长期记忆、知识库检索和时间工具全部位于 `src/`，不能在 TUI 与 Web 中各维护一套实现。

### 目录结构

```text
fatloss-agent/
├── .pi/                              # pi-agent 项目级配置与运行时扩展
│   ├── SYSTEM.md                     # Agent 系统提示词、健康边界、工具调用与记忆规则
│   ├── extensions/
│   │   └── fatloss-agent.ts          # 扩展入口：注册工具、命令、建档和记忆生命周期
│   └── skills/
│       └── dg-piagent/               # pi-agent SDK 离线文档检索 skill，不参与产品业务运行
├── src/                              # 后端、Agent 业务与共享领域代码
│   ├── database.ts                   # SQLite 连接与单用户画像仓储 ProfileRepository
│   ├── profile.ts                    # 画像类型、选项、校验、周期估算与文本格式化
│   ├── profile-form.ts               # Web 建档表单使用的选项和数值/多选约束
│   ├── onboarding.ts                 # TUI 的 12 步交互式建档流程
│   ├── memory.ts                     # 长期记忆类型、TypeBox schema、格式化与提取提示词
│   ├── memory-store.ts               # 长期记忆 SQLite 表、查询、事务写入、过期与删除逻辑
│   ├── memory-runtime.ts             # 会话消息读取、记忆上下文注入和后台提取调度
│   ├── memory-evaluation.ts          # 使用固定样例评估记忆提取效果的命令行入口
│   ├── knowledge/                    # RAG 知识库实现
│   │   ├── types.ts                  # 知识片段、检索结果、嵌入与向量仓储接口
│   │   ├── markdown.ts               # 将知识 Markdown 按问题解析和切分为可索引片段
│   │   ├── embeddings.ts             # 百炼文本向量客户端与响应校验
│   │   ├── chroma.ts                 # Chroma collection 的写入、替换和相似度查询
│   │   ├── service.ts                # 组合嵌入客户端与 Chroma 的知识库服务
│   │   └── index.ts                  # `npm run kb:index` 的知识库重建入口
│   ├── tools/                        # 暴露给模型的减脂 Agent 工具
│   │   ├── index.ts                  # 统一创建和导出工具；新增工具必须在这里注册
│   │   ├── get-current-profile.ts    # 读取当前减脂画像
│   │   ├── update-current-profile.ts # 经确认后局部更新画像并校验业务规则
│   │   ├── get-current-time.ts       # 返回固定 Asia/Shanghai 时区的当前时间
│   │   ├── search-fatloss-knowledge.ts # 检索减脂知识库并格式化引用来源
│   │   └── memories.ts               # 查询、创建、更新、失效和删除长期记忆
│   └── server/                       # Express Web 后端与 AgentSession 适配层
│       ├── index.ts                  # 服务进程入口：创建模型运行时、监听端口和优雅退出
│       ├── app.ts                    # Express 应用、画像/会话/消息/健康检查 API 和静态托管
│       ├── conversation-registry.ts  # 会话列表、恢复、互斥、空闲回收及 AgentSession 生命周期
│       ├── agent-stream.ts           # pi-agent 事件到 AI SDK UI Message Stream 的实时转换
│       ├── messages.ts               # JSONL 当前分支到 UIMessage 历史消息的转换
│       ├── extension-ui.ts           # Web 无终端环境下的 pi 扩展 UI 适配器
│       ├── tool-presentation.ts      # 工具中文标题及前端安全输入、输出、错误摘要
│       └── errors.ts                 # HTTP 业务错误与未知异常文本归一化
├── web/                              # Vue 3 + Vite + TypeScript 前端工作区
│   ├── src/
│   │   ├── main.ts                   # Vue 应用入口
│   │   ├── router.ts                 # 启动、建档、聊天和画像页面路由
│   │   ├── api.ts                    # 画像与会话 REST 客户端及共享前端类型
│   │   ├── profile-validation.ts     # 建档表单的客户端即时校验
│   │   ├── views/                    # 页面层：Start、Onboarding、Chat、Profile
│   │   ├── components/ProfileForm.vue # 建档与画像编辑共用的大表单
│   │   ├── components/ai-elements/  # 消息、输入框、工具卡片等 AI 聊天组件
│   │   ├── components/ui/           # shadcn-vue 基础 UI 组件
│   │   └── assets/main.css          # Tailwind CSS 入口与全局样式
│   ├── vite.config.ts               # Vite、Tailwind、路径别名及开发期 `/api` 代理
│   └── package.json                 # 前端开发、检查、测试和构建命令
├── test/                             # Node 后端、Agent 工具和数据层自动化测试
│   └── fixtures/                     # 测试专用的固定输入数据
├── knowledge_doc/                   # 人工维护的中文 RAG 知识源 Markdown
├── data/                             # 本机运行时数据，禁止提交
│   ├── fatloss.sqlite               # 当前画像、长期记忆及记忆处理状态
│   └── chroma/                       # Chroma 本地向量数据
├── docs/                             # 长期记忆设计、代码讲解和人工验收材料
├── pi-agent实战/                    # pi-agent 学习与项目实践文档
├── .env.example                     # 百炼嵌入接口和 Chroma 的环境变量示例
├── package.json                     # 根工作区依赖与 TUI、后端、RAG、测试脚本
└── tsconfig.json                    # 根 TypeScript 严格模式配置
```

`.agents/` 和 `.workbuddy/` 等目录属于开发助手的本地说明或工作记录，不是产品运行链路的一部分；修改业务功能时不要把它们当作 Agent 的运行时配置。真正由 pi-agent 自动加载的是 `.pi/`。

### 关键运行链路

#### TUI 与 Web 共用 Agent 能力

`.pi/extensions/fatloss-agent.ts` 是产品 Agent 的统一扩展入口。它创建画像仓储和记忆仓储，调用 `src/tools/index.ts` 注册完整工具集，并通过 `registerMemoryRuntime()` 接入长期记忆。TUI 由 pi CLI 自动加载该扩展；Web 则由 `ConversationSessionRegistry` 创建会话并执行 `bindExtensions({ mode: "print" })`，因此同一扩展也会在 Web 会话中生效。

新增或修改 Agent 工具时，应保持以下依赖方向：

```text
.pi/SYSTEM.md（规定何时调用）
        ↓
src/tools/<tool>.ts（定义工具参数与执行逻辑）
        ↓
src/tools/index.ts（加入统一工具列表）
        ↓
.pi/extensions/fatloss-agent.ts（注册并启用）
        ↓
TUI / Web AgentSession（共同使用）
```

#### Web 聊天请求

```text
ChatView.vue
    → POST /api/conversations/:id/messages
    → server/app.ts 校验画像和用户消息
    → ConversationSessionRegistry 独占并恢复对应 AgentSession
    → session.prompt() 驱动模型与工具循环
    → agent-stream.ts 将文本、工具状态和错误转换为 UI Message Stream
    → @ai-sdk/vue 增量更新浏览器消息与工具卡片
```

同一会话一次只允许一个 prompt，不同会话可以并行。不要同时从 TUI 和 Web 继续写入同一个会话，以免两个进程并发追加同一 JSONL。

#### 数据存储边界

- 画像和长期记忆：`data/fatloss.sqlite`。二者共享 SQLite 连接，但分别由 `ProfileRepository` 与 `MemoryStore` 管理。
- 知识源：`knowledge_doc/*.md`；索引后的向量存放在 `data/chroma/`，运行时由本机 Chroma 服务读取。
- 聊天记录：不在 `data/`。pi-agent 按项目将 JSONL 会话存到 `~/.pi/agent/sessions/<项目目录编码>/`；Web 与 TUI 读取的是同一会话目录。
- 模型或嵌入凭据：只放 `.env` 或 pi 自身配置，不进入前端、不写入 SQLite、不得提交。

### Web API 边界

- `GET /api/profile`：读取画像以及建档表单选项、约束。
- `POST /api/profile/preview`：只校验和预览画像，不写数据库。
- `PUT /api/profile`：校验并保存画像。
- `GET /api/conversations`：列出当前项目的 pi 会话。
- `POST /api/conversations`：创建可立即显示的空白持久化会话。
- `PATCH /api/conversations/:id`：修改会话显示名称。
- `GET /api/conversations/:id/messages`：读取当前分支并转换成前端消息。
- `POST /api/conversations/:id/messages`：发送用户消息并返回流式 Agent 回复。
- `GET /api/health`：报告模型、SQLite、Chroma 和服务状态。

前端只能通过这些 API 与后端通信。会话 ID 必须由后端列表解析，不能接受客户端提供的任意文件路径；前端也不能接触 API Key、SQLite 路径或真实 JSONL 路径。

## 构建、测试与开发命令

使用 Node.js 24（最低支持 Node.js 22.19），通过 `npm install` 安装依赖。

- `npm run tui`：启动本地 pi 终端 Agent，并读取 `.env`。
- `npm run server`：启动监听 `127.0.0.1:3000` 的 Express 后端，并读取 `.env`。
- `npm run web:dev`：启动监听 `127.0.0.1:5173` 的 Vite 前端；开发期 `/api` 自动代理到后端。
- `npm run dev`：并行启动 Express 与 Vite，任一进程退出时停止另一进程。
- `npm run chroma`：启动本地 Chroma 服务，数据保存至 `data/chroma/`。
- `npm run kb:index`：解析 `knowledge_doc/` 并重建向量；修改知识 Markdown、嵌入模型或向量维度后执行。
- `npm run memory:eval`：使用固定样例调用当前模型，人工评估长期记忆提取质量。
- `npm run typecheck`：执行严格的 TypeScript 类型检查，不生成产物。
- `npm test`：通过 `tsx` 与 Node 内置测试运行器执行 `test/**/*.test.ts`。
- `npm run web:typecheck`：执行 Vue 前端类型检查。
- `npm run web:test`：执行前端 Vitest 测试。
- `npm run web:build`：完成前端类型检查并生成 `web/dist/`；该目录由 Express 同源托管且不提交。

提交前须运行 `npm run typecheck` 和 `npm test`；改动 `web/` 时还须运行 `npm run web:typecheck`、`npm run web:test` 和 `npm run web:build`。涉及知识库的修改，仅在配置了有效嵌入凭据后启动 Chroma 并执行索引。

## 代码风格与命名约定

使用严格模式 TypeScript 和带明确 `.ts` 扩展名的 ESM 导入。沿用现有四空格缩进、分号、双引号及按功能拆分的小模块风格。函数与变量使用 `camelCase`，类和类型使用 `PascalCase`，文件使用 kebab-case，例如 `get-current-profile.ts`。面向用户的健康文案保持中文。当前未配置格式化或 lint 工具，不要顺带引入；应与周边代码保持一致。

## 测试指南

使用 `node:test` 与 `node:assert/strict`。测试名称应为可读的中文行为描述，例如 `test("速度标签与每日能量缺口边界一致", ...)`。覆盖边界值、校验失败和持久化行为。避免真实网络请求：为嵌入或向量存储客户端注入假实现，SQLite 测试使用临时目录。

## 提交与拉取请求规范

近期提交遵循 Conventional Commit 前缀，例如 `feat: rag知识库功能`、`fix(onboarding): 修复问卷多选与取消处理`、`refactor(tools): 抽离减脂画像工具注册`。提交摘要使用简洁中文；影响范围明确时添加 scope。PR 应说明行为变更、列出已运行的验证命令、关联相关 issue（如有），并为可见的 TUI 改动附上终端截图。不得提交 `.env`、API Key 或生成的 `data/` 文件。
