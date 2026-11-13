import { quoteSpl } from '../spl/buildMstats';

export type SavedEventSearch = { key: string; name: string; spl: string };

export type AppSearchGroup = { app: string; searches: string[] };

export function eventSearchNameOk(name: string): boolean {
    const trimmed = name.trim();
    return trimmed.length > 0 && trimmed.length <= 80 && !/[\r\n]/.test(trimmed);
}

/** Rows from the app KV store. Incomplete documents are left out. */
export function eventSearchesFrom(body: unknown): SavedEventSearch[] {
    if (!Array.isArray(body)) {
        return [];
    }
    return body
        .flatMap((item) => {
            if (!item || typeof item !== 'object') {
                return [];
            }
            const row = item as { _key?: unknown; name?: unknown; spl?: unknown };
            const key = typeof row._key === 'string' ? row._key : '';
            const name = typeof row.name === 'string' ? row.name.trim() : '';
            const spl = typeof row.spl === 'string' ? row.spl.trim() : '';
            if (!key || !name || !spl) {
                return [];
            }
            return [{ key, name, spl }];
        })
        .sort((left, right) => left.name.localeCompare(right.name));
}

/** Saved searches from other apps, grouped by the app that owns them. */
export function searchesByApp(body: unknown, skipApp: string): AppSearchGroup[] {
    const entries =
        body && typeof body === 'object' && Array.isArray((body as { entry?: unknown }).entry)
            ? (body as { entry: unknown[] }).entry
            : [];
    const grouped = new Map<string, string[]>();
    for (const item of entries) {
        if (!item || typeof item !== 'object') {
            continue;
        }
        const record = item as { name?: unknown; acl?: { app?: unknown } };
        const name = typeof record.name === 'string' ? record.name.trim() : '';
        const app = record.acl && typeof record.acl.app === 'string' ? record.acl.app : '';
        if (!name || !app || app === skipApp || name.startsWith('MX Base - ')) {
            continue;
        }
        const list = grouped.get(app) ?? [];
        list.push(name);
        grouped.set(app, list);
    }
    return [...grouped.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([app, searches]) => ({
            app,
            searches: [...new Set(searches)].sort((left, right) => left.localeCompare(right)),
        }));
}

/** Runs a saved search in the chart's time window. */
export function savedSearchSpl(name: string): string {
    return `| savedsearch ${quoteSpl(name)}`;
}
