const COMPARATORS = ['greater than', 'less than', 'equal to'] as const;
export type AlertComparator = (typeof COMPARATORS)[number];

const SYMBOL: Record<AlertComparator, string> = {
    'greater than': '>',
    'less than': '<',
    'equal to': '=',
};

export const ALERT_SCHEDULES = [
    { id: '*/5 * * * *', label: 'Every 5 minutes' },
    { id: '0 * * * *', label: 'Hourly' },
    { id: '0 0 * * *', label: 'Daily' },
] as const;

export function alertComparator(value: string): AlertComparator {
    return COMPARATORS.includes(value as AlertComparator) ? (value as AlertComparator) : 'greater than';
}

/**
 * The saved search compares the latest numeric value. mstats names that column after the function,
 * so the last row is turned into alert_value before the condition runs.
 */
export function alertSearch(chartSearch: string): string {
    if (/[\r\n]/.test(chartSearch) || chartSearch.includes(']]>')) {
        throw new Error('The search cannot be stored.');
    }
    return `${chartSearch} | fields - _span | tail 1 | untable _time field alert_value | where isnum(alert_value) | tail 1`;
}

export function alertCondition(comparator: AlertComparator, threshold: string): string {
    if (!/^-?\d+(\.\d+)?$/.test(threshold.trim())) {
        throw new Error('Threshold must be a number.');
    }
    return `search alert_value ${SYMBOL[comparator]} ${threshold.trim()}`;
}

/** Fields for a scheduled saved-search alert. The trigger action is the fired-alerts list. */
export function scheduledAlertFields(input: {
    name: string;
    search: string;
    earliest: string;
    comparator: AlertComparator;
    threshold: string;
    cron: string;
    severity: number;
    throttle: string;
}): Record<string, string> {
    const cron = ALERT_SCHEDULES.some((item) => item.id === input.cron) ? input.cron : ALERT_SCHEDULES[1].id;
    const severity = Math.min(5, Math.max(1, Math.round(input.severity)));
    const fields: Record<string, string> = {
        name: input.name.trim(),
        search: alertSearch(input.search),
        'dispatch.earliest_time': input.earliest,
        'dispatch.latest_time': 'now',
        is_scheduled: '1',
        cron_schedule: cron,
        alert_type: 'custom',
        alert_condition: alertCondition(input.comparator, input.threshold),
        'alert.track': '1',
        'alert.severity': String(severity),
        'alert.suppress': '0',
    };
    if (/^\d+[smhd]$/.test(input.throttle)) {
        fields['alert.suppress'] = '1';
        fields['alert.suppress.period'] = input.throttle;
    }
    return fields;
}

/** Condition language for a streaming metric alert. Only a metric series can use one. */
export function metricAlertCondition(aggregation: string, metric: string, comparator: AlertComparator, threshold: string): string {
    if (!/^[A-Za-z0-9_.:-]+$/.test(metric)) {
        throw new Error('Metric name is not allowed.');
    }
    if (!/^[a-z0-9_.]+$/.test(aggregation)) {
        throw new Error('Unknown aggregation.');
    }
    if (!/^-?\d+(\.\d+)?$/.test(threshold.trim())) {
        throw new Error('Threshold must be a number.');
    }
    return `${aggregation}("${metric}") ${SYMBOL[comparator]} ${threshold.trim()}`;
}
