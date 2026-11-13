import { resolveEventFunction, resolveMetricFunction } from './functions';
import { parseTimeShift } from './timeShift';

const IDENTIFIER = /^[A-Za-z0-9_.:-]+$/;
const SPAN = /^\d+(s|m|h|d)$/;

export function quoteSpl(value: string): string {
    if (/[\r\n]/.test(value)) {
        throw new Error('Line breaks are not allowed.');
    }
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

const INDEX_NAME = /^[A-Za-z0-9_.-]+$/;

/**
 * Index clause for metric searches.
 * `undefined` keeps `index=*`, which does not include internal indexes such as `_metrics`.
 * A list names every metric index the caller's Splunk ACL allows, including internal ones.
 */
export function metricIndexClause(indexes?: string[]): string {
    if (indexes === undefined) {
        return 'index=*';
    }
    const names = [...new Set(indexes.filter((name) => INDEX_NAME.test(name)))].sort();
    if (names.length === 0) {
        return 'index="__mx_none__"';
    }
    if (names.length === 1) {
        return `index=${quoteSpl(names[0])}`;
    }
    return `(${names.map((name) => `index=${quoteSpl(name)}`).join(' OR ')})`;
}

/** mpreview takes one index. Public indexes stay on `*`; each internal index is appended. */
function mpreviewSearch(filter: string, indexes?: string[]): string {
    const quoted = quoteSpl(filter);
    if (indexes === undefined) {
        return `| mpreview index=* filter=${quoted}`;
    }
    const names = [...new Set(indexes.filter((name) => INDEX_NAME.test(name)))].sort();
    const targets = [...(names.some((name) => !name.startsWith('_')) ? ['*'] : []), ...names.filter((name) => name.startsWith('_'))];
    const chosen = targets.length > 0 ? targets : ['__mx_none__'];
    const head = `| mpreview index=${chosen[0] === '*' ? '*' : quoteSpl(chosen[0])} filter=${quoted}`;
    const rest = chosen.slice(1).map((name) => `| append [| mpreview index=${quoteSpl(name)} filter=${quoted}]`);
    return [head, ...rest].join(' ');
}

function assertIdentifier(value: string, label: string): void {
    if (!IDENTIFIER.test(value)) {
        throw new Error(`${label} is not allowed.`);
    }
}

export const SPLIT_LIMITS = [3, 5, 10, 20, 50, 100, 200, 500] as const;

/**
 * Dimensions of one metric. No mvexpand: it would drop the only row of a metric without dimensions,
 * and then the search would never report that the metric has none.
 */
export function buildDimensionSearch(metric: string, indexes?: string[]): string {
    assertIdentifier(metric, 'Metric name');
    return `| mcatalog values(_dims) WHERE metric_name=${quoteSpl(metric)} AND ${metricIndexClause(indexes)} AND NOT metric_name="*_mrollup_*"`;
}

export type MetricFilter = {
    dimension: string;
    mode: 'include' | 'exclude';
    values: string[];
};

/** Every dimension in the catalog, for the global split-by list. */
export function buildAllDimensionSearch(indexes?: string[]): string {
    return `| mcatalog values(_dims) WHERE ${metricIndexClause(indexes)} AND NOT metric_name="*_mrollup_*" | mvexpand values(_dims)`;
}

/** Distinct values of one dimension across the metrics of the selected chart. */
export function buildTrellisValueSearch(metrics: string[], dimension: string, indexes?: string[]): string {
    assertIdentifier(dimension, 'Filter field');
    const names = [...new Set(metrics.map((name) => name.trim()).filter(Boolean))];
    if (names.length === 0) {
        throw new Error('Metric name is not allowed.');
    }
    names.forEach((name) => assertIdentifier(name, 'Metric name'));
    const metricClause = names.map((name) => `metric_name=${quoteSpl(name)}`).join(' OR ');
    const field = quoteSpl(dimension);
    const where = names.length === 1 ? metricClause : `(${metricClause})`;
    return `| mcatalog values(metric_name) WHERE ${where} AND ${metricIndexClause(indexes)} AND NOT metric_name="*_mrollup_*" BY ${field} | fields ${field}`;
}

export function buildDimensionValueSearch(metric: string, dimension: string, indexes?: string[]): string {
    assertIdentifier(metric, 'Metric name');
    assertIdentifier(dimension, 'Filter field');
    const field = quoteSpl(dimension);
    return `| mcatalog values(metric_name) WHERE metric_name=${quoteSpl(metric)} AND ${metricIndexClause(indexes)} AND NOT metric_name="*_mrollup_*" BY ${field} | fields ${field}`;
}

function filterClause(filters: MetricFilter[] | undefined): string {
    if (!filters || filters.length === 0) {
        return '';
    }
    const parts = filters.map((filter) => {
        assertIdentifier(filter.dimension, 'Filter field');
        if (filter.mode !== 'include' && filter.mode !== 'exclude') {
            throw new Error('Filter mode is not allowed.');
        }
        if (filter.values.length === 0 || filter.values.length > 50) {
            throw new Error('Filter needs between 1 and 50 values.');
        }
        const terms = filter.values.map((value) => `${quoteSpl(filter.dimension)}=${quoteSpl(value)}`);
        const group = terms.length === 1 ? terms[0] : `(${terms.join(' OR ')})`;
        return filter.mode === 'exclude' ? `NOT ${group}` : group;
    });
    return parts.join(' AND ');
}

/** ` BY dim | sort -value | head N`. Categorical charts rank split values over the whole time range. */
function categoryTail(input: { splitBy?: string; splitLimit?: number; splitDirection?: 'highest' | 'lowest' }): string {
    const field = input.splitBy ?? '';
    assertIdentifier(field, 'Split field');
    const limit = input.splitLimit ?? 5;
    if (!SPLIT_LIMITS.includes(limit as (typeof SPLIT_LIMITS)[number])) {
        throw new Error('Split limit is not allowed.');
    }
    return ` BY ${field} | sort ${input.splitDirection === 'lowest' ? '' : '-'}value | head ${limit}`;
}

export function buildMstats(input: {
    aggregation: string;
    metric: string;
    span: string;
    index?: string;
    splitBy?: string;
    splitLimit?: number;
    splitDirection?: 'highest' | 'lowest';
    timeShift?: string;
    filters?: MetricFilter[];
    /** Metric indexes the user may search. Omitted keeps `index=*`. */
    indexes?: string[];
    /** One value for the whole time range, per split value. The original categorical charts search this way. */
    categorical?: boolean;
    /** Kept as its own column so a dashboard trellis can split on it. The line split stays beside it. */
    trellisBy?: string;
}): string {
    const aggregation = resolveMetricFunction(input.aggregation);
    if (!aggregation) {
        throw new Error('Unknown aggregation.');
    }
    if (input.categorical && aggregation.rate) {
        throw new Error('Rate aggregations are not available for a categorical chart.');
    }
    assertIdentifier(input.metric, 'Metric name');
    if (!input.categorical && !SPAN.test(input.span)) {
        throw new Error('Span is not allowed.');
    }
    const index = input.index ?? '*';
    const indexClause = index === '*' ? metricIndexClause(input.indexes) : `index=${quoteSpl(index)}`;
    if (index !== '*') {
        assertIdentifier(index, 'Index');
    }
    const metric = quoteSpl(input.metric);
    const base = `| mstats ${aggregation.name}(${metric})`;
    const extra = filterClause(input.filters);
    const where = extra ? `${indexClause} AND ${extra}` : indexClause;
    if (input.trellisBy) {
        assertIdentifier(input.trellisBy, 'Filter field');
        const groups = [input.trellisBy];
        if (input.splitBy) {
            assertIdentifier(input.splitBy, 'Split field');
            groups.push(input.splitBy);
        }
        const span = input.categorical ? '' : ` span=${input.span}`;
        return `${base} WHERE ${where}${span} BY ${groups.join(', ')}${timeShiftClause(input.timeShift)}`;
    }
    if (input.categorical) {
        const aggregate = `${base} AS value WHERE ${where}`;
        return input.splitBy ? `${aggregate}${categoryTail(input)}` : aggregate;
    }
    if (!input.splitBy) {
        return `${base} WHERE ${where} span=${input.span}${timeShiftClause(input.timeShift)}`;
    }
    assertIdentifier(input.splitBy, 'Split field');
    const limit = input.splitLimit ?? 5;
    if (!SPLIT_LIMITS.includes(limit as (typeof SPLIT_LIMITS)[number])) {
        throw new Error('Split limit is not allowed.');
    }
    const rank = input.splitDirection === 'lowest' ? `min in bottom${limit}` : `max in top${limit}`;
    const shifted = `${base} AS value WHERE ${where} span=${input.span} BY ${input.splitBy}${timeShiftClause(input.timeShift)}`;
    return `${shifted} | chart useother=false first(value) over _time BY ${input.splitBy} WHERE ${rank}`;
}

/** One number for a reference line. The time window is a job parameter, not part of this string. */
export function buildReferenceValueSearch(input: {
    aggregation: string;
    metric: string;
    filters?: MetricFilter[];
    indexes?: string[];
}): string {
    const aggregation = resolveMetricFunction(input.aggregation);
    if (!aggregation || aggregation.chart !== 'line' || aggregation.rate || aggregation.name.startsWith('upperperc')) {
        throw new Error('Unknown aggregation.');
    }
    assertIdentifier(input.metric, 'Metric name');
    const extra = filterClause(input.filters);
    const where = extra ? `${metricIndexClause(input.indexes)} AND ${extra}` : metricIndexClause(input.indexes);
    return `| mstats ${aggregation.name}(${quoteSpl(input.metric)}) AS value WHERE ${where}`;
}

/** index=* includes metrics indexes, and tstats then returns nothing. Name the event indexes instead. */
function eventIndexClause(indexes: string[] | undefined): string {
    const usable = (indexes ?? []).filter((name) => /^[A-Za-z0-9_.-]+$/.test(name));
    const chosen = usable.length > 0 ? usable : ['_internal', '_audit', 'main'];
    return `(${chosen.map((name) => `index=${quoteSpl(name)}`).join(' OR ')})`;
}

/** Lists sourcetypes, but only in event indexes. tstats rejects a where clause that includes a metrics index. */
export function buildSourcetypeSearch(indexes: string[]): string {
    const usable = indexes.filter((name) => /^[A-Za-z0-9_.-]+$/.test(name));
    const where = eventIndexClause(usable);
    return `| tstats count where ${where} by sourcetype`;
}

/** A tstats search for an event sourcetype or a data model, one point per span. */
export function buildTstats(input: {
    source: 'event' | 'dataset';
    name: string;
    aggregation: string;
    span: string;
    field?: string;
    splitBy?: string;
    splitLimit?: number;
    splitDirection?: 'highest' | 'lowest';
    timeShift?: string;
    filters?: MetricFilter[];
    indexes?: string[];
    categorical?: boolean;
}): string {
    const aggregation = resolveEventFunction(input.aggregation);
    if (!aggregation) {
        throw new Error('Unknown aggregation.');
    }
    if (!input.categorical && !SPAN.test(input.span)) {
        throw new Error('Span is not allowed.');
    }
    const field = (input.field ?? '').trim();
    if (aggregation.name !== 'count') {
        assertIdentifier(field, 'Field');
    }
    const call = aggregation.name === 'count' ? 'count' : `${aggregation.name}(${quoteSpl(field)})`;
    const extra = filterClause(input.filters);
    let from: string;
    if (input.source === 'dataset') {
        assertIdentifier(input.name, 'Data model');
        from = `from datamodel=${input.name}${extra ? ` where ${extra}` : ''}`;
    } else {
        if (/[\r\n]/.test(input.name)) {
            throw new Error('Line breaks are not allowed.');
        }
        const where = [eventIndexClause(input.indexes), `sourcetype=${quoteSpl(input.name)}`, extra].filter(Boolean).join(' AND ');
        from = `where ${where}`;
    }
    const base = `| tstats ${call} AS value ${from}`;
    if (input.categorical) {
        return input.splitBy ? `${base}${categoryTail(input)}` : base;
    }
    if (!input.splitBy) {
        return `${base} by _time span=${input.span}${timeShiftClause(input.timeShift)}`;
    }
    assertIdentifier(input.splitBy, 'Split field');
    const limit = input.splitLimit ?? 5;
    if (!SPLIT_LIMITS.includes(limit as (typeof SPLIT_LIMITS)[number])) {
        throw new Error('Split limit is not allowed.');
    }
    const rank = input.splitDirection === 'lowest' ? `min in bottom${limit}` : `max in top${limit}`;
    return `${base} by _time span=${input.span}, ${input.splitBy}${timeShiftClause(input.timeShift)} | chart useother=false first(value) over _time BY ${input.splitBy} WHERE ${rank}`;
}

const SKIP_FIELDS = new Set([
    '_raw',
    '_time',
    '_indextime',
    '_cd',
    'punct',
    'splunk_server',
    'linecount',
    'timestartpos',
    'timeendpos',
    'eventtype',
    'tag',
    'date_hour',
    'date_mday',
    'date_minute',
    'date_month',
    'date_second',
    'date_wday',
    'date_year',
    'date_zone',
]);

/**
 * Fields of one sourcetype or data model. tstats cannot list fields, so this samples events and summarizes them.
 * The sample is capped at 200 events.
 */
export function buildFieldSearch(source: 'event' | 'dataset', name: string, indexes: string[] = []): string {
    if (source === 'dataset') {
        assertIdentifier(name, 'Data model');
        return `| datamodel ${name} search | head 200 | fieldsummary maxvals=0 | fields field`;
    }
    if (/[\r\n]/.test(name)) {
        throw new Error('Line breaks are not allowed.');
    }
    return `search ${eventIndexClause(indexes)} sourcetype=${quoteSpl(name)} | head 200 | fieldsummary maxvals=0 | fields field`;
}

/** Field names a chart can aggregate or split by. Internal and time fields are dropped. */
export function readableFields(names: string[]): string[] {
    return [...new Set(names.filter((name) => IDENTIFIER.test(name) && !SKIP_FIELDS.has(name)))].sort();
}

/**
 * A base search keeps the metric, filters and split dimensions, and leaves the aggregation to the chart.
 * Metrics use mpreview so later charts can timechart the raw values.
 */
export function buildBaseSearchSpl(input: {
    source: 'metric' | 'event' | 'dataset';
    name: string;
    filters?: MetricFilter[];
    indexes?: string[];
    metricIndexes?: string[];
}): string {
    if (input.source === 'metric') {
        assertIdentifier(input.name, 'Metric name');
        const parts = [`metric_name=${input.name}`];
        for (const filter of input.filters ?? []) {
            if (filter.mode !== 'include') {
                continue;
            }
            assertIdentifier(filter.dimension, 'Filter field');
            for (const value of filter.values) {
                if (/[\r\n]/.test(value)) {
                    throw new Error('Line breaks are not allowed.');
                }
                parts.push(`${filter.dimension}=${quoteSpl(value)}`);
            }
        }
        return mpreviewSearch(parts.join(' AND '), input.metricIndexes);
    }
    if (input.source === 'dataset') {
        assertIdentifier(input.name, 'Data model');
        return `| datamodel ${input.name} search`;
    }
    return relatedEventsSearch({ source: 'event', name: input.name, filters: input.filters, indexes: input.indexes });
}

const BASE_PREFIX = 'MX Base - ';

export function baseSavedName(name: string): string {
    const trimmed = name.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9 _.:-]{0,60}$/.test(trimmed)) {
        throw new Error('Name is not allowed.');
    }
    return `${BASE_PREFIX}${trimmed}`;
}

/** The chart search on top of a base search. live runs it now; cached loads the last scheduled run. */
export function buildBaseChartSearch(input: {
    name: string;
    mode: 'live' | 'cached';
    owner: string;
    aggregation: string;
    span: string;
    field: string;
    splitBy?: string;
    splitLimit?: number;
    splitDirection?: 'highest' | 'lowest';
    categorical?: boolean;
}): string {
    const aggregation = resolveEventFunction(input.aggregation);
    if (!aggregation) {
        throw new Error('Unknown aggregation.');
    }
    if (!input.categorical && !SPAN.test(input.span)) {
        throw new Error('Span is not allowed.');
    }
    const field = input.field.trim();
    if (aggregation.name !== 'count') {
        assertIdentifier(field, 'Field');
    }
    if (!/^[A-Za-z0-9_.:-]+$/.test(input.owner)) {
        throw new Error('Owner is not allowed.');
    }
    const saved = baseSavedName(input.name);
    const head =
        input.mode === 'cached'
            ? `| loadjob savedsearch=${quoteSpl(`${input.owner}:metric_explorer_ng:${saved}`)}`
            : `| savedsearch ${quoteSpl(saved)}`;
    const call = aggregation.name === 'count' ? 'count' : `${aggregation.name}(${quoteSpl(field)})`;
    if (input.categorical) {
        const aggregate = `${head} | stats ${call} AS value`;
        return input.splitBy ? `${aggregate}${categoryTail(input)}` : aggregate;
    }
    if (!input.splitBy) {
        return `${head} | timechart span=${input.span} ${call} AS value`;
    }
    assertIdentifier(input.splitBy, 'Split field');
    const limit = input.splitLimit ?? 5;
    if (!SPLIT_LIMITS.includes(limit as (typeof SPLIT_LIMITS)[number])) {
        throw new Error('Split limit is not allowed.');
    }
    // timechart keeps the highest series. A lowest split is applied by reversing the limit label in the chart, which timechart cannot do.
    return `${head} | timechart span=${input.span} ${call} AS value by ${input.splitBy} limit=${limit} useother=f`;
}

/** The event search behind "Search Related Events": the chart window, plus include filters as fields. */
export function relatedEventsSearch(input: {
    source?: string;
    name: string;
    filters?: MetricFilter[];
    indexes?: string[];
}): string {
    const parts = [input.source === 'event' ? eventIndexClause(input.indexes) : 'index=*'];
    if (input.source === 'event' && input.name && !/[\r\n"]/.test(input.name)) {
        parts.push(`sourcetype=${quoteSpl(input.name)}`);
    }
    for (const filter of input.filters ?? []) {
        if (filter.mode !== 'include') {
            continue;
        }
        assertIdentifier(filter.dimension, 'Filter field');
        for (const value of filter.values) {
            if (/[\r\n]/.test(value)) {
                throw new Error('Line breaks are not allowed.');
            }
            parts.push(`${filter.dimension}=${quoteSpl(value)}`);
        }
    }
    return parts.join(' ');
}

function timeShiftClause(shift?: string): string {
    if (!shift) {
        return '';
    }
    const parsed = parseTimeShift(shift);
    if (!parsed) {
        throw new Error('Time shift is not allowed.');
    }
    return ` | eval _time=relative_time(_time, "+${parsed.token}")`;
}
