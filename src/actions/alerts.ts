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

export type EveryUnit = 'm' | 'h' | 'd';

/**
 * Cron for "evaluate every N units at minute M", as the original alert dialog asks it.
 * Minutes ignore the minute offset. Returns null for amounts cron cannot express.
 */
export function alertCron(every: string, unit: EveryUnit, minute: number): string | null {
    const amount = Number(every.trim());
    if (!/^\d{1,2}$/.test(every.trim()) || amount < 1 || ![0, 15, 30, 45].includes(minute)) {
        return null;
    }
    if (unit === 'm') {
        return amount <= 59 ? (amount === 1 ? '* * * * *' : `*/${amount} * * * *`) : null;
    }
    if (unit === 'h') {
        return amount <= 23 ? (amount === 1 ? `${minute} * * * *` : `${minute} */${amount} * * *`) : null;
    }
    return amount <= 31 ? (amount === 1 ? `${minute} 0 * * *` : `${minute} 0 */${amount} * *`) : null;
}

/** A Splunk time amount such as `10m`, for the alert window and the throttle. */
export function timeAmount(amount: string, unit: string, units: readonly string[]): string | null {
    const text = amount.trim();
    return /^\d{1,4}$/.test(text) && Number(text) >= 1 && units.includes(unit) ? `${Number(text)}${unit}` : null;
}

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
    description?: string;
    /** Extra trigger action: e-mail to these addresses. */
    emailTo?: string;
    webhookUrl?: string;
    scriptFile?: string;
}): Record<string, string> {
    const cron = CRON.test(input.cron) ? input.cron : ALERT_SCHEDULES[1].id;
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
    if (input.description?.trim()) {
        fields.description = input.description.trim();
    }
    applyTriggerActions(fields, input, true);
    return fields;
}

const CRON = /^(\*|\*\/\d{1,2}|\d{1,2}) (\*|\*\/\d{1,2}|\d{1,2}) (\*|\*\/\d{1,2}) \* \*$/;
const EMAIL = /^[^\s@,;"<>]+@[^\s@,;"<>]+\.[^\s@,;"<>]+$/;
const WEBHOOK = /^https?:\/\/[^\s]+$/;
const SCRIPT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

/** A webhook receiver. Splunk accepts only http and https, with no spaces. */
export function webhookUrl(text: string): string {
    const url = text.trim();
    if (!WEBHOOK.test(url) || url.length > 2000) {
        throw new Error('Enter a webhook URL that starts with http:// or https://.');
    }
    return url;
}

/** A file name in $SPLUNK_HOME/bin/scripts. A path would point outside that directory. */
export function scriptFile(text: string): string {
    const name = text.trim();
    if (!SCRIPT.test(name) || name.includes('..')) {
        throw new Error('Enter a script file name from the Splunk scripts directory, without a path.');
    }
    return name;
}

function applyTriggerActions(
    fields: Record<string, string>,
    input: { emailTo?: string; webhookUrl?: string; scriptFile?: string },
    listActions: boolean
): void {
    const names: string[] = [];
    const email = emailList(input.emailTo ?? '');
    if (email) {
        fields['action.email'] = '1';
        fields['action.email.to'] = email;
        names.push('email');
    }
    if (input.webhookUrl) {
        const url = webhookUrl(input.webhookUrl);
        fields['action.webhook'] = '1';
        fields['action.webhook.param.url'] = url;
        names.push('webhook');
    }
    if (input.scriptFile) {
        const name = scriptFile(input.scriptFile);
        fields['action.script'] = '1';
        fields['action.script.filename'] = name;
        names.push('script');
    }
    if (listActions && names.length > 0) {
        fields.actions = names.join(', ');
    }
}

/** Comma separated e-mail addresses, or an empty string. Throws when one of them is not an address. */
export function emailList(text: string): string {
    const items = text
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    if (items.some((item) => !EMAIL.test(item))) {
        throw new Error('Enter e-mail addresses separated by commas.');
    }
    return items.join(',');
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
    return `'${aggregation}(${metric})' ${SYMBOL[comparator]} ${threshold.trim()}`;
}

const DIMENSION = /^[A-Za-z0-9_.:-]+$/;

function quoted(value: string): string {
    if (/[\r\n]/.test(value)) {
        throw new Error('Filter values cannot span lines.');
    }
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** The `filter` of a streaming alert: series filters as `dim="v"` terms joined with AND. */
export function metricAlertFilter(filters: Array<{ dimension: string; mode: 'include' | 'exclude'; values: string[] }>): string {
    const terms: string[] = [];
    for (const filter of filters) {
        if (!DIMENSION.test(filter.dimension) || filter.values.length === 0) {
            continue;
        }
        const any = filter.values.map((value) => `${filter.dimension}=${quoted(value)}`);
        const term = any.length === 1 ? any[0] : `(${any.join(' OR ')})`;
        terms.push(filter.mode === 'exclude' ? `NOT ${term}` : term);
    }
    return terms.join(' AND ');
}

/** Fields for `alerts/metric_alerts`, the streaming alert, as metric_alerts.conf defines them. */
export function streamingAlertFields(input: {
    name: string;
    condition: string;
    metricIndexes: string;
    filter: string;
    groupby: string;
    severity: number;
    /** Suppression in minutes, or empty for none. */
    throttleMinutes: string;
    description?: string;
    emailTo?: string;
    webhookUrl?: string;
    scriptFile?: string;
}): Record<string, string> {
    const fields: Record<string, string> = {
        name: input.name,
        condition: input.condition,
        metric_indexes: input.metricIndexes,
        'trigger.threshold': 'always',
        'trigger.suppress': /^\d{1,4}$/.test(input.throttleMinutes.trim()) ? `${Number(input.throttleMinutes.trim())}m` : '0',
        'splunk_ui.track': '1',
        'splunk_ui.severity': String(Math.min(6, Math.max(1, Math.round(input.severity)))),
    };
    if (input.filter) {
        fields.filter = input.filter;
    }
    if (DIMENSION.test(input.groupby)) {
        fields.groupby = input.groupby;
    }
    if (input.description?.trim()) {
        fields.description = input.description.trim();
    }
    applyTriggerActions(fields, input, false);
    return fields;
}
