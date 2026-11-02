import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** 插件与手动维护命令共用同一默认存储位置。 */
export function resolveDataDirectory(directory?: string): string {
    return resolve(directory || join(process.env.DSH_HOME || join(homedir(), ".dsh"), "storages/fatloss-agent"));
}
