import { metricIndexClause, quoteSpl } from '../spl/buildMstats';

/**
 * A filter on the data pane. `index` limits the catalog to an index. `exclude` hides metric names that match a pattern.
 * Filters only narrow what the tree shows. They are a convenience, not an access control: Splunk index permissions still apply.
 */
export type DataFilter = { kind: 'index' | 'exclude'; value: string };

const INDEX_VALUE = /^[A-Za-z0-9_.-]+$/;
const EXCLUDE_VALUE = /^[A-Za-z0-9_.:*-]+$/;

export function filterLabel(filter: DataFilter): string {
    return filter.kind === 'index' ? `index = ${filter.value}` : `metric name not ${filter.value}`;
}

/** Returns an error message for an invalid filter value, or null when it can be used. */
export function validateFilter(filter: DataFilter): string | null {
    const value = filter.value.trim();
    if (!value) {
        return 'Enter a value.';
    }
    if (filter.kind === 'index' && !INDEX_VALUE.test(value)) {
        return 'An index name may contain letters, digits, dots, underscores, and dashes.';
    }
    if (filter.kind === 'exclude' && !EXCLUDE_VALUE.test(value)) {
        return 'Use letters, digits, dots, colons, dashes, underscores, and * as a wildcard.';
    }
    return null;
}

const FIELD = /^[A-Za-z0-9_.:-]+$/;

/**
 * The catalog search for the tree, with the active filters applied.
 * With `by`, the search returns one row per value of that dimension, for the grouped tree.
 * `metricIndexes` is the metric indexes the signed-in user may search. It replaces `index=*`,
 * which never includes an internal index such as `_metrics`.
 */
export function buildCatalogSearch(filters: DataFilter[], by = '', metricIndexes?: string[]): string {
    const indexes = filters.filter((item) => item.kind === 'index').map((item) => item.value.trim());
    const excludes = filters.filter((item) => item.kind === 'exclude').map((item) => item.value.trim());
    const allowed = metricIndexes === undefined ? null : new Set(metricIndexes);
    const chosen = allowed ? (indexes.length > 0 ? indexes.filter((value) => allowed.has(value)) : metricIndexes) : indexes;
    const clauses = [
        metricIndexes === undefined && indexes.length === 0
            ? 'index=*'
            : metricIndexes === undefined
              ? `(${indexes.map((value) => `index=${quoteSpl(value)}`).join(' OR ')})`
              : metricIndexClause(chosen),
        ...excludes.map((value) => `NOT metric_name=${quoteSpl(value)}`),
    ];
    if (by && !FIELD.test(by)) {
        throw new Error('Dimension name is not allowed.');
    }
    return `| mcatalog values(metric_name) WHERE ${clauses.join(' AND ')}${by ? ` BY ${by}` : ''}`;
}

/** Turns the settings of a `[defaults]` stanza into filters. Lists are comma separated. */
export function filtersFromStanza(content: Record<string, string | undefined>): DataFilter[] {
    const split = (value: string | undefined): string[] =>
        (value ?? '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
    const filters: DataFilter[] = [
        ...split(content.indexes).map((value) => ({ kind: 'index' as const, value })),
        ...split(content.metric_name_exclude).map((value) => ({ kind: 'exclude' as const, value })),
    ];
    return filters.filter((item) => validateFilter(item) === null);
}

/**
 * Picks the defaults for the user. A `defaults:role_<name>` stanza wins over `defaults` when the user has that role.
 * Among several matching role stanzas, the first one in the order Splunk returns them is used.
 */
export function pickDefaults(
    stanzas: Array<{ name: string; content: Record<string, string | undefined> }>,
    roles: string[]
): DataFilter[] {
    for (const stanza of stanzas) {
        const match = /^defaults:role_(.+)$/.exec(stanza.name);
        if (match && roles.includes(match[1])) {
            return filtersFromStanza(stanza.content);
        }
    }
    const base = stanzas.find((stanza) => stanza.name === 'defaults');
    return base ? filtersFromStanza(base.content) : [];
}

/**
 * An index named in the URL, as another app opens the explorer with `?index=<name>`.
 * It is checked like any index filter, and an invalid value is ignored.
 */
export function indexFromSearch(search: string): string | null {
    const value = new URLSearchParams(search).get('index')?.trim() ?? '';
    return value && validateFilter({ kind: 'index', value }) === null ? value : null;
}
