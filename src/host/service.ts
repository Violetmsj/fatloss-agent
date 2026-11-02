import { Service, type Context } from "@deepseek-ai/cordis";
import { join } from "node:path";
import { resolveDataDirectory } from "./data-directory.ts";
import { ChromaClient } from "chromadb";
import { ProfileRepository } from "../core/database.ts";
import { MemoryStore } from "../core/memory-store.ts";
import { DailyRecordStore } from "../core/daily-record-store.ts";
import { ReportService } from "../core/reports/service.ts";
import { validateReportFilter } from "../core/reports/store.ts";
import { profileFormDefinition } from "../core/profile-form.ts";
import { validateProfile, formatProfile, calculateEstimate, type ProfileInput } from "../core/profile.ts";
import { FoodCompositionCatalog } from "../core/food-composition.ts";
import { KnowledgeService } from "../core/knowledge/service.ts";
import { DashScopeEmbeddingClient } from "../core/knowledge/embeddings.ts";
import { ChromaKnowledgeStore } from "../core/knowledge/chroma.ts";
import { createFatlossTools } from "../core/tools/index.ts";
import type { FatlossTool } from "../core/tools/definition.ts";

export interface FatlossConfiguration {
    dataDirectory?: string;
    embeddingApiKey?: string;
    embeddingUrl?: string;
    chromaHost?: string;
    chromaPort?: number;
}

export class FatlossService extends Service {
    readonly host: Context;
    readonly repository: ProfileRepository;
    readonly memories: MemoryStore;
    readonly records: DailyRecordStore;
    readonly reports: ReportService;
    readonly tools: FatlossTool[];
    private readonly listeners = new Set<() => void>();
    readonly cancellation = new AbortController();
    private readonly running = new Set<Promise<unknown>>();

    constructor(ctx: Context, readonly configuration: FatlossConfiguration) {
        super(ctx, "fatloss");
        this.host = ctx;
        const directory = resolveDataDirectory(configuration.dataDirectory);
        this.repository = new ProfileRepository(join(directory, "fatloss.sqlite"));
        this.memories = new MemoryStore(this.repository.db);
        this.records = new DailyRecordStore(this.repository.db);
        this.reports = new ReportService(this.repository.db);
        const knowledge = new KnowledgeService(
            new DashScopeEmbeddingClient(fetch, { DASHSCOPE_API_KEY: configuration.embeddingApiKey, DASHSCOPE_EMBEDDING_URL: configuration.embeddingUrl }),
            new ChromaKnowledgeStore(new ChromaClient({ host: configuration.chromaHost || process.env.CHROMA_HOST || "localhost", port: configuration.chromaPort ?? Number(process.env.CHROMA_PORT || 8000) })),
        );
        this.tools = createFatlossTools(this.repository, this.memories, { catalog: new FoodCompositionCatalog(join(directory, "reference/food-composition-full.csv")) }, knowledge) as unknown as FatlossTool[];
        ctx.effect(() => async () => {
            this.cancellation.abort();
            await Promise.allSettled([...this.running]);
            this.listeners.clear();
            this.repository.close();
        });
    }

    async run<T>(operation: () => Promise<T>): Promise<T> {
        this.cancellation.signal.throwIfAborted();
        const task = operation();
        this.running.add(task);
        try { return await task; } finally { this.running.delete(task); }
    }

    changed(): void { for (const listener of this.listeners) listener(); }
    subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
    profile() { return { profile: this.repository.get(), ...profileFormDefinition }; }
    preview(input: ProfileInput) {
        validateProfile(input);
        const profile = { ...input, updatedAt: new Date().toISOString() };
        return { profile, summary: formatProfile(profile), estimate: calculateEstimate(input) };
    }
    save(input: ProfileInput) {
        const result = this.repository.save(input);
        this.changed();
        return { profile: result, summary: formatProfile(result) };
    }
    listReports(filter: unknown) { return this.reports.store.list(validateReportFilter(filter as import("../core/reports/types.ts").ReportFilter)); }
    report(id: string) {
        const report = this.reports.get(id);
        if (!report) throw new Error("报告不存在。");
        return report;
    }
    status() {
        const missingConfiguration = [
            !(this.configuration.embeddingApiKey || process.env.DASHSCOPE_API_KEY)?.trim() && "embeddingApiKey（DASHSCOPE_API_KEY）",
            !(this.configuration.embeddingUrl || process.env.DASHSCOPE_EMBEDDING_URL)?.trim() && "embeddingUrl（DASHSCOPE_EMBEDDING_URL）",
        ].filter((value): value is string => !!value);
        return {
            initialized: true,
            hasProfile: this.repository.get() !== null,
            knowledgeConfigured: missingConfiguration.length === 0,
            missingConfiguration,
            message: "减脂画像、记录、长期记忆与报告保存在独立的 DSH 存储目录。",
        };
    }
}

declare module "@deepseek-ai/cordis" {
    interface Context { fatloss: FatlossService; }
}
