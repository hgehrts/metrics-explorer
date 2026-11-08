export type MetricFunction = {
    name: string;
    label: string;
    chart: 'line' | 'table';
    rate: boolean;
};

/** Presets offered in the percentile list. Custom values use any percent from 0 up to, but not including, 100, with up to three decimals (Splunk rejects 100). */
export const PERCENTILE_PRESETS = ['50', '75', '90', '95', '99', '99.9'] as const;

export type Percentile = { kind: 'perc' | 'upperperc'; value: string };

const PERCENT_TEXT = /^\d{1,2}(?:\.\d{1,3})?$/;

export function isPercentText(text: string): boolean {
    return PERCENT_TEXT.test(text.trim());
}

/** Reads perc95, p99.9 and upperperc95. The short form p95 counts as perc. */
export function parsePercentile(value: string): Percentile | null {
    const match = /^(upperperc|perc|p)(.+)$/.exec(value.trim().toLowerCase());
    if (!match || !isPercentText(match[2])) {
        return null;
    }
    return { kind: match[1] === 'upperperc' ? 'upperperc' : 'perc', value: match[2].trim() };
}

export const METRIC_FUNCTIONS: MetricFunction[] = [
    { name: 'avg', label: 'Avg', chart: 'line', rate: false },
    { name: 'sum', label: 'Sum', chart: 'line', rate: false },
    { name: 'min', label: 'Min', chart: 'line', rate: false },
    { name: 'max', label: 'Max', chart: 'line', rate: false },
    { name: 'count', label: 'Count', chart: 'line', rate: false },
    { name: 'range', label: 'Range', chart: 'line', rate: false },
    { name: 'median', label: 'Median', chart: 'line', rate: false },
    { name: 'stdev', label: 'Std Dev', chart: 'line', rate: false },
    { name: 'stdevp', label: 'Std Dev (population)', chart: 'line', rate: false },
    { name: 'var', label: 'Variance', chart: 'line', rate: false },
    { name: 'varp', label: 'Variance (population)', chart: 'line', rate: false },
    { name: 'sumsq', label: 'Sum of squares', chart: 'line', rate: false },
    { name: 'perc50', label: 'p50', chart: 'line', rate: false },
    { name: 'perc75', label: 'p75', chart: 'line', rate: false },
    { name: 'perc90', label: 'p90', chart: 'line', rate: false },
    { name: 'perc95', label: 'p95', chart: 'line', rate: false },
    { name: 'perc99', label: 'p99', chart: 'line', rate: false },
    { name: 'perc99.9', label: 'p99.9', chart: 'line', rate: false },
    { name: 'upperperc95', label: 'upper p95', chart: 'line', rate: false },
    { name: 'upperperc99', label: 'upper p99', chart: 'line', rate: false },
    { name: 'latest', label: 'Latest', chart: 'line', rate: false },
    { name: 'earliest', label: 'Earliest', chart: 'line', rate: false },
    { name: 'latest_time', label: 'Latest time', chart: 'table', rate: false },
    { name: 'earliest_time', label: 'Earliest time', chart: 'table', rate: false },
    { name: 'rate', label: 'Rate', chart: 'line', rate: true },
    { name: 'rate_avg', label: 'Rate (Avg)', chart: 'line', rate: true },
    { name: 'rate_sum', label: 'Rate (Sum)', chart: 'line', rate: true },
];

const BY_NAME = new Map(METRIC_FUNCTIONS.map((entry) => [entry.name, entry]));
const BY_LABEL = new Map(METRIC_FUNCTIONS.map((entry) => [entry.label.toLowerCase(), entry]));

/** Short text shown next to a rate aggregation. Empty for every other function. */
export function rateExplanation(name: string): string {
    if (name === 'rate') {
        return 'Rate is the per-second change of one counter series. Use it only with accumulating counter metrics.';
    }
    if (name === 'rate_avg') {
        return 'Rate (Avg) takes the per-second change of each series, then averages those rates. Use it only with accumulating counter metrics.';
    }
    if (name === 'rate_sum') {
        return 'Rate (Sum) takes the per-second change of each series, then adds those rates. Use it only with accumulating counter metrics.';
    }
    return '';
}

export function resolveMetricFunction(value: string): MetricFunction | null {
    const name = value.trim().toLowerCase();
    const known = BY_NAME.get(name);
    if (known) {
        return known;
    }
    const percentile = parsePercentile(name);
    if (percentile) {
        const label = percentile.kind === 'upperperc' ? `upper p${percentile.value}` : `p${percentile.value}`;
        return { name, label, chart: 'line', rate: false };
    }
    return BY_LABEL.get(name) ?? null;
}
