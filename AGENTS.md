# Repository Guidelines

## 项目架构

这是单仓库、单用户的中文减脂陪伴 DeepSeek Harness 插件。仓库根目录即 `dsh-plugin-fatloss-agent` 包；版本 0.1.3，DSH SDK 锁定 0.2.1-rc.5，使用 Node.js 24。

- `src/index.ts`：宿主装配、fatloss 消息投影。
- `src/agent.ts`：独立减脂预设、工具白名单、记忆上下文与生命周期。
- `src/host/`：Cordis 服务、Remote、模型、问卷、消息证据及压缩协调。
- `src/client/`：DSH 内 React 建档、画像和报告页面。
- `src/core/`：业务工具、画像、SQLite 仓储、记忆调度、知识库及报告；禁止导入宿主 SDK。
- `src/prompts/system.md`：产品系统提示词。
- `scripts/`：手动维护命令；`knowledge_doc/`：知识 Markdown。
- `test/core/`、`test/plugin/`、`test/fixtures/`：业务测试、宿主接线测试及虚构样例。

客户端仅通过 `fatloss` Remote 访问宿主。不要向客户端泄露凭据、数据库路径或宿主会话文件路径。新增工具在 `src/core/tools/index.ts` 统一创建，由预设装配注册，不另建一套业务实现。

## 数据和生命周期

业务数据库与食物参考数据默认位于 `$DSH_HOME/storages/fatloss-agent/`；未设置时使用 `~/.dsh/storages/fatloss-agent/`。仓储显式接收路径，不依赖工作目录。

Chroma 数据保留在现有 `data/chroma/`，不能随源码整理迁移或自动重建。聊天和模型由 DSH 管理；插件不自动读取项目 `.env`。嵌入配置由宿主私密配置或宿主环境提供，项目 `.env` 仅供知识库索引维护命令使用。

插件实例共享业务数据库，每个减脂会话独立拥有 MemoryCoordinator。会话释放停止自身任务；插件卸载取消在途请求并等待结束，之后关闭数据库。取消或迟到结果不得继续写入。

报告、记忆提取通过独立辅助模型请求执行。检索子 Agent 只允许 `web_search`，不继承主聊天、画像或写库工具。上下文压缩保持 Basic/Billion 已有装配协调，不影响其他预设。

## 减脂能量计算口径

- 基础代谢使用 Mifflin–St Jeor 公式估算，表示静息状态下的能量消耗参考，不是精确测量值，也不是绝对最低安全摄入量。
- 每日总消耗估算（TDEE）等于基础代谢估算（BMR）乘以画像中的活动水平系数。
- 每日摄入参考等于 TDEE 减去画像中的 `dailyEnergyDeficitKcal`；减脂与保持体型均采用画像中已设置的缺口。
- 例如 BMR 为 1700 千卡、久坐系数为 1.2，则 TDEE 为 `1700 × 1.2 = 2040` 千卡；画像缺口为 300 千卡时，每日摄入参考为 `2040 - 300 = 1740` 千卡。
- TDEE 已包含活动水平对应的日常活动与运动估算。单独记录的运动消耗用于回顾运动事实，不得再次叠加到 TDEE 或每日摄入参考中。
- 持续的能量摄入低于消耗通常有助于形成减脂趋势，但实际结果会受到记录误差、代谢适应、体脂测量误差和执行情况影响，不承诺精确结果。

## 构建、测试与维护

```sh
npm install
npm run typecheck
npm test
npm run build
npm run pack:plugin
```

类型检查同时覆盖宿主、客户端、脚本和测试。提交前运行类型检查、测试及构建；涉及打包时还须检查 tarball 可脱离源码安装。仅在隔离 profile 和临时数据中进行写入验收，不替换日常 desktop 插件。

- `npm run chroma`：启动现有 `data/chroma/` 服务。
- `npm run kb:index`：读取项目 `.env`，手动重建知识索引；仅在知识源或嵌入配置变化且凭据有效时执行。
- `npm run food-data:sync`：主动下载并校验 CSV，写入默认插件存储目录；自定义目录用 `-- --data-directory /绝对路径`。

发布产物通过 `files` 白名单只包含运行产物、bundle patch 与说明；不得包含用户数据、凭据、测试假模型、仓库源码或生成缓存。`lib/`、`dist/` 不提交。

## 代码风格与命名约定

使用严格模式 TypeScript 和带明确 `.ts` 扩展名的 ESM 导入。沿用现有四空格缩进、分号、双引号及按功能拆分的小模块风格。函数与变量使用 `camelCase`，类和类型使用 `PascalCase`，文件使用 kebab-case，例如 `get-current-profile.ts`。面向用户的健康文案保持中文。当前未配置格式化或 lint 工具，不要顺带引入；应与周边代码保持一致。

## 测试指南

使用 `node:test` 与 `node:assert/strict`。测试名称应为可读的中文行为描述，例如 `test("速度标签与每日能量缺口边界一致", ...)`。覆盖边界值、校验失败和持久化行为。避免真实网络请求：为嵌入或向量存储客户端注入假实现，SQLite 测试使用临时目录。

## 提交与拉取请求规范

近期提交遵循 Conventional Commit 前缀，例如 `feat: rag知识库功能`、`fix(onboarding): 修复问卷多选与取消处理`、`refactor(tools): 抽离减脂画像工具注册`。提交摘要使用简洁中文；影响范围明确时添加 scope。PR 应说明行为变更、列出已运行的验证命令、关联相关 issue（如有），并为可见的客户端改动附上截图。不得提交 `.env`、API Key 或生成的 `data/` 文件。
