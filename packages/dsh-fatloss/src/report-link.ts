// DSH 的 Markdown 渲染器不保留纯 hash 链接；使用保留的 localhost 域名，
// 客户端在捕获阶段转为插件内导航，不访问网络。
export function reportUrl(id: string): string {
    return `https://fatloss.localhost/reports/${encodeURIComponent(id)}`;
}

export function reportIdFromUrl(href: string): string | undefined {
    const match = href.match(/^https:\/\/fatloss\.localhost\/reports\/([a-f0-9-]+)$/);
    return match?.[1];
}
