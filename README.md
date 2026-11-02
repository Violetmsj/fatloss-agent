# 减脂陪伴 DSH 插件

基于 DeepSeek Harness **0.2.1-rc.5**，使用 Node.js 24。提供独立“减脂陪伴”预设、29 个业务工具、原生建档/画像表单与报告页面。当前版本仅提供 DSH 插件入口，不包含 Pi Agent 运行入口。

## 构建与安装

在项目根目录执行：

```sh
npm install
npm run pack:plugin
dsh plugin --profile desktop add ./dist/dsh-plugin-fatloss-agent-0.1.3.tgz
```

macOS 桌面端的 CLI 若未加入 PATH，可以使用应用内置启动器：

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add ./dist/dsh-plugin-fatloss-agent-0.1.3.tgz
```

安装后从侧栏打开“减脂陪伴”，填写并预览画像、确认保存，然后点击“开始减脂聊天”。也可以在 DSH 新会话中选择“减脂陪伴”预设。安装不会替换默认 Agent。

聊天中的画像更新，以及饮食、运动和整日记录的增改删，会在工具执行前由 DSH 展示工具调用并请求审批。只有批准本次调用才会写入；拒绝、取消或审批通道不可用时不会写入。侧栏建档和画像表单仍使用页面自身的预览与确认流程。

预编译 `.tgz` 可直接交给上述 CLI 安装，不需要检出本仓库。开发期间若重复构建同版本、同路径的 tgz，pnpm 可能沿用锁文件中的旧内容；请使用新版本或带内容摘要的新文件名，并核对实际安装文件。

## 宿主配置

模型和聊天历史由 DSH 管理；插件不自动读取项目 `.env`。业务数据默认保存到 `$DSH_HOME/storages/fatloss-agent/`，未配置 `DSH_HOME` 时使用 `~/.dsh/storages/fatloss-agent/`。插件配置项如下；私密配置只在宿主读取，客户端不会获得密钥或数据库路径：

| 配置 | 用途 |
|---|---|
| `dataDirectory` | 独立数据目录，默认使用 DSH 存储目录 |
| `embeddingApiKey` | 百炼嵌入凭据；也支持 `DASHSCOPE_API_KEY` |
| `embeddingUrl` | 嵌入接口；也支持 `DASHSCOPE_EMBEDDING_URL` |
| `chromaHost` / `chromaPort` | 默认 `localhost:8000`；兼容 `CHROMA_HOST` / `CHROMA_PORT` |

显式配置优先于环境变量。使用本机 Chroma 服务和 `fatloss_knowledge` 集合，本插件不会移动或重建向量库。联网热量估算要求宿主全局已有可用的 `web_search`；子 Agent 只获准调用此检索工具，不能使用画像或写库工具。

配置可在当前 profile 的 `cordis.patch.yml` 现有列表中追加以下条目（desktop 默认位于 `~/.dsh/profiles/desktop/cordis.patch.yml`）。这是本机私密配置，不要加入项目仓库；示例中的凭据与地址需要自行填写。项目 `.env` 仅供维护命令使用。

```yaml
- id: fatloss-host
  config:
    embeddingApiKey: "填写百炼 API Key"
    embeddingUrl: "填写百炼兼容 embeddings 地址"
    chromaHost: localhost
    chromaPort: 8000
```

缺少嵌入凭据或接口地址时，页面列出具体缺失项，其余功能仍可使用。缺少 Chroma 服务、知识索引或检索提供方时，对应工具返回错误，不编造检索结果。

报告由聊天工具生成，页面只查看、筛选和导出已保存快照。AI 总结失败时统计仍保存；明确要求重试或更新时才重新生成。

## 上下文压缩

从 0.1.1 起，减脂预设兼容同一 DSH profile 已启用的 Billion Context（本机验证版本 0.1.211），无需减脂业务主动触发压缩。减脂工具之外，仅允许其已注册的 `compress`、`decompress`、`search_context`、`acp_status`、`acp_cache`、`acp_retrieve`、`acp_read_original_image`；每步模型请求前重新检查，以支持代理晚启动或工具重新注册。没有安装时，减脂预设仍可独立启动。

从 0.1.2 起，未安装 Billion Context 时，减脂预设自动装配 DSH 官方 `@deepseek-ai/dsh-compaction-basic`，由它在上下文压力或溢出时调用当前会话模型生成摘要；也可用 `/compact` 手动压缩。该服务隔离在减脂预设内，不改变普通聊天。摘要会有额外模型调用成本。

同一 profile 安装并启用 Billion Context 后，减脂预设会等待其 `biliBasicCompactionPolicy` 协调器加载，再由它在装配期停用预设内的 Basic 和 `/compact`，使用 Billion Context 自身的策略，避免双重压缩。Billion Context 是可选插件，不会随本插件自动安装。可在减脂聊天中运行 `/acp` 查看其状态。

安装、卸载或启停 Billion Context 后请重启 DSH，再恢复聊天，使预设重新装配。安装目录中有包但没有在当前 profile 启用 bundle，不视为已启用。Billion 启动异常时会显示其自身错误，不会在一次请求中途改用 Basic 并改写历史。Billion 0.1.211 的协调器需要保持启用；停用主入口或移除整个 Billion bundle，请遵循该插件说明。

普通会话的工具配置不变；联网估算子 Agent 仍只允许检索，不继承这些上下文工具。不开放终端、文件写入或 Agent 委派。若自行重命名 Billion Context 工具，需相应适配白名单。

## 停用与开发验证

在 DSH 插件管理页停用本 bundle；页面、预设工具、待确认的写入和后台任务随生命周期移除，持久业务数据保留。会话结束和预设卸载都会释放该会话的工具限制、提示词上下文与记忆调度。

也可以在上述 profile 补丁列表中添加两项以停用，重新启用时移除相应 `disabled` 项：

```yaml
- id: fatloss-preset
  disabled: true
- id: fatloss-host
  disabled: true
```

卸载包可执行 `dsh plugin --profile desktop remove dsh-plugin-fatloss-agent`，并移除自己添加的减脂配置条目；保留存储目录即可保留业务数据。删除长期记忆不等于删除 DSH 的原始聊天记录。

```sh
npm run typecheck
npm test
npm run build
npm run pack:plugin
```

客户端构建复用宿主 React，输出 DSH lazy-CJS factory；浏览器安全的纯协议代码随客户端打包。Remote 元数据由官方 Typert 生成器生成。0.2.1 的生成器依赖工作区源码位置，因此构建时建立临时反射工作区；正式类型检查和运行始终使用真实 SDK。

## 项目结构

仓库根目录就是 `dsh-plugin-fatloss-agent` 插件包，使用 Node.js 24 开发。

- `src/index.ts` / `src/agent.ts`：宿主与减脂预设入口。
- `src/host/`：服务、Remote、模型、消息来源和生命周期接线。
- `src/client/`：宿主内 React 建档、画像及报告页面。
- `src/core/`：画像、能量计算、每日记录、记忆、知识库和报告业务；不导入宿主 SDK。
- `src/prompts/system.md`：减脂规则、健康边界和工具调用要求。
- `locale/` / `icon.svg`：插件与预设的显示名称、说明和图标；页面颜色使用 DSH 主题变量。
- `test/core/` / `test/plugin/`：业务与插件测试；使用临时 SQLite、虚构资料和假模型。
- `scripts/`：手动维护命令；`knowledge_doc/`：人工维护的知识源。
- `lib/` / `dist/`：生成代码与安装包，不提交。

## 知识库维护

插件继续使用 `fatloss_knowledge` 集合，向量数据保留在本机原目录。使用知识检索时，需要保持 Chroma 服务运行：

```sh
npm run chroma
```

首次使用且 `fatloss_knowledge` 尚无知识索引时，或更新知识源后，手动建立或更新索引：

```sh
cp .env.example .env
# 填写百炼凭据、嵌入地址和 Chroma 连接配置
npm run kb:index
```

索引命令读取项目 `.env`；插件读取宿主配置或宿主进程环境变量，两者需要指向同一嵌入服务和 Chroma 实例。当前代码固定使用 `qwen3.7-text-embedding-flash` 的 1024 维向量。索引命令只替换既定知识来源，不会迁移或重建整个集合；更换模型或维度时，需先单独处理现有集合，避免混用向量。

## 食物数据与业务边界

可手动执行 `npm run food-data:sync`，下载并校验食物成分 CSV 后写入默认 DSH 存储目录。自定义了插件的 `dataDirectory` 时，显式指定相同目录：

```sh
npm run food-data:sync -- --data-directory /绝对路径/减脂存储目录
```

安装和启动不自动下载食物数据。来源与使用限制见 [食物数据说明](docs/food-calorie-sources.md)。

基础代谢使用 Mifflin–St Jeor 公式估算；每日总消耗为基础代谢乘活动水平系数，每日摄入参考为总消耗减画像已设置的每日能量缺口。运动记录用于事实回顾，不再叠加到总消耗或摄入参考。工具结果是参考估算，不承诺精确减重，也不替代医疗诊疗。

长期记忆累计十轮用户发言或回复结束后空闲五分钟提取，只接受真实用户原话；可通过聊天要求记住、纠正、失效或忘记。没有合格事实时不新增记录。删除记忆不会清除宿主聊天历史。[记忆设计](docs/memory-code-walkthrough.md)、[人工验证](docs/memory-manual-dialogues.md)。

报告支持日报、周报、月报、年报和自定义周期。程序生成统计快照，AI 仅补充总结；页面查看已存版本和 Markdown，不重新调用模型。[报告说明](docs/reports.md)。
