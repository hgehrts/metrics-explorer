import { metricIndexClause } from '../spl/buildMstats';
import { SearchPayload } from '../search/runSearch';

/** One count per metric index, for the catalog time range. An index with no rows received nothing. */
export function buildIndexActivitySearch(indexes?: string[]): string {
    return `| mstats count WHERE ${metricIndexClause(indexes)} BY index`;
}

/** Index names that returned a row. mstats omits indexes with no metric data in the window. */
export function indexesWithData(payload: SearchPayload): string[] {
    const names = new Set<string>();
    for (const row of payload.results ?? []) {
        const name = typeof row.index === 'string' ? row.index.trim() : '';
        if (name) {
            names.add(name);
        }
    }
    return [...names].sort();
}
