export type MetricFunction = {
    name: string;
    label: string;
    chart: 'line' | 'table';
    rate: boolean;
};

const PERCENTILE = /^(?:perc|p|upperperc)(?:100|\d{1,2}(?:\.\d{1,3})?)$/;

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

export function resolveMetricFunction(value: string): MetricFunction | null {
    const name = value.trim().toLowerCase();
    const known = BY_NAME.get(name);
    if (known) {
        return known;
    }
    if (!PERCENTILE.test(name)) {
        return null;
    }
    return { name, label: name, chart: 'line', rate: false };
}
