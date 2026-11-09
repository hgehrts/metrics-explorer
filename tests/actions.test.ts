import { alertCondition, alertSearch, metricAlertCondition, scheduledAlertFields } from '../src/actions/alerts';
import { appendClassicPanels, classicDashboard, studioDashboard } from '../src/actions/dashboards';

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
    expect(metricAlertCondition('avg', 'lab.cpu.user', 'less than', '10')).toBe('avg("lab.cpu.user") < 10');
});
