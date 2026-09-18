import type { UIMessage } from "ai";

export interface ProfileInput {
    gender: string;
    age: number;
    weightKg: number;
    heightCm: number;
    bodyFatPct: number;
    waistCm: number;
    hipCm: number | null;
    goal: string;
    targetBodyFatPct: number;
    dailyEnergyDeficitKcal: number;
    dietExercisePreference: string;
    activityFrequency: string;
    jobType: string;
    favoriteExercises: string[];
    equipment: string[];
    stairResponse: string;
    focusArea: string;
    trainingDays: string[];
}

export interface Profile extends ProfileInput {
    updatedAt: string;
}

export interface FormOptions {
    genders: readonly string[];
    goals: readonly string[];
    dietExercisePreferences: readonly string[];
    activityFrequencies: readonly string[];
    jobTypes: readonly string[];
    exercises: readonly string[];
    equipment: readonly string[];
    stairResponses: readonly string[];
    focusAreas: readonly string[];
    trainingDays: readonly string[];
}

export interface NumberConstraint {
    minimum: number;
    maximum?: number;
    integer?: boolean;
    optional?: boolean;
    maximumField?: string;
}

export interface SelectionConstraint {
    minimum: number;
    maximum: number;
    exclusive?: string;
}

export interface ProfileFormDefinition {
    options: FormOptions;
    constraints: {
        age: NumberConstraint;
        weightKg: NumberConstraint;
        heightCm: NumberConstraint;
        bodyFatPct: NumberConstraint;
        waistCm: NumberConstraint;
        hipCm: NumberConstraint;
        targetBodyFatPct: NumberConstraint;
        dailyEnergyDeficitKcal: NumberConstraint;
        favoriteExercises: SelectionConstraint;
        equipment: SelectionConstraint;
        trainingDays: SelectionConstraint;
    };
}

export interface ProfileResponse extends ProfileFormDefinition {
    profile: Profile | null;
}

export interface FatLossEstimate {
    leanMassKg: number;
    targetWeightKg: number;
    fatLossKg: number;
    estimatedDays: number;
    estimatedWeeks: number;
    speed: string;
}

export interface ProfilePreview {
    profile: Profile;
    summary: string;
    estimate: FatLossEstimate;
}

export interface Conversation {
    id: string;
    name?: string;
    firstMessage: string;
    messageCount: number;
    createdAt: string;
    modifiedAt: string;
}

interface ApiErrorBody {
    error?: { code?: string; message?: string };
}

export class ApiError extends Error {
    constructor(
        public readonly status: number,
        public readonly code: string,
        message: string,
    ) {
        super(message);
    }
}

/** 统一处理 JSON 请求、业务错误结构和 204 空响应，页面只关心成功数据或 ApiError。 */
async function request<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, {
        ...init,
        headers: { "content-type": "application/json", ...init?.headers },
    });
    if (!response.ok) {
        const body = await response.json().catch(() => ({})) as ApiErrorBody;
        throw new ApiError(response.status, body.error?.code ?? "REQUEST_FAILED", body.error?.message ?? "请求失败，请稍后重试。");
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
}

// 页面使用的普通 REST 接口；聊天流由 @ai-sdk/vue 的 DefaultChatTransport 单独管理。
export const api = {
    getProfile: () => request<ProfileResponse>("/api/profile"),
    previewProfile: (profile: ProfileInput) => request<ProfilePreview>("/api/profile/preview", { method: "POST", body: JSON.stringify(profile) }),
    saveProfile: (profile: ProfileInput) => request<ProfilePreview>("/api/profile", { method: "PUT", body: JSON.stringify(profile) }),
    listConversations: async () => (await request<{ conversations: Conversation[] }>("/api/conversations")).conversations,
    createConversation: async () => (await request<{ conversation: Conversation }>("/api/conversations", { method: "POST" })).conversation,
    renameConversation: (id: string, name: string) => request<void>(`/api/conversations/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ name }) }),
    getMessages: async (id: string) => (await request<{ messages: UIMessage[] }>(`/api/conversations/${encodeURIComponent(id)}/messages`)).messages,
};
