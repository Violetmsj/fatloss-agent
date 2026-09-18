import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const TIME_ZONE = "Asia/Shanghai";

/** Intl 负责按目标时区拆字段，避免结果受服务器自身时区影响。 */
function shanghaiParts(date: Date): Record<string, string> {
  return Object.fromEntries(new Intl.DateTimeFormat("zh-CN", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).map((part) => [part.type, part.value]));
}

export function createGetCurrentTimeTool(now: () => number = Date.now) {
  return defineTool({
    name: "get_current_time",
    label: "获取当前时间",
    description: "获取当前的 Asia/Shanghai 日期、时间和星期。回答当前日期时间，或把今天、明天、下周、月底、最近等相对时间转换为绝对日期前使用；不得自行猜测当前日期。",
    parameters: Type.Object({}, { additionalProperties: false }),
    async execute() {
      // 时钟以依赖形式注入，测试无需修改全局 Date 或等待真实时间流逝。
      const date = new Date(now());
      const parts = shanghaiParts(date);
      const result = {
        localDateTime: `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+08:00`,
        utcDateTime: date.toISOString(),
        date: `${parts.year}-${parts.month}-${parts.day}`,
        time: `${parts.hour}:${parts.minute}:${parts.second}`,
        weekday: new Intl.DateTimeFormat("zh-CN", { timeZone: TIME_ZONE, weekday: "long" }).format(date),
        timezone: TIME_ZONE,
      };
      // content 提供给模型继续推理，details 保留相同结构供 UI 或测试使用。
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }], details: result };
    },
  });
}
