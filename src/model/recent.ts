export type RecentEntry = {
    id: string;
    name: string;
    metric: string;
    savedAt: number;
    state: string;
};

const MAX_RECENT = 12;

function key(user: string): string {
    return `metrics-explorer.recent.v1.${user || 'default'}`;
}

/** The part after the last dot, plus the minute the chart was opened. */
export function recentName(metric: string, at: number): string {
    const parts = metric.split('.').map((item) => item.trim()).filter(Boolean);
    const leaf = parts[parts.length - 1] || metric.trim() || 'chart';
    const stamp = new Date(at);
    const pad = (value: number): string => String(value).padStart(2, '0');
    return `${leaf} ${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())} ${pad(stamp.getHours())}:${pad(stamp.getMinutes())}`;
}

export function readRecent(user: string): RecentEntry[] {
    try {
        const body = JSON.parse(window.localStorage.getItem(key(user)) ?? '[]') as unknown;
        if (!Array.isArray(body)) {
            return [];
        }
        return body.flatMap((item) => {
            if (!item || typeof item !== 'object') {
                return [];
            }
            const row = item as Partial<RecentEntry>;
            if (typeof row.id !== 'string' || typeof row.name !== 'string' || typeof row.state !== 'string' || typeof row.savedAt !== 'number') {
                return [];
            }
            return [{ id: row.id, name: row.name, metric: typeof row.metric === 'string' ? row.metric : row.name, savedAt: row.savedAt, state: row.state }];
        });
    } catch {
        return [];
    }
}

/** Keeps the newest experiments. The same chart is not stored twice. */
export function rememberRecent(user: string, metric: string, state: string, at: number, chartId: string): RecentEntry[] {
    const entry: RecentEntry = { id: chartId, name: recentName(metric, at), metric, savedAt: at, state };
    const next = [entry, ...readRecent(user).filter((item) => item.id !== chartId)].slice(0, MAX_RECENT);
    try {
        window.localStorage.setItem(key(user), JSON.stringify(next));
    } catch {
        // A full browser store still leaves the explorer usable.
    }
    return next;
}
