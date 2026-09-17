# 减脂 TUI Agent

一个仅供个人使用的中文减脂陪伴助手。它运行在 [pi](https://github.com/earendil-works/pi) 的原生终端 TUI 中，首次使用时采集减脂问卷，并将当前画像保存到本地 SQLite。

## 启动

要求：Node.js 24（或至少 Node.js 22.19）。

```bash
npm install
npm run tui
```

首次启动时，pi 会请求信任项目扩展；确认信任后，若没有画像会自动进入建档流程。聊天需要先在 pi 中配置或登录任一模型提供方；本项目不会保存 API Key，也不绑定特定供应商。

常用命令：

- `/onboard`：填写或覆盖当前画像。
- `/profile`：查看当前画像和粗略周期估算。

## 知识库

减脂问答知识源文件存放在 [knowledge_doc/减脂-问答汇总.md](knowledge_doc/减脂-问答汇总.md)，无需转换成 TXT；二级标题中的每一个问答会成为一个或多个语义检索片段。`knowledge_doc/` 用于放置后续知识文档，`src/knowledge/` 则只放知识库的 TypeScript 实现。

首次使用前，在两个终端分别执行：

```bash
# 终端一：启动本机 Chroma，数据保存在 data/chroma/
npm run chroma

# 终端二：首次仅需复制示例配置并填写百炼 API Key 与向量接口地址
cp .env.example .env

# 索引和 TUI 命令都会自动读取 .env
npm run kb:index
npm run tui
```

`npm run kb:index` 只在你修改问答 Markdown 后手动运行。聊天时，助手会检索最多 3 条相关片段，并在答案末尾标明原问题标题。百炼 `qwen3.7-text-embedding-flash` 会接收用于建库的文档内容及每次检索问题；Chroma 向量数据仍仅保存在本机。API Key 位于 `.env`，不会被提交到 Git。切换嵌入模型或向量维度后，也必须重新执行一次 `npm run kb:index`，不能将不同模型生成的向量混用。

## 数据与边界

- 用户画像保存在 `data/fatloss.sqlite`、知识库向量保存在 `data/chroma/`，均不会被提交到 Git。
- 每日总能量缺口为饮食控制与活动合计的目标，限制在 300–1000 千卡。
- 周期估算使用静态热量换算，只适合粗略参考；实际结果会受代谢变化、体脂测量误差和执行情况影响。
- 助手只提供一般成人健康生活方式建议，不能替代医生或注册营养师的诊断与治疗。

## 开发验证

```bash
npm run typecheck
npm test
```
