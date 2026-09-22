import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";

import { createWebResourceLoaderOptions } from "../src/server/conversation-registry.ts";

test("Web 资源加载器只启用显式指定的项目扩展", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "fatloss-web-extensions-"));
  const cwd = join(directory, "project");
  const agentDir = join(directory, "agent");
  const projectExtensions = join(cwd, ".pi", "extensions");
  const globalExtensions = join(agentDir, "extensions");
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(projectExtensions, { recursive: true });
  await mkdir(globalExtensions, { recursive: true });
  await writeFile(join(projectExtensions, "fatloss-agent.ts"), "export default function () {}\n", "utf8");
  await writeFile(join(globalExtensions, "session-recap.ts"), "export default function () {}\n", "utf8");

  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    ...createWebResourceLoaderOptions(cwd),
  });
  await loader.reload();

  const extensions = loader.getExtensions().extensions;
  assert.equal(extensions.length, 1);
  assert.equal(extensions[0]?.resolvedPath, join(projectExtensions, "fatloss-agent.ts"));
});
