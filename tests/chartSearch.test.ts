import { classicDashboard } from '../src/actions/dashboards';
import { createChart, createSeries } from '../src/model/workspace';
import { buildCalcMstats } from '../src/spl/buildMstats';
import { buildChartSearch, buildSeriesSearch, injectTimeBounds } from '../src/spl/seriesSearch';

function metric(name: string) {
    const item = createSeries(name);
    item.splitBy = '';
    return item;
}

test('one series exports the same search as the chart runs', () => {
    const item = metric('lab.cpu.user');
    expect(buildChartSearch([item], '10s', '-60m', 'now', []).search).toBe(
        buildSeriesSearch(item, '10s', '-60m', 'now', []).search
    );
});

test('two series are appended and joined on _time', () => {
    const search = buildChartSearch([metric('lab.cpu.user'), metric('lab.cpu.idle')], '10s', '-60m', 'now', []).search;
    expect(search).toContain('lab.cpu.user');
    expect(search).toContain('lab.cpu.idle');
    expect(search).toContain('| append [');
    expect(search).toContain('| stats first(*) AS * BY _time');
    expect(search).toContain('rename * AS');
});

test('a split chart still names both metrics', () => {
    const left = metric('lab.cpu.user');
    const right = metric('lab.cpu.idle');
    left.splitBy = 'host';
    right.splitBy = 'host';
    const search = buildChartSearch([left, right], '1m', '-1h', 'now', []).search;
    expect(search).toContain('BY host');
    expect(search).toContain('lab.cpu.user');
    expect(search).toContain('lab.cpu.idle');
});

test('a calculated series is one mstats with an eval', () => {
    const item = createSeries('(lab.cpu.user + lab.cpu.idle) * 8', [], 'calc');
    item.field = '(lab.cpu.user + lab.cpu.idle) * 8';
    item.splitBy = '';
    const search = buildSeriesSearch(item, '10s', '-60m', 'now', []).search;
    expect(search).toContain('avg("lab.cpu.user") AS m1');
    expect(search).toContain('avg("lab.cpu.idle") AS m2');
    expect(search).toContain('| eval value=((m1)+(m2))*(8)');
    expect(search).toContain('| fields _time, value');
});

test('a calculated series with a split reuses the chart tail', () => {
    expect(
        buildCalcMstats({
            aggregation: 'Avg',
            metrics: ['lab.cpu.user', 'lab.cpu.idle'],
            evalExpr: '(m1)+(m2)',
            span: '10s',
            splitBy: 'host',
        })
    ).toContain('| chart useother=false first(value) over _time BY host WHERE max in top5');
});

test('time bounds are injected after WHERE', () => {
    expect(injectTimeBounds('| mstats avg("cpu") WHERE index=* span=10s', '-90m', 'now')).toBe(
        '| mstats avg("cpu") WHERE earliest=-90m latest=now index=* span=10s'
    );
});

test('an injected bound that is not a time token is refused', () => {
    expect(() => injectTimeBounds('| mstats avg("cpu") WHERE index=*', '-1h | delete', 'now')).toThrow(
        'Time range is not allowed.'
    );
});

test('a formula plus another series still exports both', () => {
    const calc = createSeries('(lab.cpu.user + lab.cpu.idle) * 8', [], 'calc');
    calc.field = '(lab.cpu.user + lab.cpu.idle) * 8';
    calc.splitBy = '';
    const extra = metric('lab.mem.used');
    extra.splitBy = '';
    const search = buildChartSearch([calc, extra], '10s', '-60m', 'now', []).search;
    expect(search).toContain('lab.cpu.user');
    expect(search).toContain('lab.mem.used');
    expect(search).toContain('| append [');
});

test('a dashboard panel from two series keeps both metric names', () => {
    const chart = createChart('lab.cpu.user');
    chart.series[0].splitBy = '';
    chart.series.push(metric('lab.cpu.idle'));
    const query = buildChartSearch(chart.series, '10s', '-60m', 'now', []);
    const xml = classicDashboard('Lab', [
        { title: 'cpu', search: query.search, earliest: query.earliest, latest: query.latest, chart: 'line', stacked: false },
    ]);
    expect(xml).toContain('lab.cpu.user');
    expect(xml).toContain('lab.cpu.idle');
});
