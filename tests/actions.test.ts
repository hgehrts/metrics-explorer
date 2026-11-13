import {
    alertCondition,
    alertCron,
    alertSearch,
    emailList,
    metricAlertCondition,
    metricAlertFilter,
    scheduledAlertFields,
    scriptFile,
    webhookUrl,
    streamingAlertFields,
    timeAmount,
} from '../src/actions/alerts';
import {
    appendClassicPanels,
    classicDashboard,
    dashboardIdError,
    dashboardIdFromTitle,
    studioDashboard,
} from '../src/actions/dashboards';

const panel = {
    title: 'cpu',
    search: '| mstats avg("lab.cpu.user") WHERE index=* span=30m',
    earliest: '-60m',
    latest: 'now',
    chart: 'line' as const,
    stacked: false,
};

test('a classic dashboard stores one panel per chart and escapes the title', () => {
    const xml = classicDashboard('Lab & cpu', [panel]);
    expect(xml).toContain('<label>Lab &amp; cpu</label>');
    expect(xml).toContain('<![CDATA[| mstats avg("lab.cpu.user") WHERE index=* span=30m]]>');
    expect(xml).toContain('<option name="charting.chart">line</option>');
});

test('panels append to a classic dashboard and refuse a studio dashboard', () => {
    const xml = classicDashboard('Lab', [panel]);
    const next = appendClassicPanels(xml, [{ ...panel, title: 'net' }]);
    expect(next.match(/<row>/g)).toHaveLength(2);
    expect(() => appendClassicPanels('<dashboard version="2"></dashboard>', [panel])).toThrow('Classic');
});

test('a trellis chart is stored in classic XML and in Dashboard Studio', () => {
    const trellis = {
        ...panel,
        search: '| mstats avg("lab.cpu.user") WHERE index=* span=30m BY host, ifName',
        trellis: { splitBy: 'host', minColumnWidth: 280, rowHeight: 220, columns: 2, pageSize: 8 },
    };
    const classic = classicDashboard('Lab', [trellis]);
    expect(classic).toContain('<option name="trellis.enabled">1</option>');
    expect(classic).toContain('<option name="trellis.splitBy">host</option>');
    expect(classic).toContain('<option name="trellis.size">medium</option>');
    const studio = studioDashboard('Lab', [trellis]);
    expect(studio).toContain('"splitByLayout":"trellis"');
    expect(studio).toContain('"trellisSplitBy":"host"');
    expect(studio).toContain('"trellisMinColumnWidth":280');
    expect(studio).toContain('"trellisColumns":2');
    expect(studio).toContain('"trellisPageCount":8');
    expect(studio).toContain('"trellisRowHeight":220');
});

test('a studio dashboard keeps the search in the definition', () => {
    const xml = studioDashboard('Lab', [{ ...panel, chart: 'column', stacked: true }]);
    expect(xml).toContain('version="2"');
    expect(xml).toContain('splunk.column');
    expect(xml).toContain('stackMode');
    expect(xml).toContain('lab.cpu.user');
});

test('a scheduled alert compares the latest numeric value', () => {
    expect(alertSearch('| mstats avg("lab.cpu.user") WHERE index=* span=1m')).toContain('untable _time field alert_value');
    expect(alertCondition('greater than', '80')).toBe('search alert_value > 80');
    const fields = scheduledAlertFields({
        name: 'cpu high',
        search: '| mstats avg("lab.cpu.user") WHERE index=* span=1m',
        earliest: '-60m',
        comparator: 'greater than',
        threshold: '80',
        cron: '0 * * * *',
        severity: 4,
        throttle: '1h',
    });
    expect(fields['alert.track']).toBe('1');
    expect(fields['alert.suppress.period']).toBe('1h');
    expect(fields.alert_condition).toBe('search alert_value > 80');
    expect(metricAlertCondition('avg', 'lab.cpu.user', 'less than', '10')).toBe("'avg(lab.cpu.user)' < 10");
});

test('the alert schedule reads like the original dialog', () => {
    expect(alertCron('1', 'h', 0)).toBe('0 * * * *');
    expect(alertCron('2', 'h', 15)).toBe('15 */2 * * *');
    expect(alertCron('5', 'm', 30)).toBe('*/5 * * * *');
    expect(alertCron('1', 'd', 45)).toBe('45 0 * * *');
    expect(alertCron('0', 'h', 0)).toBeNull();
    expect(alertCron('24', 'h', 0)).toBeNull();
    expect(alertCron('1', 'h', 10)).toBeNull();
    expect(timeAmount('10', 'm', ['s', 'm'])).toBe('10m');
    expect(timeAmount('x', 'm', ['m'])).toBeNull();
    expect(timeAmount('3', 'y', ['m'])).toBeNull();
});

test('an alert can also send e-mail and keeps its description', () => {
    const fields = scheduledAlertFields({
        name: 'cpu',
        search: '| mstats avg("lab.cpu.user") WHERE index=* span=1m',
        earliest: '-1h',
        comparator: 'less than',
        threshold: '5',
        cron: '15 */2 * * *',
        severity: 1,
        throttle: '',
        description: ' Lab CPU ',
        emailTo: 'a@example.com, b@example.com',
    });
    expect(fields.cron_schedule).toBe('15 */2 * * *');
    expect(fields.description).toBe('Lab CPU');
    expect(fields['action.email.to']).toBe('a@example.com,b@example.com');
    expect(fields.actions).toBe('email');
    expect(fields['alert.suppress']).toBe('0');
    expect(() => emailList('not an address')).toThrow('e-mail');
});

test('webhook and script actions keep a URL and a file name, and reject a path', () => {
    expect(webhookUrl(' https://alerts.example/hook ')).toBe('https://alerts.example/hook');
    expect(() => webhookUrl('javascript:alert(1)')).toThrow('http');
    expect(scriptFile('disk_full.py')).toBe('disk_full.py');
    expect(() => scriptFile('../bin/evil.sh')).toThrow('path');
    const scheduled = scheduledAlertFields({
        name: 'cpu',
        search: '| mstats avg("lab.cpu.user") WHERE index=* span=1m',
        earliest: '-1h',
        comparator: 'greater than',
        threshold: '80',
        cron: '0 * * * *',
        severity: 1,
        throttle: '',
        webhookUrl: 'https://alerts.example/hook',
        scriptFile: 'disk_full.py',
    });
    expect(scheduled.actions).toBe('webhook, script');
    expect(scheduled['action.webhook.param.url']).toBe('https://alerts.example/hook');
    expect(scheduled['action.script.filename']).toBe('disk_full.py');
    const streaming = streamingAlertFields({
        name: 'cpu',
        condition: "'avg(lab.cpu.user)' > 80",
        metricIndexes: '*',
        filter: '',
        groupby: '',
        severity: 1,
        throttleMinutes: '',
        webhookUrl: 'http://127.0.0.1/hook',
    });
    expect(streaming['action.webhook']).toBe('1');
    expect(streaming.actions).toBeUndefined();
});

test('a streaming alert uses the metric_alerts settings', () => {
    const filter = metricAlertFilter([
        { dimension: 'host', mode: 'include', values: ['a', 'b"c'] },
        { dimension: 'region', mode: 'exclude', values: ['eu'] },
        { dimension: 'bad name', mode: 'include', values: ['x'] },
    ]);
    expect(filter).toBe('(host="a" OR host="b\\"c") AND NOT region="eu"');
    const fields = streamingAlertFields({
        name: 'cpu',
        condition: "'avg(lab.cpu.user)' > 80",
        metricIndexes: 'lab_metrics',
        filter,
        groupby: 'host',
        severity: 3,
        throttleMinutes: '10',
    });
    expect(fields['trigger.threshold']).toBe('always');
    expect(fields['trigger.suppress']).toBe('10m');
    expect(fields['splunk_ui.track']).toBe('1');
    expect(fields.groupby).toBe('host');
    expect(fields['trigger.evaluation_per']).toBeUndefined();
    expect(streamingAlertFields({ ...fields, name: 'x', condition: 'c', metricIndexes: '*', filter: '', groupby: '', severity: 1, throttleMinutes: '' })['trigger.suppress']).toBe('0');
});

test('dashboard IDs are checked and derived from a title', () => {
    expect(dashboardIdError('cpu_load_1')).toBe('');
    expect(dashboardIdError('cpu load')).not.toBe('');
    expect(dashboardIdFromTitle(' CPU load / Lab ')).toBe('cpu_load_lab');
    expect(dashboardIdFromTitle('!!!')).toBe('dashboard');
});

test('a classic dashboard can carry a description and a time picker', () => {
    const xml = classicDashboard('Lab', [panel], { description: 'Lab <cpu>', timeInput: true });
    expect(xml).toContain('<description>Lab &lt;cpu&gt;</description>');
    expect(xml).toContain('<input type="time" token="mx_time">');
    expect(xml).toContain('<earliest>$mx_time.earliest$</earliest>');
    const next = appendClassicPanels(xml, [{ ...panel, title: 'net' }]);
    expect(next.match(/\$mx_time\.latest\$/g)).toHaveLength(2);
});

test('a studio dashboard can use the grid layout', () => {
    const xml = studioDashboard('Lab', [panel], { layout: 'grid', description: 'x' });
    expect(xml).toContain('"type":"grid"');
    expect(xml).toContain('"description":"x"');
});
