import { resolveMetricFunction } from './functions';

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

export function buildDimensionSearch(metric: string): string {
    assertIdentifier(metric, 'Metric name');
    return `| mcatalog values(_dims) WHERE metric_name=${quoteSpl(metric)} AND index=* AND NOT metric_name="*_mrollup_*" | mvexpand values(_dims)`;
}

export type MetricFilter = {
    dimension: string;
    mode: 'include' | 'exclude';
    values: string[];
};

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

function timeShiftClause(shift?: string): string {
    if (!shift) {
        return '';
    }
    if (!/^(30m|60m|2h|24h|2d|7d)$/.test(shift)) {
        throw new Error('Time shift is not allowed.');
    }
    return ` | eval _time=relative_time(_time, "+${shift}")`;
}
