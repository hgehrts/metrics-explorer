import { metricIndexClause } from '../spl/buildMstats';
import { SearchPayload } from '../search/runSearch';

/** One count per metric index, for the catalog time range. An index with no rows received nothing. */
export function buildIndexActivitySearch(indexes?: string[]): string {
    // mstats rejects a search that has no metric_name filter, which left every dot blank.
    return `| mstats count WHERE metric_name="*" AND ${metricIndexClause(indexes)} BY index`;
}

/** Index names that returned a row. mstats omits indexes with no metric data in the window. */
export function indexesWithData(payload: SearchPayload, known: string[] = []): string[] {
    const allowed = new Set(known);
    const names = new Set<string>();
    for (const row of payload.results ?? []) {
        const named = typeof row.index === 'string' ? row.index.trim() : '';
        if (named) {
            names.add(named);
        }
        if (allowed.size === 0) {
            continue;
        }
        for (const [key, value] of Object.entries(row)) {
            if (key.startsWith('_') || typeof value !== 'string') {
                continue;
            }
            const text = value.trim();
            if (allowed.has(text)) {
                names.add(text);
            }
        }
    }
    return [...names].sort();
}
