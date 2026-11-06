import SearchJob from '@splunk/search-job';

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
