import { buildMetricTree, filterMetricTree, limitMetricNames, limitValueRows, matchesQuery } from '../src/catalog/metricTree';
import { DEFAULT_MAX_METRICS, maxMetricsFromMetadata } from '../src/model/loadDefaults';

test('a plain search text is a case-insensitive substring', () => {
    expect(matchesQuery('lab.cpu.user', 'CPU')).toBe(true);
    expect(matchesQuery('lab.cpu.user', 'mem')).toBe(false);
    expect(matchesQuery('lab.cpu.user', '')).toBe(true);
});

test('an asterisk matches any run of characters, anywhere', () => {
    expect(matchesQuery('lab.cpu.user', 'lab.*user')).toBe(true);
    expect(matchesQuery('lab.cpu.user', '*cpu*')).toBe(true);
    expect(matchesQuery('lab.cpu.user', 'lab.*mem')).toBe(false);
    expect(matchesQuery('lab.cpu.user', 'cpu.*')).toBe(true);
});

test('regular expression characters in a search text are literal', () => {
    expect(matchesQuery('lab.cpu.user', 'lab(cpu')).toBe(false);
    expect(matchesQuery('lab(cpu', 'lab(cpu')).toBe(true);
    expect(matchesQuery('a+b', 'a+*')).toBe(true);
    expect(matchesQuery('ab', 'a+*')).toBe(false);
});

test('the tree search keeps folders whose label matches a wildcard', () => {
    const tree = buildMetricTree(['lab.cpu.user', 'lab.net.bytes_total', 'k8s.pod.ready']);
    const found = filterMetricTree(tree, 'lab.*bytes');
    expect(found.map((node) => node.label)).toEqual(['lab']);
    expect(found[0].children.map((node) => node.metricName)).toEqual(['lab.net.bytes_total']);
});

test('the metric name list keeps at most max distinct names, sorted', () => {
    expect(limitMetricNames(['c', 'a', 'b', 'a'], 2)).toEqual({ names: ['a', 'b'], truncated: true });
    expect(limitMetricNames(['c', 'a'], 2)).toEqual({ names: ['a', 'c'], truncated: false });
});

test('the grouped list drops metrics beyond the limit and empty rows', () => {
    const rows = [
        { value: 'lab-a', metrics: ['a', 'b'] },
        { value: 'lab-b', metrics: ['c'] },
    ];
    expect(limitValueRows(rows, 5)).toEqual({ rows, truncated: false });
    expect(limitValueRows(rows, 2)).toEqual({
        rows: [{ value: 'lab-a', metrics: ['a', 'b'] }],
        truncated: true,
    });
});

test('max_metrics is read only when it is a whole number in range', () => {
    expect(maxMetricsFromMetadata({ max_metrics: '500' })).toBe(500);
    expect(maxMetricsFromMetadata({ max_metrics: ' 20000 ' })).toBe(20000);
    expect(maxMetricsFromMetadata({ max_metrics: '0' })).toBe(DEFAULT_MAX_METRICS);
    expect(maxMetricsFromMetadata({ max_metrics: '-3' })).toBe(DEFAULT_MAX_METRICS);
    expect(maxMetricsFromMetadata({ max_metrics: '1e9' })).toBe(DEFAULT_MAX_METRICS);
    expect(maxMetricsFromMetadata({})).toBe(DEFAULT_MAX_METRICS);
});
