import { buildMstats } from '../src/spl/buildMstats';

test('builds one mstats command for a metric', () => {
    expect(
        buildMstats({ aggregation: 'Avg', metric: 'lab.cpu.user', span: '10s' })
    ).toBe('| mstats avg("lab.cpu.user") WHERE index=* span=10s');
});

test('accepts a typed percentile', () => {
    expect(
        buildMstats({ aggregation: 'p99', metric: 'lab.cpu.user', span: '1m', index: 'metrics_lab' })
    ).toBe('| mstats p99("lab.cpu.user") WHERE index="metrics_lab" span=1m');
});

test('rejects a metric name that could break out of the search', () => {
    expect(() =>
        buildMstats({ aggregation: 'avg', metric: 'cpu.user" | delete', span: '10s' })
    ).toThrow('Metric name is not allowed.');
});

test('splits a series by a dimension and keeps the five highest values', () => {
    expect(
        buildMstats({
            aggregation: 'Avg',
            metric: 'cpu_metric.pctUser',
            span: '10s',
            splitBy: 'IP_address',
        })
    ).toBe(
        '| mstats avg("cpu_metric.pctUser") AS value WHERE index=* span=10s BY IP_address | chart useother=false first(value) over _time BY IP_address WHERE max in top5'
    );
});

test('uses the lowest values when that limit is selected', () => {
    expect(
        buildMstats({
            aggregation: 'Avg',
            metric: 'cpu_metric.pctUser',
            span: '10s',
            splitBy: 'host',
            splitDirection: 'lowest',
            splitLimit: 10,
        })
    ).toContain('WHERE min in bottom10');
});

test('moves a series onto the current axis after reading an earlier window', () => {
    expect(
        buildMstats({ aggregation: 'Avg', metric: 'lab.cpu.user', span: '10s', timeShift: '60m' })
    ).toContain('| eval _time=relative_time(_time, "+60m")');
});

test('rejects a time shift that is not one of the presets', () => {
    expect(() =>
        buildMstats({ aggregation: 'avg', metric: 'lab.cpu.user', span: '10s', timeShift: '60m | delete' })
    ).toThrow('Time shift is not allowed.');
});

test('rejects a split field that could break out of the search', () => {
    expect(() =>
        buildMstats({ aggregation: 'avg', metric: 'lab.cpu.user', span: '10s', splitBy: 'host | delete' })
    ).toThrow('Split field is not allowed.');
});

test('includes one dimension value the way the original workspace does', () => {
    expect(
        buildMstats({
            aggregation: 'Avg',
            metric: 'cpu_metric.pctUser',
            span: '10s',
            splitBy: 'IP_address',
            filters: [{ dimension: 'CPU', mode: 'include', values: ['0'] }],
        })
    ).toContain('AND "CPU"="0"');
});

test('excludes a value with NOT and groups several values', () => {
    expect(
        buildMstats({
            aggregation: 'Avg',
            metric: 'lab.cpu.user',
            span: '10s',
            filters: [{ dimension: 'extracted_host', mode: 'exclude', values: ['lab-a', 'lab-b'] }],
        })
    ).toContain('AND NOT ("extracted_host"="lab-a" OR "extracted_host"="lab-b")');
});

test('rejects a filter value that breaks out of the quotes', () => {
    expect(() =>
        buildMstats({
            aggregation: 'Avg',
            metric: 'lab.cpu.user',
            span: '10s',
            filters: [{ dimension: 'host', mode: 'include', values: ['lab\n| delete'] }],
        })
    ).toThrow('Line breaks are not allowed.');
});

test('rejects an unknown aggregation', () => {
    expect(() =>
        buildMstats({ aggregation: 'delete', metric: 'lab.cpu.user', span: '10s' })
    ).toThrow('Unknown aggregation.');
});
