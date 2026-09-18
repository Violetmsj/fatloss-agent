import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Value } from "typebox/value";

import { ProfileRepository } from "../src/database.ts";
import { getToolTitle, presentToolInput, presentToolOutput } from "../src/server/tool-presentation.ts";
import { createGetCurrentTimeTool } from "../src/tools/get-current-time.ts";
import { createFatlossTools } from "../src/tools/index.ts";

const FIXED_TIME = Date.parse("2026-09-18T10:23:45.678Z");

test("当前时间工具固定返回上海时区的结构化时间", async () => {
  const tool = createGetCurrentTimeTool(() => FIXED_TIME);
  const result = await tool.execute("call-time", {}, undefined, undefined, {} as never);

  assert.deepEqual(result.details, {
    localDateTime: "2026-09-18T18:23:45+08:00",
    utcDateTime: "2026-09-18T10:23:45.678Z",
    date: "2026-09-18",
    time: "18:23:45",
    weekday: "星期五",
    timezone: "Asia/Shanghai",
  });
  assert.deepEqual(JSON.parse(result.content[0]?.type === "text" ? result.content[0].text : ""), result.details);
  assert.equal(Value.Check(tool.parameters, {}), true);
  assert.equal(Value.Check(tool.parameters, { timezone: "UTC" }), false);
});

test("当前时间工具加入统一白名单并使用简洁 Web 展示", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "fatloss-time-"));
  const repository = new ProfileRepository(join(directory, "test.sqlite"));
  t.after(() => { repository.close(); rmSync(directory, { recursive: true, force: true }); });

  assert.ok(createFatlossTools(repository).some((tool) => tool.name === "get_current_time"));
  assert.equal(getToolTitle("get_current_time"), "获取当前时间");
  assert.deepEqual(presentToolInput("get_current_time", {}), {});
  assert.deepEqual(presentToolOutput("get_current_time"), { summary: "获取当前时间完成" });
});

test("系统提示词要求相对时间先查当前时间并保留记忆期限兜底", () => {
  const prompt = readFileSync(new URL("../.pi/SYSTEM.md", import.meta.url), "utf8");
  assert.match(prompt, /相对时间转换成绝对日期/);
  assert.match(prompt, /先单独调用 `get_current_time` 并等待结果/);
  assert.match(prompt, /`expiresAt` 传 `null`/);
});
