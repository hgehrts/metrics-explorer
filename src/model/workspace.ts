import { t } from '../i18n';
import { ReferenceLine } from '../chart/reference';
import { ChartSettings, defaultSettings } from '../chart/settings';
import { resolveEventFunction, resolveMetricFunction, SeriesSource } from '../spl/functions';
import { formulaMetrics, TitlePart } from '../spl/titleFormula';

export type SeriesFilter = {
    dimension: string;
    mode: 'include' | 'exclude';
    values: string[];
};

export type Series = {
    id: string;
    /** Metric name, event sourcetype, or data model name, depending on source. */
    metric: string;
    source: SeriesSource;
    /** The tstats field, the measure of a base search, or a calc formula. Empty for count. */
    field: string;
    /** Display name from `AS` in the title row. Empty keeps the metric or formula. */
    label?: string;
    /** live runs a base search now. cached loads its last scheduled result. */
    baseMode?: 'live' | 'cached';
    /** Owner of a base search, used in the loadjob path. */
    baseOwner?: string;
    aggregation: string;
    splitBy: string;
    splitDirection: 'highest' | 'lowest';
    splitLimit: number;
    timeShift: string;
    overlay: boolean;
    filters: SeriesFilter[];
    referenceLines: ReferenceLine[];
};

/** Layout of the small charts drawn for one dimension of the selected chart. */
export type TrellisLayout = {
    dimension: string;
    minColumnWidth: number;
    rowHeight: number;
    columns: number;
    pageSize: number;
};

export const DEFAULT_TRELLIS = {
    minColumnWidth: 280,
    rowHeight: 220,
    columns: 2,
    pageSize: 8,
} as const;

export type ChartModel = {
    id: string;
    series: Series[];
    settings: ChartSettings;
    /** When false, series that inherit the global split draw unsplit, so this chart keeps its own view. */
    useGlobalSplit: boolean;
    /** Set only while this chart is split into one small chart per dimension value. */
    trellis?: TrellisLayout;
};

export const AUTO_REFRESH_MS = 10000;

/** Marks a series that takes the workspace split. Not a valid dimension name, so it cannot collide with one. */
export const INHERIT_SPLIT = '*global*';

/**
 * The split a series actually uses: its own dimension, the global one when it inherits and the chart follows it, or none.
 */
/**
 * Dimensions the global Split By list may offer for the metrics in the active chart.
 * Nothing is selected, or a metric's dimensions are not loaded yet: the list stays empty.
 * Several metrics offer only the dimensions every one of them has.
 */
/** Dimensions a trellis can use: the shared ones, without the field that already splits the lines. */
export function trellisDimensions(shared: string[], splitBy: string): string[] {
    return shared.filter((name) => name !== splitBy);
}

export function sharedDimensions(metrics: string[], known: Record<string, string[] | undefined>): string[] {
    const unique = [...new Set(metrics.filter(Boolean))];
    if (unique.length === 0) {
        return [];
    }
    const lists = unique.map((metric) => known[metric]);
    if (lists.some((list) => !list)) {
        return [];
    }
    const [first, ...rest] = lists as string[][];
    return first.filter((name) => rest.every((list) => list.includes(name))).sort();
}

export function resolveSplit(series: Pick<Series, 'splitBy'> & { source?: Series['source'] }, globalSplit: string, useGlobalSplit = true): string {
    if (series.splitBy === INHERIT_SPLIT) {
        // A metric dimension does not exist on events or data models. Inheriting it makes tstats return no rows.
        if (series.source === 'event' || series.source === 'dataset') {
            return '';
        }
        return useGlobalSplit ? globalSplit : '';
    }
    return series.splitBy;
}

/** True when the rows carry values for the split field. Metrics without that dimension return rows without it. */
export function hasSplitValues(rows: Array<Record<string, unknown>>, field: string): boolean {
    if (!field) {
        return false;
    }
    return rows.some((row) => row[field] !== undefined && row[field] !== null && row[field] !== '');
}

/** How many values the global split shows, and from which end. Series that inherit the split use it. */
export type GlobalSplitLimit = { direction: 'highest' | 'lowest'; limit: number };

export const DEFAULT_GLOBAL_LIMIT: GlobalSplitLimit = { direction: 'highest', limit: 5 };

/** Series with their resolved split, for searches, legends and the signature of a chart. */
export function resolveSeries(
    series: Series[],
    globalSplit: string,
    useGlobalSplit = true,
    globalLimit: GlobalSplitLimit = DEFAULT_GLOBAL_LIMIT
): Series[] {
    return series.map((item) =>
        item.splitBy === INHERIT_SPLIT &&
        useGlobalSplit &&
        globalSplit &&
        item.source !== 'event' &&
        item.source !== 'dataset' &&
        item.source !== 'search'
            ? { ...item, splitBy: globalSplit, splitDirection: globalLimit.direction, splitLimit: globalLimit.limit }
            : { ...item, splitBy: resolveSplit(item, globalSplit, useGlobalSplit) }
    );
}

/** A copy of one series with a new id, placed right after the original. */
export function cloneSeries(item: Series): Series {
    return { ...item, id: nextId('series'), filters: item.filters.map((filter) => ({ ...filter, values: [...filter.values] })), referenceLines: [...item.referenceLines] };
}

/** Metric names a series draws: one metric, or the operands of a formula. */
export function seriesMetricNames(item: { metric: string; source?: string; field?: string }): string[] {
    if (item.source === 'calc') {
        const names = formulaMetrics(item.field || item.metric);
        return names.length > 0 ? names : item.metric ? [item.metric] : [];
    }
    if ((item.source ?? 'metric') === 'metric') {
        return item.metric ? [item.metric] : [];
    }
    return [];
}

/** Shared dimensions of a series once every operand's catalog list is loaded. */
export function seriesDimensions(
    item: { metric: string; source?: string; field?: string },
    metricDims: Record<string, string[]>
): string[] | undefined {
    const names = seriesMetricNames(item);
    if (names.length === 0) {
        return metricDims[item.metric];
    }
    if (names.some((name) => !metricDims[name])) {
        return undefined;
    }
    return sharedDimensions(names, metricDims);
}

/** The global filters a series gets: all of them for a metric with those dimensions, none for events and datasets. */
export function globalFiltersFor(
    item: { source?: string; metric: string; field?: string },
    filters: SeriesFilter[],
    metricDims: Record<string, string[]>
): SeriesFilter[] {
    if ((item.source ?? 'metric') !== 'metric' && item.source !== 'calc') {
        return [];
    }
    const known = seriesDimensions(item, metricDims);
    return known ? filters.filter((filter) => known.includes(filter.dimension)) : filters;
}

function sameFilters(left: SeriesFilter[], right: SeriesFilter[]): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

/** Why a title line cannot become series yet. Empty when it can. */
export function titleLineError(chart: ChartModel, parts: TitlePart[]): string {
    for (const part of parts) {
        if (part.kind !== 'calc') {
            continue;
        }
        const existing = part.metrics
            .map((name) => chart.series.find((item) => (item.source ?? 'metric') === 'metric' && item.metric === name))
            .filter((item): item is Series => Boolean(item));
        if (existing.length < 2) {
            continue;
        }
        const aggregation = existing[0].aggregation;
        if (existing.some((item) => item.aggregation !== aggregation)) {
            return 'A formula needs the same aggregation on every metric.';
        }
        if (existing.some((item) => !sameFilters(item.filters, existing[0].filters))) {
            return 'A formula needs the same filters on every metric.';
        }
    }
    return '';
}

function matchesPart(item: Series, part: TitlePart): boolean {
    if (part.kind === 'calc') {
        return item.source === 'calc' && (item.field === part.text || item.metric === part.text);
    }
    return (item.source ?? 'metric') !== 'calc' && item.metric === part.metrics[0];
}

function templateForPart(chart: ChartModel, part: TitlePart): Series | undefined {
    for (const name of part.metrics) {
        const found = chart.series.find((item) => (item.source ?? 'metric') === 'metric' && item.metric === name);
        if (found) {
            return found;
        }
    }
    return chart.series.find((item) => (item.source ?? 'metric') === 'metric' || item.source === 'calc');
}

/** Rebuilds the chart series from a parsed title line. Existing matching series keep their settings. */
export function applyTitleParts(chart: ChartModel, parts: TitlePart[]): ChartModel {
    const used = new Set<string>();
    const next: Series[] = [];
    for (const part of parts) {
        const found = chart.series.find((item) => !used.has(item.id) && matchesPart(item, part));
        if (found) {
            used.add(found.id);
            next.push({
                ...found,
                label: part.label ?? '',
                metric: part.kind === 'calc' ? part.text : part.metrics[0],
                field: part.kind === 'calc' ? part.text : found.field,
                source: part.kind === 'calc' ? 'calc' : found.source,
            });
            continue;
        }
        const template = templateForPart(chart, part);
        const created = createSeries(
            part.kind === 'calc' ? part.text : part.metrics[0],
            template?.filters.map((filter) => ({ ...filter, values: [...filter.values] })) ?? [],
            part.kind === 'calc' ? 'calc' : 'metric'
        );
        created.label = part.label ?? '';
        if (part.kind === 'calc') {
            created.field = part.text;
            created.aggregation = template?.aggregation ?? created.aggregation;
            created.splitBy = template?.splitBy ?? created.splitBy;
            created.splitDirection = template?.splitDirection ?? created.splitDirection;
            created.splitLimit = template?.splitLimit ?? created.splitLimit;
        }
        next.push(created);
    }
    if (next.length === 0) {
        throw new Error('Enter a metric name or a formula.');
    }
    return { ...chart, series: next };
}

/** The editable title row: metrics, formulas, and AS labels. */
export function chartTitleText(chart: Pick<ChartModel, 'series'>): string {
    return chart.series
        .map((item) => {
            const core = item.source === 'calc' ? item.field || item.metric : item.metric;
            return item.label ? `${core} AS ${item.label}` : core;
        })
        .join(', ');
}

let sequence = 0;

function nextId(prefix: string): string {
    sequence += 1;
    return `${prefix}-${sequence}`;
}

/** Legend and analysis subtitle. A time shift is shown as `(-30m)`. Different metrics in one chart keep the metric name. */
export function seriesLegend(
    series: Pick<Series, 'metric' | 'aggregation' | 'splitBy' | 'timeShift' | 'label'>,
    siblings: Array<Pick<Series, 'metric' | 'label'>> = [series]
): string {
    const chosen = resolveMetricFunction(series.aggregation) ?? resolveEventFunction(series.aggregation);
    const aggregation = chosen?.label ?? series.aggregation;
    const name = series.label?.trim() || series.metric;
    const severalMetrics = new Set(siblings.map((item) => item.label?.trim() || item.metric)).size > 1;
    const base = series.splitBy
        ? `${aggregation} ${t('by')} ${series.splitBy}`
        : severalMetrics
          ? `${name} ${aggregation}`
          : aggregation;
    return series.timeShift ? `${base} (-${series.timeShift})` : base;
}

export function createSeries(metric: string, filters: SeriesFilter[] = [], source: SeriesSource = 'metric'): Series {
    return {
        id: nextId('series'),
        metric,
        source,
        field: '',
        label: '',
        baseMode: 'live',
        baseOwner: '',
        aggregation: source === 'metric' || source === 'calc' ? 'Avg' : source === 'search' ? 'Search' : 'Count',
        // The workspace split is a metric dimension. Events, datasets, and saved searches start unsplit.
        splitBy: source === 'event' || source === 'dataset' || source === 'search' ? '' : INHERIT_SPLIT,
        splitDirection: 'highest',
        splitLimit: 5,
        timeShift: '',
        overlay: false,
        filters,
        referenceLines: [],
    };
}

export function createChart(metric: string, filters: SeriesFilter[] = [], source: SeriesSource = 'metric'): ChartModel {
    return {
        id: nextId('chart'),
        series: [createSeries(metric, filters, source)],
        settings: defaultSettings(),
        useGlobalSplit: true,
    };
}

/** One small chart for a single trellis value. Metric series gain an include filter. The chart id stays. */
export function withTrellisValue(chart: ChartModel, dimension: string, value: string): ChartModel {
    return {
        ...chart,
        series: chart.series.map((item) =>
            (item.source ?? 'metric') === 'metric' || item.source === 'calc'
                ? { ...item, filters: [...item.filters, { dimension, mode: 'include', values: [value] }] }
                : item
        ),
    };
}

export function cloneChart(chart: ChartModel): ChartModel {
    return {
        id: nextId('chart'),
        series: chart.series.map((series) => ({ ...series, id: nextId('series') })),
        settings: { ...chart.settings },
        useGlobalSplit: chart.useGlobalSplit,
        ...(chart.trellis ? { trellis: { ...chart.trellis } } : {}),
    };
}

/** Restored charts get new ids, so they never collide with ids issued after a reload. */
export function reviveChart(chart: ChartModel): ChartModel {
    return cloneChart(chart);
}

export function refreshStatus(now: number, refreshedAt: number, auto: boolean): string {
    if (!refreshedAt) {
        return '';
    }
    const elapsed = Math.max(0, now - refreshedAt);
    if (auto) {
        const remaining = AUTO_REFRESH_MS - (elapsed % AUTO_REFRESH_MS);
        return `${Math.max(1, Math.ceil(remaining / 1000))}s to refresh`;
    }
    const seconds = Math.round(elapsed / 1000);
    if (seconds < 60) {
        return `${seconds}s ago`;
    }
    return `${Math.round(seconds / 60)}m ago`;
}
