import { allowedMetricIndexNames, indexPatternAllows, loadAllowedMetricIndexes } from '../src/model/metricIndexes';

test('a star does not grant internal indexes, and _* grants only those', () => {
    expect(indexPatternAllows('*', 'metrics_lab')).toBe(true);
    expect(indexPatternAllows('*', '_metrics')).toBe(false);
    expect(indexPatternAllows('_*', '_metrics')).toBe(true);
    expect(indexPatternAllows('_*', 'metrics_lab')).toBe(false);
    expect(indexPatternAllows('_metrics', '_metrics')).toBe(true);
    expect(indexPatternAllows('_metrics', '_metrics_rollup')).toBe(false);
});

test('only metric indexes the role may search are kept', () => {
    const indexes = [
        { name: '_metrics', datatype: 'metric' },
        { name: '_internal', datatype: 'event' },
        { name: 'metrics_lab', datatype: 'metric' },
        { name: 'main', datatype: 'event' },
    ];
    expect(allowedMetricIndexNames(indexes, ['*', '_*'])).toEqual(['_metrics', 'metrics_lab']);
    expect(allowedMetricIndexNames(indexes, ['*'])).toEqual(['metrics_lab']);
    expect(allowedMetricIndexNames(indexes, ['_metrics'])).toEqual(['_metrics']);
    expect(allowedMetricIndexNames(indexes, [])).toEqual([]);
});

test('the loader asks for metric indexes and applies the role ACL', async () => {
    const calls: string[] = [];
    const names = await loadAllowedMetricIndexes(async (path) => {
        calls.push(path);
        if (path.startsWith('/services/data/indexes')) {
            return {
                entry: [
                    { name: '_metrics', content: { datatype: 'metric' } },
                    { name: 'metrics_lab', content: { datatype: 'metric' } },
                    { name: 'main', content: { datatype: 'event' } },
                ],
            };
        }
        if (path.includes('current-context')) {
            return { entry: [{ content: { roles: ['admin'] } }] };
        }
        return { entry: [{ content: { srchIndexesAllowed: ['*', '_*'], imported_roles: [] } }] };
    });
    expect(names).toEqual(['_metrics', 'metrics_lab']);
    expect(calls[0]).toContain('datatype=metric');
});

test('when the role endpoint is not readable, the session index list is used', async () => {
    const names = await loadAllowedMetricIndexes(async (path) => {
        if (path.startsWith('/services/data/indexes')) {
            return { entry: [{ name: '_metrics', content: { datatype: 'metric' } }] };
        }
        throw new Error('403');
    });
    expect(names).toEqual(['_metrics']);
});
