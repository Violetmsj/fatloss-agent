# DSH 迁移验收记录

验收日期：2026-11-01。宿主：本机 DeepSeek Harness **0.2.1-rc.5**；插件：`dsh-plugin-fatloss-agent@0.1.0`。没有升级宿主，没有启动旧 Express/Vue 服务，没有发布公共 npm 包。

## 交付与安装

- `packages/dsh-fatloss/`：宿主、独立减脂预设、29 个工具、React 页面、Remote 接口和导入 CLI。
- `dist/dsh-plugin-fatloss-agent-0.1.0-e5d5523e.tgz`：已安装的独立预编译包；带摘要文件名用于规避开发阶段同路径 tgz 的 pnpm 缓存。同内容另存为 `dist/dsh-plugin-fatloss-agent-0.1.0.tgz`。SHA-256：`e5d5523e454fa0ad7826c722f08e2471fb45872f5897f2db0bda666c6a99e170`。
- 本机 desktop profile 已安装；原有 9 个 bundle、原有依赖版本均保留。安装前清单与覆盖配置备份于 `~/.dsh/fatloss-install-backup-20261101/`。
- 旧数据库已通过 SQLite backup 复制至 `~/.dsh/storages/fatloss-agent/fatloss.sqlite`。初始化前核对源库与副本 8 张表的记录数一致，文件 inode 不同；桌面加载后再次核对，所有原有业务行和 ID 均一致。源目录没有已同步的食物参考 CSV，因此没有可复制的 CSV。没有导入 pi JSONL，没有复制 `.env`。
- 桌面 `dsh-app://app/` 已显示减脂入口和导入后的画像；点击开始聊天后选择的是“减脂陪伴”预设，沿用桌面当前选中的模型。正式数据没有写入验收用的虚拟饮食、运动或报告。

## 自动化验证

| 验证 | 结果 |
| --- | --- |
| 根项目 `npm run typecheck` | 通过 |
| 根项目 `npm test` | 106 项通过 |
| 旧 WebUI 类型检查、测试和构建 | 通过，18 项测试；构建存在既有大 chunk 提示 |
| `npm run dsh:typecheck` | 宿主与客户端通过 |
| `npm run dsh:test` | 14 项通过 |
| `npm run dsh:pack` | 宿主、客户端、类型声明、Remote 元数据与 tgz 构建通过 |

专项测试覆盖：WAL 一致性导入与目标防覆盖、原库隔离、画像预览不写入及跨字段校验、饮食运动 CRUD、29 个工具的输出协议、真实 SDK 的预设作用域和普通聊天隔离、五种报告周期及历史版本/过期状态、问卷取消、真实用户证据过滤、当前模型选择、受限检索子 Agent、停用取消与迟到结果。

既有根测试继续覆盖记忆纠正、过期、删除后有效上下文，以及在途提取取消/删除冲突和报告失败/超时等业务行为。

## 实际界面与宿主验收

在隔离目录 `/tmp/fatloss-dsh-verify` 使用同一安装版的 DSH 宿主与原生 Web 客户端，安装预编译包并核对实际文件与构建产物一致。使用不联网的本地验收模型，运行了真实 Agent/工具循环：

1. 填写虚拟画像 → 服务端预览；保存前数据库无画像，确认后才写入。
2. 从减脂页面创建会话 → 29 个减脂工具可见 → 保存虚拟饮食与运动 → 生成日报及独立模型总结。
3. 聊天中的“查看减脂日报”直接打开插件详情；验证过期提示、报告列表与 Markdown 导出（导出的文件已实际落盘）。
4. 原生问卷提交选项/自由输入后可继续；跳过时本轮立即终止。取消后重新开始并回答，查询数据库确认只新增了已回答的测试食品。
5. 宿主多次重启、客户端重新加载后，画像、聊天和报告保留；页面重新读取仓储状态。

另从 `/private/tmp` 启动隔离宿主，确认插件不依赖仓库工作目录；缺少环境配置时明确列出 `embeddingApiKey` 与 `embeddingUrl`，画像和报告仍可打开。

发现并修复了 RC 版本差异：`restrict({allow: []})` 会同时屏蔽继承的预设工具；主 Agent 必须显式允许业务工具名称。另一个差异是 Markdown 不保留纯 hash 报告链接，因此使用保留的 `fatloss.localhost` 链接，由插件在点击捕获阶段转换为内部导航，不访问外部站点。

## 外部依赖与验收边界

- 真实模型：桌面模型选择和适配已接通；完整写入闭环使用本地假模型，没有将正式用户画像或记忆发送出去做试运行。真实提供方生成、计费和模型效果尚未联调。
- RAG：首次验收没有迁移或重建 Chroma，也未复制百炼凭据；当时真实检索未联调。2026-11-02 已补齐本机插件配置并通过真实检索，见下文后续记录。
- 联网估算：受限子 Agent 的工具隔离通过测试；真实 `web_search` 提供方尚未联网验收，需要在 DSH 中配置该能力。
- 停用：自动化验证了作用域释放和在途取消；隔离宿主实际应用停用补丁后，减脂入口消失、旧聊天保留，移除补丁重新启动后入口和数据恢复。没有为测试而停用用户 desktop 中的其他插件。完整业务写入闭环在隔离宿主完成，正式桌面只进行了加载、读取画像和新会话预设检查。
- 报告正文当前按保存的 Markdown 文本显示，支持直接导出；不复用旧 Vue 报告图表。

配置与停用步骤见 [插件说明](../packages/dsh-fatloss/README.md)。验收截图位于本机构建目录 `dist/dsh-report-acceptance.png`，仅包含隔离测试内容。

## 2026-11-02 知识库配置补齐

用户反馈项目已有配置而 DSH 显示缺项。确认原因是桌面插件不自动读取项目 `.env`，随后仅将已有百炼 Key、嵌入地址和 Chroma 地址写入 desktop profile 的 `fatloss-host` 私密配置；没有复制整个 `.env`，没有修改宿主全局环境，也没有修改其他插件配置。配置文件权限为 0600，并保留了修改前备份。

启动 `npm run chroma`，继续使用原 `data/chroma/`，没有重建索引。使用插件配置中的凭据和地址，以不含个人信息的通用问题验证百炼嵌入和现有 Chroma 检索，成功返回 3 条知识片段。桌面页面的知识库缺项提示已消失；没有发送用户画像或聊天内容进行此项测试。该服务需在使用知识库时保持运行。

## 2026-11-02 Billion Context 兼容修复（0.1.1）

修复减脂预设白名单屏蔽 Billion Context 宿主工具的问题。每步模型请求前，在原有业务工具之外仅允许已注册的上下文管理工具，支持代理异步启动、停用和重新注册；不按工具名前缀放行其他能力。联网估算子 Agent 仍只有检索工具。报告总结和记忆提取的独立模型调用使用独立 `fatloss-aux-*` 身份，防止压缩状态与主聊天串线。

根项目类型检查、106 项后端测试、DSH 宿主/客户端类型检查和 15 项插件测试全部通过。本次未修改旧 Vue 页面。包版本为 0.1.1，DSH 兼容版本仍锁定 0.2.1-rc.5。

真实互操作验收使用 Billion Context 0.1.211、隔离 DSH profile、独立端口 18987 和独立压缩状态目录，以及只监听本机 18988 的假模型；没有向真实模型发送个人资料。向隔离减脂会话写入 8 轮虚拟长资料后，真实 Agent 循环完成 `acp_status → compress → acp_status`：压缩回执为 `m00001–m00010 → 1 block`，后续状态确认 `1 active` 摘要块。Billion Context 的原始内容、摘要和状态均由其自身管理。假模型使用量为固定测试值，不代表真实计费或压缩收益。

0.1.1 安装包为 `dist/dsh-plugin-fatloss-agent-0.1.1-2be77181.tgz`（同内容另存为普通版本文件名）。已更新 desktop profile；其 bundle 顺序、其他插件依赖和私密配置文件哈希均保持一致。安装包内的 Agent 与实际安装文件哈希一致。已有会话应在 DSH 重新启动后恢复，以使用新的预设作用域；不需要删除聊天。

## 2026-11-02 官方压缩兜底（0.1.2）

减脂预设新增隔离的官方 `@deepseek-ai/dsh-compaction-basic@0.2.1-rc.5` 与 `/compact`。没有 Billion bundle 时直接加载；同一 profile 启用 Billion 时，宿主先等待其 `biliBasicCompactionPolicy` 服务，再允许预设装配，由 Billion 的加载期协调器停用 Basic 和 `/compact`。不自动安装 Billion，不修改其他预设，不在请求中途切换压缩后端。安装、卸载或启停后需重启宿主，恢复会话后使用新装配。

自动化：根类型检查及 106 项后端测试通过；DSH 宿主/客户端类型检查及 17 项插件测试通过。新增测试验证 Basic 自动监听器的预设隔离，以及 Billion 协调器晚加载时等待。旧 Vue 页面没有修改。构建通过；打包时因沙箱不允许写默认 npm 缓存，改用临时缓存完成 `npm pack`，没有修改系统缓存权限。

实际宿主验收均使用本机 DSH 0.2.1-rc.5、隔离存储目录和本机假模型，没有发送真实画像、聊天或凭据：

| 场景 | 实际结果 |
| --- | --- |
| 未安装 Billion，`/tmp/fatloss-basic-verify` | Basic 存在且 `auto: true`；4 轮虚拟长对话触发 2 次 `compaction/start → summary → end`，摘要使用会话选中的 `compaction-fixture/fixture` |
| 启用 Billion 0.1.211，`/tmp/fatloss-dsh-verify` | 预设的 Basic 服务不存在；真实 `acp_status → compress → acp_status` 全部成功，10 条虚拟历史合为 1 个活跃摘要块 |
| Billion 包和协调器仍在，主入口停用并重启 | Basic 恢复且 `auto: true`；同样触发 2 次成功的官方摘要事务 |

前两项回执位于 `/tmp/fatloss-basic-result.json`、`/tmp/fatloss-billion-test/results-012.json` 和 `/tmp/fatloss-billion-receipt-012.jsonl`；停用场景回执位于 `/tmp/fatloss-billion-disabled-result.json`。这些临时文件只含虚拟测试信息。假模型结果不代表真实模型的摘要质量或计费收益。

交付包：`dist/dsh-plugin-fatloss-agent-0.1.2-2e5dfad3.tgz`，同内容另存普通版本文件名。SHA-256：`2e5dfad3943b93af06310a156077593578813c6ed99a4821f57ec455072dc49a`。已安装 desktop profile，实际 `lib/index.js`、`lib/agent.js` 和 bundle patch 与构建文件一致；安装前后其他依赖规格、bundle 顺序、`cordis.yml` 和私密 `cordis.patch.yml` 哈希一致。未强行重启正在使用的桌面应用，重启后新预设装配生效。

源码中的 `test/billion-fixture-provider.mjs` 仅用于上述本地验收，不进入发布包。验收截图为 `dist/dsh-billion-context-acceptance.png`，仅包含虚拟会话。
