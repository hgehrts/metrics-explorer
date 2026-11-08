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
export function buildDimensionSearch(metric: string): string {
    assertIdentifier(metric, 'Metric name');
    return `| mcatalog values(_dims) WHERE metric_name=${quoteSpl(metric)} AND index=* AND NOT metric_name="*_mrollup_*"`;
}

export type MetricFilter = {
    dimension: string;
    mode: 'include' | 'exclude';
    values: string[];
};

/** Every dimension in the catalog, for the global split-by list. */
export function buildAllDimensionSearch(): string {
    return '| mcatalog values(_dims) WHERE index=* AND NOT metric_name="*_mrollup_*" | mvexpand values(_dims)';
}

export function buildDimensionValueSearch(metric: string, dimension: string): string {
    assertIdentifier(metric, 'Metric name');
    assertIdentifier(dimension, 'Filter field');
    const field = quoteSpl(dimension);
    return `| mcatalog values(metric_name) WHERE metric_name=${quoteSpl(metric)} AND index=* AND NOT metric_name="*_mrollup_*" BY ${field} | fields ${field}`;
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
}): string {
    const aggregation = resolveMetricFunction(input.aggregation);
    if (!aggregation) {
        throw new Error('Unknown aggregation.');
    }
    assertIdentifier(input.metric, 'Metric name');
    if (!SPAN.test(input.span)) {
        throw new Error('Span is not allowed.');
    }
    const index = input.index ?? '*';
    const indexClause = index === '*' ? 'index=*' : `index=${quoteSpl(index)}`;
    if (index !== '*') {
        assertIdentifier(index, 'Index');
    }
    const metric = quoteSpl(input.metric);
    const base = `| mstats ${aggregation.name}(${metric})`;
    const extra = filterClause(input.filters);
    const where = extra ? `${indexClause} AND ${extra}` : indexClause;
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
export function buildReferenceValueSearch(input: { aggregation: string; metric: string; filters?: MetricFilter[] }): string {
    const aggregation = resolveMetricFunction(input.aggregation);
    if (!aggregation || aggregation.chart !== 'line' || aggregation.rate || aggregation.name.startsWith('upperperc')) {
        throw new Error('Unknown aggregation.');
    }
    assertIdentifier(input.metric, 'Metric name');
    const extra = filterClause(input.filters);
    const where = extra ? `index=* AND ${extra}` : 'index=*';
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
}): string {
    const aggregation = resolveEventFunction(input.aggregation);
    if (!aggregation) {
        throw new Error('Unknown aggregation.');
    }
    if (!SPAN.test(input.span)) {
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
