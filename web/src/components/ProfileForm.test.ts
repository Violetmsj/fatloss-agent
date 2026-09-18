// @vitest-environment jsdom
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProfileFormDefinition, ProfileInput } from "../api";
import ProfileForm from "./ProfileForm.vue";

const definition: ProfileFormDefinition = {
    options: {
        genders: ["男", "女"], goals: ["减脂"], dietExercisePreferences: ["吃动平衡派"], activityFrequencies: ["偶尔锻炼"], jobTypes: ["轻体力工作"], exercises: ["步行", "跑步"], equipment: ["哑铃", "不使用器械"], stairResponses: ["几乎没感觉"], focusAreas: ["全身"], trainingDays: ["一", "二", "三", "四", "五", "六", "日"],
    },
    constraints: {
        age: { minimum: 18, maximum: 100, integer: true }, weightKg: { minimum: 20, maximum: 400 }, heightCm: { minimum: 80, maximum: 250 }, bodyFatPct: { minimum: 1, maximum: 70 }, waistCm: { minimum: 30, maximum: 250 }, hipCm: { minimum: 30, maximum: 250, optional: true }, targetBodyFatPct: { minimum: 1, maximumField: "bodyFatPct" }, dailyEnergyDeficitKcal: { minimum: 300, maximum: 1000, integer: true }, favoriteExercises: { minimum: 0, maximum: 2 }, equipment: { minimum: 1, maximum: 2, exclusive: "不使用器械" }, trainingDays: { minimum: 3, maximum: 7 },
    },
};
const profile: ProfileInput = {
    gender: "男", age: 30, weightKg: 80, heightCm: 178, bodyFatPct: 25, waistCm: 90, hipCm: null, goal: "减脂", targetBodyFatPct: 18, dailyEnergyDeficitKcal: 500, dietExercisePreference: "吃动平衡派", activityFrequency: "偶尔锻炼", jobType: "轻体力工作", favoriteExercises: ["步行"], equipment: ["哑铃"], stairResponse: "几乎没感觉", focusArea: "全身", trainingDays: ["一", "三", "五"],
};
const responseBody = {
    profile: { ...profile, updatedAt: "2026-09-18T00:00:00.000Z" },
    summary: "画像摘要",
    estimate: { leanMassKg: 60, targetWeightKg: 72, fatLossKg: 8, estimatedDays: 123, estimatedWeeks: 18, speed: "缓慢" },
};

afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
});

describe("画像表单完整提交", () => {
    it("先预览，确认后才保存并发出 saved", async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify(responseBody), { status: 200, headers: { "content-type": "application/json" } }))
            .mockResolvedValueOnce(new Response(JSON.stringify(responseBody), { status: 200, headers: { "content-type": "application/json" } }));
        vi.stubGlobal("fetch", fetchMock);
        vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
        const wrapper = mount(ProfileForm, { props: { definition, initialProfile: profile }, attachTo: document.body });

        await wrapper.get("form").trigger("submit");
        await flushPromises();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(document.body.textContent).toContain("确认你的减脂画像");

        const confirm = [...document.body.querySelectorAll("button")].find((button) => button.textContent?.includes("确认并保存"));
        expect(confirm).toBeTruthy();
        (confirm as HTMLButtonElement).click();
        await flushPromises();
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(wrapper.emitted("saved")?.length).toBe(1);
        wrapper.unmount();
    });
});
