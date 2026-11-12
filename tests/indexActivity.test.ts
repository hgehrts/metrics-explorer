import { buildIndexActivitySearch, indexesWithData } from '../src/model/indexActivity';

test('the activity search counts metric data per allowed index', () => {
    expect(buildIndexActivitySearch(['_metrics', 'metrics_lab'])).toBe(
        '| mstats count WHERE metric_name="*" AND (index="_metrics" OR index="metrics_lab") BY index'
    );
    expect(buildIndexActivitySearch([])).toBe('| mstats count WHERE metric_name="*" AND index="__mx_none__" BY index');
});

test('an index with a result row received data', () => {
    expect(
        indexesWithData({
            results: [{ index: '_metrics', count: '12' }, { index: '  ' }, { count: '4' }, { index: 'em_metrics' }],
        })
    ).toEqual(['_metrics', 'em_metrics']);
    expect(indexesWithData({})).toEqual([]);
    expect(indexesWithData({ results: [{ idx: 'em_metrics', count: '1' }] }, ['em_metrics', '_metrics'])).toEqual(['em_metrics']);
});
