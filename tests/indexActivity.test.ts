import { buildIndexActivitySearch, indexesWithData } from '../src/model/indexActivity';

test('the activity search counts metric data per allowed index', () => {
    expect(buildIndexActivitySearch(['_metrics', 'metrics_lab'])).toBe(
        '| mstats count WHERE (index="_metrics" OR index="metrics_lab") BY index'
    );
    expect(buildIndexActivitySearch([])).toBe('| mstats count WHERE index="__mx_none__" BY index');
});

test('an index with a result row received data', () => {
    expect(
        indexesWithData({
            results: [{ index: '_metrics', count: '12' }, { index: '  ' }, { count: '4' }, { index: 'em_metrics' }],
        })
    ).toEqual(['_metrics', 'em_metrics']);
    expect(indexesWithData({})).toEqual([]);
});
