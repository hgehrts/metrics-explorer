import { ReferenceLine } from '../chart/reference';
import { ChartSettings, defaultSettings } from '../chart/settings';

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
