import { createServer } from "node:http";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

import { createServerApp } from "./app.ts";
import { ConversationSessionRegistry } from "./conversation-registry.ts";

const host = "127.0.0.1";
const port = Number(process.env.PORT ?? "3000");
if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error("PORT 必须是有效端口号。");

// ModelRuntime 负责模型目录与认证，整个进程只创建一份供所有会话复用。
const modelRuntime = await ModelRuntime.create();
const registry = new ConversationSessionRegistry({ cwd: process.cwd(), modelRuntime });
const { app, profiles } = createServerApp({ registry });
const server = createServer(app);

let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`收到 ${signal}，正在关闭 Web 服务…`);
  // 先停止接受新连接，再释放 AgentSession 和 SQLite；重复信号只执行一次。
  server.close();
  await registry.disposeAll();
  profiles.close();
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

server.listen(port, host, () => {
  console.log(`减脂 Agent Web 服务已启动：http://${host}:${port}`);
});
