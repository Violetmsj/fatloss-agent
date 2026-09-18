// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { defineComponent, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ChatImageAttachments from "./ChatImageAttachments.vue";
import ChatImageUploadButton from "./ChatImageUploadButton.vue";
import { PromptInput, PromptInputBody, PromptInputTextarea } from "./ai-elements/prompt-input";

const Harness = defineComponent({
    components: { ChatImageAttachments, ChatImageUploadButton, PromptInput, PromptInputBody, PromptInputTextarea },
    setup() {
        const errors = ref<string[]>([]);
        return { errors };
    },
    template: `
        <PromptInput accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif" multiple :max-files="4" :max-file-size="5 * 1024 * 1024" @error="errors.push($event.code)">
            <ChatImageAttachments />
            <PromptInputBody><PromptInputTextarea /></PromptInputBody>
            <ChatImageUploadButton />
        </PromptInput>
    `,
});

function chooseFiles(wrapper: ReturnType<typeof mount>, files: File[]): Promise<void> {
    const input = wrapper.get<HTMLInputElement>('input[type="file"]');
    Object.defineProperty(input.element, "files", { configurable: true, value: files });
    return input.trigger("change");
}

beforeEach(() => {
    vi.stubGlobal("URL", {
        ...URL,
        createObjectURL: vi.fn((file: File) => `blob:${file.name}`),
        revokeObjectURL: vi.fn(),
    });
});

afterEach(() => vi.unstubAllGlobals());

describe("聊天图片附件", () => {
    it("显示所选图片并允许发送前移除", async () => {
        const wrapper = mount(Harness);
        await chooseFiles(wrapper, [new File(["image"], "早餐.png", { type: "image/png" })]);

        expect(wrapper.findAll(".image-attachment")).toHaveLength(1);
        expect(wrapper.text()).toContain("早餐.png");
        await wrapper.get('button[aria-label="移除 早餐.png"]').trigger("click");
        expect(wrapper.findAll(".image-attachment")).toHaveLength(0);
    });

    it("限制图片类型、大小和单次数量", async () => {
        const wrapper = mount(Harness);
        await chooseFiles(wrapper, [new File(["text"], "说明.txt", { type: "text/plain" })]);
        expect((wrapper.vm as unknown as { errors: string[] }).errors).toContain("accept");

        await chooseFiles(wrapper, [new File([new Uint8Array(5 * 1024 * 1024 + 1)], "大图.png", { type: "image/png" })]);
        expect((wrapper.vm as unknown as { errors: string[] }).errors).toContain("max_file_size");

        await chooseFiles(wrapper, Array.from({ length: 5 }, (_, index) => new File(["image"], `${index}.png`, { type: "image/png" })));
        expect((wrapper.vm as unknown as { errors: string[] }).errors).toContain("max_files");
        expect(wrapper.findAll(".image-attachment")).toHaveLength(4);
    });
});
