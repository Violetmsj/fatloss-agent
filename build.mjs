import { build } from "esbuild";
import { WorkspaceTypertGenerator, writePackageArtifacts } from "@deepseek-ai/dsh-typert-generator";
import { readFile, writeFile, mkdir, mkdtemp, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const packageRoot = import.meta.dirname;
const root = packageRoot;
const generateOnly = process.argv.includes("--generate-only");
if (!generateOnly) await rm(join(packageRoot, "lib"), { recursive: true, force: true });
await mkdir(join(packageRoot, "lib"), { recursive: true });

// 0.2.1 的生成器以工作区源码位置识别装饰器，不识别 npm 声明的位置。
// 使用实际控制器源文件和等价的装饰器声明构造仅用于反射的临时工作区；
// 运行时、正式类型检查与打包始终使用真实 SDK，不修改第三方依赖。
const temporary = await mkdtemp(join(tmpdir(), "fatloss-typert-"));
try {
    const project = join(temporary, "packages/plugin");
    await mkdir(join(project, "src"), { recursive: true });
    await symlink(join(root, "node_modules"), join(temporary, "node_modules"), "dir");
    const controller = (await readFile(join(packageRoot, "src/host/controller.ts"), "utf8"))
        .replace(/^import type \{ ProfileInput \}.*\n/m, "")
        .replace('from "../types.ts"', 'from "./types.ts"');
    await writeFile(join(project, "src/index.ts"), controller);
    await writeFile(join(project, "src/types.ts"), await readFile(join(packageRoot, "src/types.ts"), "utf8"));
    await writeFile(join(project, "src/protocol.d.ts"), `declare module "@deepseek-ai/dsh-typert-protocol" {
        export declare function Remote(name: string | {mode: "stream"}): any;
        export declare class TypertRemoteService {
            readonly ctx: import("@deepseek-ai/cordis").Context;
            constructor(ctx: import("@deepseek-ai/cordis").Context, key: string, options?: {namespace: string});
        }
    }`);
    const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
    await writeFile(join(project, "package.json"), JSON.stringify({ name: manifest.name,
        exports: { ".": "./src/index.ts", "./types": "./src/types.ts", "./typert": manifest.exports["./typert"], "./remote": manifest.exports["./remote"] }, files: manifest.files }));
    await writeFile(join(project, "tsconfig.json"), JSON.stringify({ compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext", target: "ES2024", skipLibCheck: true }, include: ["src/**/*"] }));
    await writeFile(join(temporary, "tsconfig.host.json"), JSON.stringify({ compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext", target: "ES2024", skipLibCheck: true }, files: [], references: [{ path: "./packages/plugin" }] }));
    const artifacts = new WorkspaceTypertGenerator(temporary, { checkDiagnostics: false }).generate([manifest.name], ["host"]);
    if (!artifacts[0]?.remote) throw new Error("没有生成减脂 Remote 接口。");
    writePackageArtifacts(packageRoot, artifacts);
} finally { await rm(temporary, { recursive: true, force: true }); }

if (generateOnly) {
    console.log("DSH Remote 接口生成完成。");
    process.exit(0);
}

await build({
    absWorkingDir: packageRoot, entryPoints: { index: "src/index.ts", agent: "src/agent.ts", types: "src/types.ts" },
    outdir: "lib", bundle: true, format: "esm", platform: "node", target: "node24", packages: "external", metafile: true,
    loader: { ".md": "text" },
});
execFileSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.build.json"], { cwd: packageRoot, stdio: "inherit" });
await build({ absWorkingDir: packageRoot, entryPoints: ["src/client/index.tsx"], outfile: "lib/client.js",
    bundle: true, format: "cjs", platform: "browser", target: "es2022", jsx: "automatic", external: ["react", "react/jsx-runtime"],
    banner: { js: 'window.__ModuleLoader__.load({id:"dsh-plugin-fatloss-agent",factory:function(require){const module={exports:{}};const exports=module.exports;' },
    footer: { js: 'return module.exports;}});' },
});
console.log("DSH 宿主、客户端与 Remote 接口构建完成。");
