import { metricIndexClause, quoteSpl } from '../spl/buildMstats';

/**
 * A filter on the data pane. `index` limits the catalog to an index. `exclude` hides metric names that match a pattern.
 * Filters only narrow what the tree shows. They are a convenience, not an access control: Splunk index permissions still apply.
 */
export type DataFilter =
    | { kind: 'index' | 'exclude'; value: string }
    /** A "dimension = value(s)" pair. Values may end in or contain `*`. `value` is the label, so filters compare as text. */
    | { kind: 'dimension'; value: string; dimension: string; op: '=' | '!='; values: string[] };

const INDEX_VALUE = /^[A-Za-z0-9_.-]+$/;
const EXCLUDE_VALUE = /^[A-Za-z0-9_.:*-]+$/;
const DIMENSION_VALUE = /^[^\r\n"\\]{1,200}$/;
const FIELD = /^[A-Za-z0-9_.:-]+$/;

export function dimensionFilter(dimension: string, op: '=' | '!=', values: string[]): DataFilter {
    const cleaned = [...new Set(values.map((item) => item.trim()).filter(Boolean))];
    return { kind: 'dimension', dimension: dimension.trim(), op, values: cleaned, value: `${dimension.trim()}${op}${cleaned.join(',')}` };
}

export function filterLabel(filter: DataFilter): string {
    if (filter.kind === 'dimension') {
        return `${filter.dimension} ${filter.op} ${filter.values.join(', ')}`;
    }
    return filter.kind === 'index' ? `index = ${filter.value}` : `metric name not ${filter.value}`;
}

/** Returns an error message for an invalid filter value, or null when it can be used. */
export function validateFilter(filter: DataFilter): string | null {
    if (filter.kind === 'dimension') {
        if (!FIELD.test(filter.dimension)) {
            return 'Select a dimension.';
        }
        if (filter.values.length === 0) {
            return 'Select at least one value.';
        }
        if (filter.values.length > 50 || !filter.values.every((item) => DIMENSION_VALUE.test(item))) {
            return 'Use at most 50 values without quotes, backslashes, or line breaks.';
        }
        return null;
    }
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

/** `dim="a" OR dim="b"`, negated for `!=`. Quoted values keep `*` as a wildcard in mcatalog and mstats. */
function dimensionClause(filter: Extract<DataFilter, { kind: 'dimension' }>): string {
    const any = filter.values.map((value) => `${filter.dimension}=${quoteSpl(value)}`).join(' OR ');
    return filter.op === '=' ? `(${any})` : `NOT (${any})`;
}

/**
 * Index part of the catalog search: the chosen index filters, limited to the indexes the user may search.
 * `explicit` means the filter list is the whole selection. An empty list then matches no index.
 * Without it, an empty list means every index the user may search.
 */
function indexPart(filters: DataFilter[], metricIndexes?: string[], explicit = false): string {
    const indexes = filters.filter((item) => item.kind === 'index').map((item) => item.value.trim());
    if (explicit) {
        const allowed = metricIndexes === undefined ? indexes : indexes.filter((value) => metricIndexes.includes(value));
        return metricIndexClause(allowed);
    }
    const allowed = metricIndexes === undefined ? null : new Set(metricIndexes);
    const chosen = allowed ? (indexes.length > 0 ? indexes.filter((value) => allowed.has(value)) : metricIndexes) : indexes;
    return metricIndexes === undefined && indexes.length === 0
        ? 'index=*'
        : metricIndexes === undefined
          ? `(${indexes.map((value) => `index=${quoteSpl(value)}`).join(' OR ')})`
          : metricIndexClause(chosen);
}

/** Values of one dimension in the indexes the filter form has chosen, for the value picker. */
export function buildCatalogValueSearch(dimension: string, filters: DataFilter[], metricIndexes?: string[]): string {
    if (!FIELD.test(dimension)) {
        throw new Error('Dimension name is not allowed.');
    }
    const field = quoteSpl(dimension);
    return `| mcatalog values(metric_name) WHERE ${indexPart(filters, metricIndexes)} AND NOT metric_name="*_mrollup_*" BY ${field} | fields ${field} | head 1000`;
}

/**
 * The catalog search for the tree, with the active filters applied.
 * With `by`, the search returns one row per value of that dimension, for the grouped tree.
 * `metricIndexes` is the metric indexes the signed-in user may search. It replaces `index=*`,
 * which never includes an internal index such as `_metrics`.
 */
export function buildCatalogSearch(filters: DataFilter[], by = '', metricIndexes?: string[], explicitIndexes = false): string {
    const excludes = filters.filter((item) => item.kind === 'exclude').map((item) => item.value.trim());
    const clauses = [
        indexPart(filters, metricIndexes, explicitIndexes),
        ...excludes.map((value) => `NOT metric_name=${quoteSpl(value)}`),
        ...filters.flatMap((item) => (item.kind === 'dimension' && validateFilter(item) === null ? [dimensionClause(item)] : [])),
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
