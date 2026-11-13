import { SPLIT_LIMITS } from '../spl/buildMstats';
import { spanSeconds } from '../spl/span';
import { ChartModel, DEFAULT_GLOBAL_LIMIT, DEFAULT_TRELLIS, GlobalSplitLimit, SeriesFilter, TrellisLayout } from './workspace';

/** What is kept between visits: the charts and the view around them. Never credentials or search results. */
export interface SavedSession {
    version: 1;
    savedAt: number;
    charts: ChartModel[];
    layout: 'stack' | 'grid';
    range: string;
    /** End of the chart range: `now`, or a fixed time for a custom range. */
    latest: string;
    catalogRange: string;
    globalSplit: string;
    globalFilters: SeriesFilter[];
    globalLimit: GlobalSplitLimit;
    /** Empty follows the time range. Otherwise an SPL span such as 30s or 5m for every chart on Auto. */
    globalSpan: string;
}

export const SESSION_VERSION = 1;

const SPLIT_LIMIT_VALUES: readonly number[] = SPLIT_LIMITS;

export function sessionKey(user: string): string {
    return `metrics-explorer.session.v${SESSION_VERSION}.${user || 'default'}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const NAME = /^[A-Za-z0-9_.:-]+$/;
const VALUE = /^[^\r\n]{1,200}$/;

export function isSeriesFilter(value: unknown): value is SeriesFilter {
    return (
        isRecord(value) &&
        typeof value.dimension === 'string' &&
        NAME.test(value.dimension) &&
        (value.mode === 'include' || value.mode === 'exclude') &&
        Array.isArray(value.values) &&
        value.values.length >= 1 &&
        value.values.length <= 50 &&
        value.values.every((item) => typeof item === 'string' && VALUE.test(item))
    );
}

function isChart(value: unknown): value is ChartModel {
    if (!isRecord(value) || typeof value.id !== 'string' || !isRecord(value.settings) || !Array.isArray(value.series)) {
        return false;
    }
    return value.series.every(
        (item) =>
            isRecord(item) &&
            typeof item.id === 'string' &&
            typeof item.metric === 'string' &&
            typeof item.aggregation === 'string' &&
            typeof item.splitBy === 'string'
    );
}

function bounded(value: unknown, fallback: number, min: number, max: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

/** Drops a trellis block that is not a dimension plus four layout numbers. */
function cleanTrellis(value: unknown): TrellisLayout | undefined {
    if (!isRecord(value) || typeof value.dimension !== 'string' || !/^[A-Za-z_][A-Za-z0-9_.:-]{0,79}$/.test(value.dimension)) {
        return undefined;
    }
    return {
        dimension: value.dimension,
        minColumnWidth: bounded(value.minColumnWidth, DEFAULT_TRELLIS.minColumnWidth, 120, 800),
        rowHeight: bounded(value.rowHeight, DEFAULT_TRELLIS.rowHeight, 140, 600),
        columns: bounded(value.columns, DEFAULT_TRELLIS.columns, 1, 6),
        pageSize: bounded(value.pageSize, DEFAULT_TRELLIS.pageSize, 1, 50),
    };
}

/** Reads a saved session. Anything unexpected returns null, so a damaged value never breaks the page. */
export function parseSession(text: string | null): SavedSession | null {
    if (!text) {
        return null;
    }
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        return null;
    }
    if (!isRecord(value) || value.version !== SESSION_VERSION || !Array.isArray(value.charts)) {
        return null;
    }
    if (value.layout !== 'stack' && value.layout !== 'grid') {
        return null;
    }
    if (typeof value.range !== 'string' || typeof value.globalSplit !== 'string' || typeof value.savedAt !== 'number') {
        return null;
    }
    // Sessions saved before custom ranges existed end now.
    if (typeof value.latest !== 'string' || !/^(now|-\d{1,4}[smhdw]|\d{1,11})$/.test(value.latest)) {
        value.latest = 'now';
    }
    // Sessions saved before the catalog range was kept fall back to the default.
    if (typeof value.catalogRange !== 'string') {
        value.catalogRange = '-24h';
    }
    // Sessions saved before the global split had its own limit show the top five.
    const limit = isRecord(value.globalLimit) ? value.globalLimit : {};
    value.globalLimit = {
        direction: limit.direction === 'lowest' ? 'lowest' : DEFAULT_GLOBAL_LIMIT.direction,
        limit: typeof limit.limit === 'number' && SPLIT_LIMIT_VALUES.includes(limit.limit) ? limit.limit : DEFAULT_GLOBAL_LIMIT.limit,
    };
    if (value.charts.length === 0 || !value.charts.every(isChart)) {
        return null;
    }
    // Sessions saved before the toolbar span existed stay on automatic.
    value.globalSpan = typeof value.globalSpan === 'string' && spanSeconds(value.globalSpan) ? value.globalSpan : '';
    // Global filters are checked like any filter: names and values only, never raw SPL.
    value.globalFilters = Array.isArray(value.globalFilters)
        ? (value.globalFilters as unknown[]).filter(isSeriesFilter)
        : [];
    // Charts saved before the per-chart split switch follow the global split.
    for (const chart of value.charts as Array<ChartModel & { useGlobalSplit?: unknown }>) {
        if (typeof chart.useGlobalSplit !== 'boolean') {
            chart.useGlobalSplit = true;
        }
        const trellis = cleanTrellis(chart.trellis);
        if (trellis) {
            chart.trellis = trellis;
        } else {
            delete chart.trellis;
        }
    }
    return value as unknown as SavedSession;
}

export function serializeSession(session: Omit<SavedSession, 'version' | 'savedAt'>, now: number): string {
    const saved: SavedSession = { version: SESSION_VERSION, savedAt: now, ...session };
    return JSON.stringify(saved);
}
