import type { Context } from "@deepseek-ai/cordis";

/** 会话与预设任一方释放时，都移除该会话的注册与后台任务。 */
export function ownAgentEffects(owner: Context) {
    const active = new Map<Context, () => Promise<void>>();
    owner.effect(() => async () => {
        await Promise.allSettled([...active.values()].map(dispose => dispose()));
        active.clear();
    });
    return (local: Context, setup: () => () => void | Promise<void>): void => {
        const dispose = local.effect(() => {
            const stop = setup();
            return async () => { active.delete(local); await stop(); };
        });
        active.set(local, dispose);
    };
}
