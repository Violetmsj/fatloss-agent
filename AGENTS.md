# Repository Guidelines

## 项目结构与模块组织

- `src/` 存放 TypeScript 应用代码；建档、画像计算和 SQLite 持久化保持在各自聚焦的顶层模块中。
- `src/knowledge/` 实现 Markdown 解析、向量嵌入、Chroma 存储与检索编排。`src/tools/` 提供 Agent 工具；新增工具须在 `src/tools/index.ts` 中注册。
- `test/` 按功能编写测试，例如 `profile.test.ts`、`knowledge.test.ts`。
- `knowledge_doc/` 存放人工维护的中文 Markdown 知识库；每个二级标题对应一个可索引的问答条目。
- 运行时数据仅放在 `data/`：画像数据库为 `data/fatloss.sqlite`，向量数据为 `data/chroma/`；两者均不得提交。

## 构建、测试与开发命令

使用 Node.js 24（最低支持 Node.js 22.19），通过 `npm install` 安装依赖。

- `npm run tui`：启动本地 pi 终端 Agent，并读取 `.env`。
- `npm run chroma`：启动本地 Chroma 服务，数据保存至 `data/chroma/`。
- `npm run kb:index`：解析 `knowledge_doc/` 并重建向量；修改知识 Markdown、嵌入模型或向量维度后执行。
- `npm run typecheck`：执行严格的 TypeScript 类型检查，不生成产物。
- `npm test`：通过 `tsx` 与 Node 内置测试运行器执行 `test/**/*.test.ts`。

提交前须运行 `npm run typecheck` 和 `npm test`。涉及知识库的修改，仅在配置了有效嵌入凭据后启动 Chroma 并执行索引。

## 代码风格与命名约定

使用严格模式 TypeScript 和带明确 `.ts` 扩展名的 ESM 导入。沿用现有四空格缩进、分号、双引号及按功能拆分的小模块风格。函数与变量使用 `camelCase`，类和类型使用 `PascalCase`，文件使用 kebab-case，例如 `get-current-profile.ts`。面向用户的健康文案保持中文。当前未配置格式化或 lint 工具，不要顺带引入；应与周边代码保持一致。

## 测试指南

使用 `node:test` 与 `node:assert/strict`。测试名称应为可读的中文行为描述，例如 `test("速度标签与每日能量缺口边界一致", ...)`。覆盖边界值、校验失败和持久化行为。避免真实网络请求：为嵌入或向量存储客户端注入假实现，SQLite 测试使用临时目录。

## 提交与拉取请求规范

近期提交遵循 Conventional Commit 前缀，例如 `feat: rag知识库功能`、`fix(onboarding): 修复问卷多选与取消处理`、`refactor(tools): 抽离减脂画像工具注册`。提交摘要使用简洁中文；影响范围明确时添加 scope。PR 应说明行为变更、列出已运行的验证命令、关联相关 issue（如有），并为可见的 TUI 改动附上终端截图。不得提交 `.env`、API Key 或生成的 `data/` 文件。
