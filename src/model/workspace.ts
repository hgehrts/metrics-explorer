import { ReferenceLine } from '../chart/reference';
import { ChartSettings, defaultSettings } from '../chart/settings';
import { resolveMetricFunction, SeriesSource } from '../spl/functions';

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
    /** The tstats field. Empty for count, and unused for metrics. */
    field: string;
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
};

export const AUTO_REFRESH_MS = 10000;

/** Marks a series that takes the workspace split. Not a valid dimension name, so it cannot collide with one. */
export const INHERIT_SPLIT = '*global*';

/** The split a series actually uses: its own dimension, the global one when it inherits, or none. */
export function resolveSplit(series: Pick<Series, 'splitBy'>, globalSplit: string): string {
    if (series.splitBy === INHERIT_SPLIT) {
        return globalSplit;
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

/** Series with their resolved split, for searches, legends and the signature of a chart. */
export function resolveSeries(series: Series[], globalSplit: string): Series[] {
    return series.map((item) => ({ ...item, splitBy: resolveSplit(item, globalSplit) }));
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
    const chosen = resolveMetricFunction(series.aggregation);
    const aggregation = chosen?.label ?? series.aggregation;
    const severalMetrics = new Set(siblings.map((item) => item.metric)).size > 1;
    const base = series.splitBy
        ? `${aggregation} by ${series.splitBy}`
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
    return { id: nextId('chart'), series: [createSeries(metric, filters, source)], settings: defaultSettings() };
}

export function cloneChart(chart: ChartModel): ChartModel {
    return {
        id: nextId('chart'),
        series: chart.series.map((series) => ({ ...series, id: nextId('series') })),
        settings: { ...chart.settings },
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
