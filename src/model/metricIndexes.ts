/**
 * Metric indexes the signed-in user may search.
 * Splunk's `index=*` wildcard does not match internal indexes. The app names the metric indexes
 * returned for this user and keeps only those their role ACL allows.
 */

export type IndexRecord = { name: string; datatype?: string };

const INDEX_NAME = /^[A-Za-z0-9_.-]+$/;
const ROLE_NAME = /^[A-Za-z0-9_-]+$/;

/** Splunk index wildcards. A pattern that does not start with `_` never matches an internal index. */
export function indexPatternAllows(pattern: string, name: string): boolean {
    if (!INDEX_NAME.test(name) || !pattern) {
        return false;
    }
    if (name.startsWith('_') && !pattern.startsWith('_')) {
        return false;
    }
    const body = pattern
        .split('*')
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*');
    return new RegExp(`^${body}$`).test(name);
}

function asList(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((item) => item.trim());
    }
    if (typeof value === 'string' && value.trim()) {
        return [value.trim()];
    }
    return [];
}

function entryContent(body: unknown): Record<string, unknown> {
    const entries =
        body && typeof body === 'object' && Array.isArray((body as { entry?: unknown }).entry)
            ? (body as { entry: unknown[] }).entry
            : [];
    const first = entries[0];
    if (!first || typeof first !== 'object') {
        return {};
    }
    const content = (first as { content?: unknown }).content;
    return content && typeof content === 'object' ? (content as Record<string, unknown>) : {};
}

/** Metric index names the patterns allow, in name order. An empty pattern list allows none. */
export function allowedMetricIndexNames(indexes: IndexRecord[], patterns: string[]): string[] {
    const rules = patterns.map((pattern) => pattern.trim()).filter(Boolean);
    return indexes
        .filter((index) => index.datatype === 'metric' && INDEX_NAME.test(index.name) && rules.some((rule) => indexPatternAllows(rule, index.name)))
        .map((index) => index.name)
        .sort();
}

function indexRecords(body: unknown): IndexRecord[] {
    const entries =
        body && typeof body === 'object' && Array.isArray((body as { entry?: unknown }).entry)
            ? (body as { entry: unknown[] }).entry
            : [];
    return entries.flatMap((item) => {
        if (!item || typeof item !== 'object') {
            return [];
        }
        const record = item as { name?: unknown; content?: unknown };
        const content = record.content && typeof record.content === 'object' ? (record.content as { datatype?: unknown }) : {};
        return [
            {
                name: typeof record.name === 'string' ? record.name : '',
                datatype: typeof content.datatype === 'string' ? content.datatype : undefined,
            },
        ];
    });
}

/**
 * Loads metric indexes for the current user.
 * `datatype=metric` is required: the plain indexes endpoint omits metric indexes, including `_metrics`.
 * Role ACLs are applied when Splunk returns them. If the role endpoint is not readable, the index list
 * from this user's session is used as Splunk returned it.
 */
export async function loadAllowedMetricIndexes(get: (path: string) => Promise<unknown>): Promise<string[]> {
    const indexes = indexRecords(await get('/services/data/indexes?count=-1&datatype=metric&output_mode=json'));
    let patterns: string[] | null = null;
    try {
        const roles = asList(entryContent(await get('/services/authentication/current-context?output_mode=json')).roles);
        const collected: string[] = [];
        const seen = new Set<string>();
        const queue = [...roles];
        while (queue.length > 0 && seen.size < 20) {
            const role = queue.shift() ?? '';
            if (!ROLE_NAME.test(role) || seen.has(role)) {
                continue;
            }
            seen.add(role);
            const content = entryContent(await get(`/services/authorization/roles/${encodeURIComponent(role)}?output_mode=json`));
            collected.push(...asList(content.srchIndexesAllowed));
            queue.push(...asList(content.imported_roles));
        }
        patterns = collected;
    } catch {
        patterns = null;
    }
    if (patterns === null) {
        return indexes
            .filter((index) => index.datatype === 'metric' && INDEX_NAME.test(index.name))
            .map((index) => index.name)
            .sort();
    }
    return allowedMetricIndexNames(indexes, patterns);
}
