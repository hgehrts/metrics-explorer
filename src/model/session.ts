import { ChartModel } from './workspace';

/** What is kept between visits: the charts and the view around them. Never credentials or search results. */
export interface SavedSession {
    version: 1;
    savedAt: number;
    charts: ChartModel[];
    layout: 'stack' | 'grid';
    range: string;
    catalogRange: string;
    globalSplit: string;
}

export const SESSION_VERSION = 1;

export function sessionKey(user: string): string {
    return `metrics-explorer.session.v${SESSION_VERSION}.${user || 'default'}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
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
    // Sessions saved before the catalog range was kept fall back to the default.
    if (typeof value.catalogRange !== 'string') {
        value.catalogRange = '-2d';
    }
    if (value.charts.length === 0 || !value.charts.every(isChart)) {
        return null;
    }
    return value as unknown as SavedSession;
}

export function serializeSession(session: Omit<SavedSession, 'version' | 'savedAt'>, now: number): string {
    const saved: SavedSession = { version: SESSION_VERSION, savedAt: now, ...session };
    return JSON.stringify(saved);
}
