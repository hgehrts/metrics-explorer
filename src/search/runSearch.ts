import SearchJob from '@splunk/search-job';
import type { ValueRow } from '../catalog/metricTree';

export type SearchRow = Record<string, unknown>;

export type SearchPayload = {
    results?: SearchRow[];
};

type Job = {
    getResults: (params?: { count?: number }) => {
        subscribe: (observer: {
            next: (payload: SearchPayload) => void;
            error: (error: unknown) => void;
        }) => { unsubscribe: () => void };
    };
    cancel: () => void;
};

function searchErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    if (error && typeof error === 'object') {
        const record = error as { message?: string; messages?: { text?: string }[] };
        const texts = (record.messages ?? []).map((item) => item.text).filter((text): text is string => Boolean(text));
        if (texts.length > 0) {
            return texts.join(' ');
        }
        if (record.message) {
            return record.message;
        }
    }
    return 'Search failed.';
}

const createJob = SearchJob.create as (
    params: { search: string; earliest_time: string; latest_time: string },
    options: { cancelOnUnload: boolean }
) => Job;

export function runSearch(
    search: string,
    earliest: string,
    onResult: (payload: SearchPayload) => void,
    onError: (message: string) => void,
    latest = 'now'
): () => void {
    const job = createJob(
        { search, earliest_time: earliest, latest_time: latest },
        { cancelOnUnload: true }
    );
    const subscription = job.getResults({ count: 10000 }).subscribe({
        next: onResult,
        error: (error: unknown) => onError(searchErrorMessage(error)),
    });
    return () => {
        subscription.unsubscribe();
        job.cancel();
    };
}

/** Fields every metric data point has. mcatalog leaves them out of `_dims`, but they split and filter like dimensions. */
export const DEFAULT_DIMENSIONS = ['host', 'source', 'sourcetype'] as const;

/** Dimensions from a `values(_dims)` catalog search, plus host, source, and sourcetype. */
export function collectDimensions(payload: SearchPayload): string[] {
    return [...new Set([...collectFieldValues(payload, '_dims'), ...DEFAULT_DIMENSIONS])].sort();
}

export function collectFieldValues(payload: SearchPayload, fieldIncludes: string): string[] {
    const names = new Set<string>();
    for (const row of payload.results ?? []) {
        for (const [key, value] of Object.entries(row)) {
            if (!key.includes(fieldIncludes)) {
                continue;
            }
            const values = Array.isArray(value) ? value : [value];
            for (const item of values) {
                if (item !== undefined && item !== null && String(item) !== '') {
                    names.add(String(item));
                }
            }
        }
    }
    return [...names].sort();
}

export function collectMetricNames(payload: SearchPayload): string[] {
    const names = new Set<string>();
    for (const row of payload.results ?? []) {
        for (const [key, value] of Object.entries(row)) {
            if (!key.includes('metric_name')) {
                continue;
            }
            const values = Array.isArray(value) ? value : [value];
            for (const item of values) {
                if (item !== undefined && item !== null && String(item) !== '') {
                    names.add(String(item));
                }
            }
        }
    }
    return [...names].sort();
}

/** Rows of `mcatalog values(metric_name) ... BY <dimension>`: one dimension value and the metrics that carry it. */
export function collectValueMetrics(payload: SearchPayload, dimension: string): ValueRow[] {
    const rows: ValueRow[] = [];
    for (const row of payload.results ?? []) {
        const raw = row[dimension];
        const value = Array.isArray(raw) ? String(raw[0] ?? '') : raw === undefined || raw === null ? '' : String(raw);
        if (!value) {
            continue;
        }
        const metrics = new Set<string>();
        for (const [key, item] of Object.entries(row)) {
            if (!key.includes('metric_name')) {
                continue;
            }
            for (const name of Array.isArray(item) ? item : [item]) {
                if (name !== undefined && name !== null && String(name) !== '') {
                    metrics.add(String(name));
                }
            }
        }
        rows.push({ value, metrics: [...metrics].sort() });
    }
    return rows;
}
