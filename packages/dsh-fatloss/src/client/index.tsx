import React, { useEffect, useState } from "react";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-ui-layout/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import { brandString } from "@deepseek-ai/dsh-brand";
import type { MainPanelId } from "@deepseek-ai/dsh-client-ui-layout/client";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar/client";
import type {} from "@deepseek-ai/dsh-client-ui-workspace/client";
import type {} from "@deepseek-ai/dsh-api-remotes/client";
import contribution from "../../lib/typert.remote-client.js";
import { profileFormDefinition } from "../../../../src/profile-form.ts";
import { REPORT_TITLES, type ReportList, type ReportView } from "../../../../src/reports/types.ts";
import type { Profile, ProfileInput } from "../../../../src/profile.ts";
import { validateProfile } from "../../../../src/profile.ts";
import { css } from "./style.ts";
import { reportIdFromUrl } from "../report-link.ts";

export const inject = ["slots", "layout", "remote", "uiWorkspace"];

const labels: Record<keyof ProfileInput, string> = {
    gender: "性别", age: "年龄", weightKg: "体重（kg）", heightCm: "身高（cm）", bodyFatPct: "体脂率（%）",
    waistCm: "腰围（cm）", hipCm: "臀围（cm，选填）", targetBodyFatPct: "目标体脂率（%）",
    dailyEnergyDeficitKcal: "每日能量缺口（千卡）", dietExercisePreference: "饮食运动偏好", activityLevel: "当前活动水平",
    jobType: "工作类型", favoriteExercises: "喜欢的运动（最多两项）", equipment: "可用器械", stairResponse: "爬楼感受", focusArea: "重点部位", trainingDays: "计划训练日（至少三天）",
};
const options = profileFormDefinition.options;
const choices = {
    gender: options.genders, dietExercisePreference: options.dietExercisePreferences,
    activityLevel: options.activityLevels.map(option => option.value), jobType: options.jobTypes,
    stairResponse: options.stairResponses, focusArea: options.focusAreas,
    favoriteExercises: options.exercises, equipment: options.equipment, trainingDays: options.trainingDays,
};
const emptyProfile = (): ProfileInput => ({ gender: "" as never, age: 30, weightKg: 70, heightCm: 170, bodyFatPct: 25,
    waistCm: 80, hipCm: null, targetBodyFatPct: 20, dailyEnergyDeficitKcal: 500,
    dietExercisePreference: "" as never, activityLevel: "" as never, jobType: "" as never,
    favoriteExercises: [], equipment: [], stairResponse: "" as never, focusArea: "全身", trainingDays: [] });

export function apply(ctx: Context): void {
    ctx.remote.$mount(contribution);
    ctx.inject(["remote.fatloss"], local => mount(local));
}

function mount(ctx: Context): void {
    const api = ctx.remote.fatloss;
    const navigate = (id?: string) => {
        if (id) window.dispatchEvent(new CustomEvent("fatloss:report", { detail: id }));
        ctx.layout.selectPanel(brandString<MainPanelId>("fatloss"));
    };
    const call = async <T,>(operation: Promise<{ ok: true; value: T } | { ok: false; error: Error }>): Promise<T> => {
        const result = await operation;
        if (!result.ok) throw result.error;
        return result.value;
    };

    function ProfileForm({ initial, saved }: { initial: Profile | null; saved: () => void }) {
        const [form, setForm] = useState<ProfileInput>(() => initial ? { ...initial, activityLevel: initial.activityLevel ?? "" as never } : emptyProfile());
        const [preview, setPreview] = useState<{ summary: string; profile: Profile } | null>(null);
        const [error, setError] = useState("");
        const [busy, setBusy] = useState(false);
        const change = (key: keyof ProfileInput, value: unknown) => { setPreview(null); setForm(previous => ({ ...previous, [key]: value })); };
        const toggle = (key: "equipment" | "favoriteExercises" | "trainingDays", value: string) => {
            const current = form[key] as string[];
            let next = current.includes(value) ? current.filter(item => item !== value) : [...current, value];
            if (key === "equipment") next = value === "不使用器械" && next.includes(value) ? [value] : next.filter(item => item !== "不使用器械");
            change(key, next);
        };
        const run = async (operation: () => Promise<void>) => { setBusy(true); setError(""); try { await operation(); } catch (e) { setError(e instanceof Error ? e.message : "操作失败，请重试。"); } finally { setBusy(false); } };
        return <section><h2>{initial ? "我的减脂画像" : "建立减脂画像"}</h2><p className="muted">填写当前情况，预览并确认后保存。个人数据仅用于你的减脂陪伴。</p>
            <form onSubmit={event => { event.preventDefault(); void run(async () => { validateProfile(form); setPreview(JSON.parse(await call(api.previewProfile(JSON.stringify(form))))); }); }}>
                <fieldset disabled={busy}><div className="fields">{Object.keys(labels).map(field => {
                    const key = field as keyof ProfileInput;
                    const values = choices[key as keyof typeof choices];
                    return <div className="field" key={key}><span>{labels[key]}</span>{Array.isArray(form[key]) ? <div className="checks">{values?.map(value => <label key={value}><input type="checkbox" checked={(form[key] as string[]).includes(value)} onChange={() => toggle(key as "equipment", value)}/>{value}</label>)}</div> : values ? <select aria-label={labels[key]} value={String(form[key] ?? "")} onChange={e => change(key, e.target.value)} required><option value="">请选择</option>{values.map(value => <option key={value} value={value}>{value}</option>)}</select> : <input aria-label={labels[key]} type="number" step={key === "age" || key === "dailyEnergyDeficitKcal" ? 1 : "any"} value={form[key] ?? ""} required={key !== "hipCm"} onChange={e => change(key, e.target.value === "" && key === "hipCm" ? null : Number(e.target.value))}/>}</div>;
                })}</div><button type="submit">预览并校验</button></fieldset>
            </form>{error && <p role="alert" className="error">{error}</p>}
            {preview && <div className="confirmation" role="dialog" aria-label="确认减脂画像"><h3>请确认以下画像</h3><pre>{preview.summary}</pre><button disabled={busy} onClick={() => void run(async () => { await call(api.saveProfile(JSON.stringify(form))); setPreview(null); saved(); })}>确认保存</button><button disabled={busy} onClick={() => setPreview(null)}>返回修改</button></div>}
        </section>;
    }

    function Panel() {
        const [tab, setTab] = useState("profile");
        const [profile, setProfile] = useState<Profile | null>(null);
        const [loaded, setLoaded] = useState(false);
        const [error, setError] = useState("");
        const [notice, setNotice] = useState("");
        const [revision, setRevision] = useState(0);
        const [connection, setConnection] = useState(0);
        const [page, setPage] = useState(1);
        const [type, setType] = useState("");
        const [fromDate, setFrom] = useState("");
        const [toDate, setTo] = useState("");
        const [reports, setReports] = useState<ReportList | null>(null);
        const [report, setReport] = useState<ReportView | null>(null);
        const openReport = async (id: string) => { try { setReport(JSON.parse(await call(api.getReport(id)))); setTab("reports"); } catch (e) { setError((e as Error).message); } };
        useEffect(() => {
            const controller = new AbortController();
            const refresh = async () => {
                try {
                    const [stored, status] = await Promise.all([call(api.getProfile()), call(api.status())]);
                    if (controller.signal.aborted) return;
                    setProfile(JSON.parse(stored)); setLoaded(true); setError("");
                    setNotice(status.knowledgeConfigured ? "" : `知识库待补充：${status.missingConfiguration.join("、")}；画像、记录与报告仍可使用。`);
                } catch (e) { if (!controller.signal.aborted) setError((e as Error).message); }
            };
            void refresh();
            const stream = api.changes(controller.signal);
            void (async () => { try { for await (const _ of stream) { await refresh(); setRevision(value => value + 1); } } catch (e) { if (!controller.signal.aborted) setError((e as Error).message); } })();
            const reconnect = () => setConnection(value => value + 1);
            window.addEventListener("focus", reconnect);
            const off = ctx.on("connection/reset", reconnect);
            const onReport = (event: Event) => void openReport((event as CustomEvent<string>).detail);
            window.addEventListener("fatloss:report", onReport);
            const match = window.location.hash.match(/^#fatloss-report=(.+)$/);
            if (match) void openReport(decodeURIComponent(match[1]));
            return () => { controller.abort(); stream.dispose(); off(); window.removeEventListener("focus", reconnect); window.removeEventListener("fatloss:report", onReport); };
        }, [connection]);
        useEffect(() => {
            if (!report) return;
            let active = true;
            void call(api.getReport(report.id)).then(value => { if (active) setReport(JSON.parse(value)); }).catch(e => { if (active) setError(e.message); });
            return () => { active = false; };
        }, [revision, report?.id]);
        useEffect(() => {
            if (tab !== "reports") return;
            let active = true;
            void call(api.listReports(JSON.stringify({ ...(type ? { type } : {}), ...(fromDate ? { fromDate } : {}), ...(toDate ? { toDate } : {}), page, pageSize: 10 })))
                .then(value => { if (active) setReports(JSON.parse(value)); }).catch(e => { if (active) setError(e.message); });
            return () => { active = false; };
        }, [tab, page, type, fromDate, toDate, revision]);
        const download = async () => {
            if (!report) return;
            try {
                const markdown = await call(api.exportReport(report.id));
                const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
                const a = document.createElement("a"); a.href = url; a.download = `减脂报告-${report.fromDate}-v${report.version}.md`; a.click(); URL.revokeObjectURL(url);
            } catch (e) { setError((e as Error).message); }
        };
        return <div className="fatloss-app"><header><div><small>你的日常陪伴</small><h1>减脂陪伴</h1></div><button disabled={!profile} onClick={() => ctx.uiWorkspace.startSession(undefined, { agentPreset: "fatloss" })}>开始减脂聊天 ↗</button></header>
            <nav aria-label="减脂页面"><button aria-current={tab === "profile"} onClick={() => setTab("profile")}>我的画像</button><button aria-current={tab === "reports"} onClick={() => setTab("reports")}>减脂报告</button></nav>
            {notice && <p className="notice">{notice}</p>}{error && <p role="alert" className="error">{error}<button onClick={() => setConnection(value => value + 1)}>刷新</button></p>}
            {!loaded ? <p>正在读取减脂数据…</p> : tab === "profile" ? <ProfileForm key={profile?.updatedAt ?? "new"} initial={profile} saved={() => { void call(api.getProfile()).then(value => setProfile(JSON.parse(value))); }}/>
                : <section><h2>我的减脂报告</h2><p className="muted">通过聊天生成日报、周报、月报、年报或自定义报告，这里保留统计快照和历史版本。</p>
                    <div className="filters"><select aria-label="报告类型" value={type} onChange={e => { setType(e.target.value); setPage(1); }}><option value="">全部类型</option>{Object.entries(REPORT_TITLES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
                        <input aria-label="开始日期" type="date" value={fromDate} onChange={e => { setFrom(e.target.value); setPage(1); }}/><input aria-label="结束日期" type="date" value={toDate} onChange={e => { setTo(e.target.value); setPage(1); }}/></div>
                    {reports?.reports.length === 0 && <p>暂无报告。开始减脂聊天后，可以说“生成本周报告”。</p>}
                    <div className="report-list">{reports?.reports.map(item => <button key={item.id} onClick={() => void openReport(item.id)}><strong>{REPORT_TITLES[item.type]}</strong><span>{item.fromDate} — {item.toDate}</span><span>版本 {item.version} · {item.summaryStatus === "complete" ? "总结已保存" : "统计已保存"}</span></button>)}</div>
                    <div className="pagination"><button disabled={page === 1} onClick={() => setPage(value => value - 1)}>上一页</button><span>第 {page} 页 · 共 {reports?.total ?? 0} 份</span><button disabled={!reports || page * 10 >= reports.total} onClick={() => setPage(value => value + 1)}>下一页</button></div>
                    {report && <article><div className="report-heading"><h3>{REPORT_TITLES[report.type]}</h3><button onClick={() => void download()}>导出 Markdown</button></div>{report.stale && <p className="notice">这是已保存的历史快照，源记录已有变化；需要更新时请在聊天中明确提出。</p>}
                        <label>历史版本 <select value={report.id} onChange={e => void openReport(e.target.value)}>{report.versions.map(version => <option value={version.id} key={version.id}>版本 {version.version} · {version.createdAt}</option>)}</select></label><pre className="markdown">{report.markdown}</pre></article>}
                </section>}
        </div>;
    }

    ctx.slots.inject("main", () => ctx.slots.register({ name: "main", key: "fatloss" }, Panel));
    ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({ name: "sidebar.panellist", id: "fatloss", label: "减脂陪伴", order: 45 }, () => <span aria-hidden="true">◉</span>));
    ctx.effect(() => {
        const style = document.createElement("style"); style.textContent = css; document.head.appendChild(style);
        const open = (event: MouseEvent) => {
            const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[href]");
            const id = reportIdFromUrl(anchor?.getAttribute("href") ?? "");
            if (id) { event.preventDefault(); event.stopImmediatePropagation(); window.location.hash = `fatloss-report=${id}`; navigate(id); }
        };
        document.addEventListener("click", open, true);
        return () => { style.remove(); document.removeEventListener("click", open, true); };
    });
}
