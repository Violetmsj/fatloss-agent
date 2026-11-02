import assert from "node:assert/strict";
import test from "node:test";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { resolveDataDirectory } from "../../src/host/data-directory.ts";

test("插件与维护命令默认使用 DSH 存储目录，显式目录优先", t => {
    const previous = process.env.DSH_HOME;
    t.after(() => {
        if (previous === undefined) delete process.env.DSH_HOME;
        else process.env.DSH_HOME = previous;
    });
    delete process.env.DSH_HOME;
    assert.equal(resolveDataDirectory(), join(homedir(), ".dsh/storages/fatloss-agent"));
    process.env.DSH_HOME = "/tmp/fatloss-directory-fixture";
    assert.equal(resolveDataDirectory(), "/tmp/fatloss-directory-fixture/storages/fatloss-agent");
    assert.equal(resolveDataDirectory("./test-fixture"), resolve("./test-fixture"));
});
