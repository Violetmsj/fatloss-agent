import { parseArgs } from "node:util";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { importData } from "./data.ts";

const { values } = parseArgs({ options: { from: { type: "string" }, to: { type: "string" } } });
if (!values.from) throw new Error("用法：node lib/migrate.js --from 原项目的data目录 [--to 目标目录]");
const destination = values.to ?? join(process.env.DSH_HOME || join(homedir(), ".dsh"), "storages/fatloss-agent");
await importData(resolve(values.from), resolve(destination));
console.log("减脂数据副本已导入；原数据库未修改。");
