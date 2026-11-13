export type MetricFunction = {
    name: string;
    label: string;
    chart: 'line' | 'table';
    rate: boolean;
};

/** Presets offered in the percentile list. Custom values use any percent from 0 up to, but not including, 100, with up to three decimals (Splunk rejects 100). */
export const PERCENTILE_PRESETS = ['50', '75', '90', '95', '99', '99.9'] as const;

export type PercentileKind = 'perc' | 'upperperc' | 'exactperc';

export type Percentile = { kind: PercentileKind; value: string };

const PERCENT_TEXT = /^\d{1,2}(?:\.\d{1,3})?$/;

export function isPercentText(text: string): boolean {
    return PERCENT_TEXT.test(text.trim());
}

/** Reads perc95, p99.9, upperperc95 and exactperc95. The short form p95 counts as perc. exactperc is for events only. */
export function parsePercentile(value: string): Percentile | null {
    const match = /^(exactperc|upperperc|perc|p)(.+)$/.exec(value.trim().toLowerCase());
    if (!match || !isPercentText(match[2])) {
        return null;
    }
    const kind: PercentileKind = match[1] === 'p' || match[1] === 'perc' ? 'perc' : match[1] === 'upperperc' ? 'upperperc' : 'exactperc';
    return { kind, value: match[2].trim() };
}

/** Percentile methods a data source can run. exactperc exists in tstats and timechart, not in mstats. */
export function percentileMethods(source: SeriesSource): PercentileKind[] {
    return source === 'metric' ? ['perc', 'upperperc'] : ['perc', 'upperperc', 'exactperc'];
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

/** Event and dataset functions. tstats has no rate_avg or rate_sum, and it adds distinct counts and table functions. */
const EVENT_EXTRA: MetricFunction[] = [
    { name: 'dc', label: 'Distinct count', chart: 'line', rate: false },
    { name: 'estdc', label: 'Estimated distinct count', chart: 'line', rate: false },
    { name: 'mode', label: 'Mode', chart: 'table', rate: false },
    { name: 'values', label: 'Values', chart: 'table', rate: false },
    { name: 'first', label: 'First', chart: 'table', rate: false },
    { name: 'last', label: 'Last', chart: 'table', rate: false },
    { name: 'exactperc95', label: 'exact p95', chart: 'line', rate: false },
];

export const EVENT_FUNCTIONS: MetricFunction[] = [
    ...METRIC_FUNCTIONS.filter((entry) => entry.name !== 'rate_avg' && entry.name !== 'rate_sum'),
    ...EVENT_EXTRA,
];

const EVENT_BY_NAME = new Map(EVENT_FUNCTIONS.map((entry) => [entry.name, entry]));

export type SeriesSource = 'metric' | 'event' | 'dataset' | 'base' | 'search';

/** A saved SPL search is already a chart. It has no aggregation to pick. */
const SEARCH_FUNCTION: MetricFunction = { name: 'search', label: 'Search', chart: 'line', rate: false };

export type AggregationGroup = 'basic' | 'percentile' | 'rate' | 'time' | 'event';

/** Puts every offered function in one menu section. The browser datalist was hiding most of them. */
export function aggregationGroup(name: string): AggregationGroup {
    if (name.startsWith('rate')) {
        return 'rate';
    }
    if (name === 'latest' || name === 'earliest' || name.startsWith('latest_') || name.startsWith('earliest_')) {
        return 'time';
    }
    if (name.startsWith('perc') || name.startsWith('upperperc') || name.startsWith('exactperc') || name.startsWith('p')) {
        return 'percentile';
    }
    if (name === 'dc' || name === 'estdc' || name === 'mode' || name === 'values' || name === 'first' || name === 'last') {
        return 'event';
    }
    return 'basic';
}

const GROUP_ORDER: AggregationGroup[] = ['basic', 'percentile', 'rate', 'time', 'event'];

export const AGGREGATION_GROUP_LABEL: Record<AggregationGroup, string> = {
    basic: 'Basic',
    percentile: 'Percentiles',
    rate: 'Rate',
    time: 'Time',
    event: 'Events',
};

/** Functions for one source, in menu order, without rate functions on a categorical chart. */
export function aggregationMenu(source: SeriesSource, categorical: boolean): Array<{ group: AggregationGroup; label: string; items: MetricFunction[] }> {
    const available = functionsFor(source).filter((item) => !categorical || !item.rate);
    return GROUP_ORDER.flatMap((group) => {
        const items = available.filter((item) => aggregationGroup(item.name) === group);
        return items.length > 0 ? [{ group, label: AGGREGATION_GROUP_LABEL[group], items }] : [];
    });
}

export function resolveForSource(source: SeriesSource | undefined, value: string): MetricFunction | null {
    if (source === 'search') {
        return SEARCH_FUNCTION;
    }
    return (source ?? 'metric') === 'metric' ? resolveMetricFunction(value) : resolveEventFunction(value);
}

export function functionsFor(source: SeriesSource): MetricFunction[] {
    if (source === 'search') {
        return [];
    }
    return source === 'metric' ? METRIC_FUNCTIONS : EVENT_FUNCTIONS;
}

/** count is the only tstats function that does not take a field. */
export function needsField(name: string): boolean {
    return name !== 'count';
}

/** Resolves a function for events and datasets. rate_avg and rate_sum are refused. exactperc is accepted. */
export function resolveEventFunction(value: string): MetricFunction | null {
    const name = value.trim().toLowerCase();
    if (name === 'rate_avg' || name === 'rate_sum') {
        return null;
    }
    const known = EVENT_BY_NAME.get(name);
    if (known) {
        return known;
    }
    const exact = /^exactperc(\d{1,2}(?:\.\d{1,3})?)$/.exec(name);
    if (exact && isPercentText(exact[1])) {
        return { name, label: `exact p${exact[1]}`, chart: 'line', rate: false };
    }
    const resolved = resolveMetricFunction(value);
    if (!resolved || resolved.name === 'rate_avg' || resolved.name === 'rate_sum') {
        return null;
    }
    return resolved;
}

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
    if (percentile && percentile.kind !== 'exactperc') {
        const label = percentile.kind === 'upperperc' ? `upper p${percentile.value}` : `p${percentile.value}`;
        return { name, label, chart: 'line', rate: false };
    }
    return BY_LABEL.get(name) ?? null;
}
