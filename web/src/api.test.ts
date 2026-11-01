import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("减脂报告 API", () => {
    it("筛选报告并安全编码报告 ID", async () => {
        const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ reports: [], total: 0, page: 1, pageSize: 20 }), { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);
        await api.listReports({ type: "weekly", fromDate: "2025-01-01", page: 2 });
        expect(fetchMock.mock.calls[0][0]).toBe("/api/reports?type=weekly&fromDate=2025-01-01&page=2");
        await api.getReport("test/id");
        expect(fetchMock.mock.calls[1][0]).toBe("/api/reports/test%2Fid");
    });
});

describe("会话思考强度 API", () => {
    it("读取当前档位，并提交用户选择的档位", async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({
            level: "low",
            availableLevels: ["off", "low", "high"],
        }), { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);

        await expect(api.getConversationThinking("conversation-id")).resolves.toEqual({
            level: "low",
            availableLevels: ["off", "low", "high"],
        });
        await expect(api.setConversationThinking("conversation-id", "high")).resolves.toEqual({
            level: "low",
            availableLevels: ["off", "low", "high"],
        });

        expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/conversations/conversation-id/thinking", {
            headers: { "content-type": "application/json" },
        });
        expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/conversations/conversation-id/thinking", {
            method: "PUT",
            body: JSON.stringify({ level: "high" }),
            headers: { "content-type": "application/json" },
        });
    });
});
