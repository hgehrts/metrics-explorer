import { t } from '../i18n';
import { ReferenceLine } from '../chart/reference';
import { ChartSettings, defaultSettings } from '../chart/settings';
import { resolveEventFunction, resolveMetricFunction, SeriesSource } from '../spl/functions';

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
    /** The tstats field, or the measure of a base search. Empty for count, and unused for metrics. */
    field: string;
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

export type ChartModel = {
    id: string;
    series: Series[];
    settings: ChartSettings;
    /** When false, series that inherit the global split draw unsplit, so this chart keeps its own view. */
    useGlobalSplit: boolean;
};

export const AUTO_REFRESH_MS = 10000;

/** Marks a series that takes the workspace split. Not a valid dimension name, so it cannot collide with one. */
export const INHERIT_SPLIT = '*global*';

/**
 * The split a series actually uses: its own dimension, the global one when it inherits and the chart follows it, or none.
 */
export function resolveSplit(series: Pick<Series, 'splitBy'>, globalSplit: string, useGlobalSplit = true): string {
    if (series.splitBy === INHERIT_SPLIT) {
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
        item.splitBy === INHERIT_SPLIT && useGlobalSplit && globalSplit
            ? { ...item, splitBy: globalSplit, splitDirection: globalLimit.direction, splitLimit: globalLimit.limit }
            : { ...item, splitBy: resolveSplit(item, globalSplit, useGlobalSplit) }
    );
}

/** A copy of one series with a new id, placed right after the original. */
export function cloneSeries(item: Series): Series {
    return { ...item, id: nextId('series'), filters: item.filters.map((filter) => ({ ...filter, values: [...filter.values] })), referenceLines: [...item.referenceLines] };
}

/** The global filters a series gets: all of them for a metric with those dimensions, none for events and datasets. */
export function globalFiltersFor(
    item: { source?: string; metric: string },
    filters: SeriesFilter[],
    metricDims: Record<string, string[]>
): SeriesFilter[] {
    if ((item.source ?? 'metric') !== 'metric') {
        return [];
    }
    const known = metricDims[item.metric];
    return known ? filters.filter((filter) => known.includes(filter.dimension)) : filters;
}

let sequence = 0;

function nextId(prefix: string): string {
    sequence += 1;
    return `${prefix}-${sequence}`;
}

/** Legend and analysis subtitle. A time shift is shown as `(-30m)`. Different metrics in one chart keep the metric name. */
export function seriesLegend(
    series: Pick<Series, 'metric' | 'aggregation' | 'splitBy' | 'timeShift'>,
    siblings: Array<Pick<Series, 'metric'>> = [series]
): string {
    const chosen = resolveMetricFunction(series.aggregation) ?? resolveEventFunction(series.aggregation);
    const aggregation = chosen?.label ?? series.aggregation;
    const severalMetrics = new Set(siblings.map((item) => item.metric)).size > 1;
    const base = series.splitBy
        ? `${aggregation} ${t('by')} ${series.splitBy}`
        : severalMetrics
          ? `${series.metric} ${aggregation}`
          : aggregation;
    return series.timeShift ? `${base} (-${series.timeShift})` : base;
}

export function createSeries(metric: string, filters: SeriesFilter[] = [], source: SeriesSource = 'metric'): Series {
    return {
        id: nextId('series'),
        metric,
        source,
        field: '',
        baseMode: 'live',
        baseOwner: '',
        aggregation: source === 'metric' ? 'Avg' : 'Count',
        splitBy: INHERIT_SPLIT,
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

export function cloneChart(chart: ChartModel): ChartModel {
    return {
        id: nextId('chart'),
        series: chart.series.map((series) => ({ ...series, id: nextId('series') })),
        settings: { ...chart.settings },
        useGlobalSplit: chart.useGlobalSplit,
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
