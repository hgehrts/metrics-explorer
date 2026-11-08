import { ReferenceLine } from '../chart/reference';
import { ChartSettings, defaultSettings } from '../chart/settings';
import { resolveMetricFunction } from '../spl/functions';

export type SeriesFilter = {
    dimension: string;
    mode: 'include' | 'exclude';
    values: string[];
};

export type Series = {
    id: string;
    metric: string;
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

export function createSeries(metric: string): Series {
    return {
        id: nextId('series'),
        metric,
        aggregation: 'Avg',
        splitBy: '',
        splitDirection: 'highest',
        splitLimit: 5,
        timeShift: '',
        overlay: false,
        filters: [],
        referenceLines: [],
    };
}

export function createChart(metric: string): ChartModel {
    return { id: nextId('chart'), series: [createSeries(metric)], settings: defaultSettings() };
}

export function cloneChart(chart: ChartModel): ChartModel {
    return {
        id: nextId('chart'),
        series: chart.series.map((series) => ({ ...series, id: nextId('series') })),
        settings: { ...chart.settings },
    };
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
