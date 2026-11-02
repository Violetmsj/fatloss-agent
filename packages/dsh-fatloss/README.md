# 减脂陪伴 DSH 插件

兼容 DeepSeek Harness **0.2.1-rc.5**，使用 Node.js 24。提供独立“减脂陪伴”预设、29 个业务工具、原生建档/画像表单与报告页面，不需要旧 Express 或 Vue 服务。

## 构建与安装

在项目根目录执行：

```sh
npm install
npm run dsh:pack
dsh plugin --profile desktop add ./dist/dsh-plugin-fatloss-agent-0.1.2.tgz
```

macOS 桌面端的 CLI 若未加入 PATH，可以使用应用内置启动器：

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add ./dist/dsh-plugin-fatloss-agent-0.1.2.tgz
```

安装后从侧栏打开“减脂陪伴”，填写并预览画像、确认保存，然后点击“开始减脂聊天”。也可以在 DSH 新会话中选择“减脂陪伴”预设。安装不会替换默认 Agent。

预编译 `.tgz` 可直接交给上述 CLI 安装，不需要检出本仓库或安装 pi。开发期间若重复构建同版本、同路径的 tgz，pnpm 可能沿用锁文件中的旧内容；请使用新版本或带内容摘要的新文件名，并核对实际安装文件。

## 一次性导入旧数据

请在首次启用插件之前导入。把压缩包解压到临时目录后运行其中的迁移入口，或在源码构建后执行：

```sh
node packages/dsh-fatloss/lib/migrate.js --from /原项目绝对路径/data
```

默认目标为 `$DSH_HOME/storages/fatloss-agent/`（未配置 DSH_HOME 时为 `~/.dsh/storages/fatloss-agent/`），支持 `--to` 指定其他目录。导入通过 SQLite backup 获取一致性快照，包含已提交的 WAL 数据；目标库已存在时拒绝覆盖。画像、饮食运动、长期记忆、报告与版本 ID 都保留，食物参考 CSV 同时复制。两边之后互不写入对方数据库。不导入 pi 聊天 JSONL。

如先试用了空数据库，应先停用插件，保留该试用目录，再选择一个全新目标目录导入；不要在插件运行时替换数据库文件。

## 宿主配置

模型和聊天历史由 DSH 管理，不复制 pi 模型凭据，也不自动读取旧 `.env`。插件配置项如下；私密配置只在宿主读取，客户端不会获得密钥或数据库路径：

| 配置 | 用途 |
|---|---|
| `dataDirectory` | 独立数据目录，默认使用上文目录 |
| `embeddingApiKey` | 百炼嵌入凭据；也支持 `DASHSCOPE_API_KEY` |
| `embeddingUrl` | 嵌入接口；也支持 `DASHSCOPE_EMBEDDING_URL` |
| `chromaHost` / `chromaPort` | 默认 `localhost:8000`；兼容 `CHROMA_HOST` / `CHROMA_PORT` |

显式配置优先于环境变量。继续使用原 Chroma 服务和 `fatloss_knowledge` 集合，本插件不会移动或重建向量库。联网热量估算要求宿主全局已有可用的 `web_search`；子 Agent 只获准调用此检索工具，不能使用画像或写库工具。

配置可在当前 profile 的 `cordis.patch.yml` 现有列表中追加以下条目（desktop 默认位于 `~/.dsh/profiles/desktop/cordis.patch.yml`）。这是本机私密配置，不要加入项目仓库；示例中的凭据与地址需要自行填写。插件不会替你复制旧 `.env`。

```yaml
- id: fatloss-host
  config:
    embeddingApiKey: "填写百炼 API Key"
    embeddingUrl: "填写百炼兼容 embeddings 地址"
    chromaHost: localhost
    chromaPort: 8000
```

未配置知识库时，页面列出缺少的具体配置项，其余功能仍可使用。缺少 Chroma 服务或检索提供方时，对应工具返回错误，不编造检索结果。

报告由聊天工具生成，页面只查看、筛选和导出已保存快照。AI 总结失败时统计仍保存；明确要求重试或更新时才重新生成。

## 上下文压缩

从 0.1.1 起，减脂预设兼容同一 DSH profile 已启用的 Billion Context（本机验证版本 0.1.211），无需减脂业务主动触发压缩。减脂工具之外，仅允许其已注册的 `compress`、`decompress`、`search_context`、`acp_status`、`acp_cache`、`acp_retrieve`、`acp_read_original_image`；每步模型请求前重新检查，以支持代理晚启动或工具重新注册。没有安装时，减脂预设仍可独立启动。

从 0.1.2 起，未安装 Billion Context 时，减脂预设自动装配 DSH 官方 `@deepseek-ai/dsh-compaction-basic`，由它在上下文压力或溢出时调用当前会话模型生成摘要；也可用 `/compact` 手动压缩。该服务隔离在减脂预设内，不改变普通聊天。摘要会有额外模型调用成本。

同一 profile 安装并启用 Billion Context 后，减脂预设会等待其 `biliBasicCompactionPolicy` 协调器加载，再由它在装配期停用预设内的 Basic 和 `/compact`，使用 Billion Context 自身的策略，避免双重压缩。Billion Context 是可选插件，不会随本插件自动安装。可在减脂聊天中运行 `/acp` 查看其状态。

安装、卸载或启停 Billion Context 后请重启 DSH，再恢复聊天，使预设重新装配。安装目录中有包但没有在当前 profile 启用 bundle，不视为已启用。Billion 启动异常时会显示其自身错误，不会在一次请求中途改用 Basic 并改写历史。Billion 0.1.211 的协调器需要保持启用；停用主入口或移除整个 Billion bundle，请遵循该插件说明。

普通会话的工具配置不变；联网估算子 Agent 仍只允许检索，不继承这些上下文工具。不开放终端、文件写入或 Agent 委派。若自行重命名 Billion Context 工具，需相应适配白名单。

## 停用与开发验证

在 DSH 插件管理页停用本 bundle；页面、预设工具和后台任务随生命周期移除，持久业务数据保留。旧 pi 与 WebUI 启动命令保留，但作为封存入口。

也可以在上述 profile 补丁列表中添加两项以停用，重新启用时移除相应 `disabled` 项：

```yaml
- id: fatloss-preset
  disabled: true
- id: fatloss-host
  disabled: true
```

卸载包可执行 `dsh plugin --profile desktop remove dsh-plugin-fatloss-agent`，并移除自己添加的减脂配置条目；保留存储目录即可保留业务数据。删除长期记忆不等于删除 DSH 或 pi 的原始聊天记录。

```sh
npm run typecheck
npm test
npm run dsh:typecheck
npm run dsh:test
npm run dsh:build
```

客户端构建复用宿主 React，输出 DSH lazy-CJS factory；其他浏览器安全的纯协议代码随客户端打包。Remote 元数据由官方 Typert 生成器生成。0.2.1 的生成器依赖工作区源码位置，因此构建时建立临时反射工作区；正式类型检查和运行始终使用真实 SDK。构建产物检查禁止引入 pi 运行时。
