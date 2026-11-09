import { countLeaves, buildMetricTree } from '../src/catalog/metricTree';
import { buildCatalogSearch, buildCatalogValueSearch, dimensionFilter, filterLabel, validateFilter } from '../src/model/dataFilters';
import { catalogRangeFromMetadata } from '../src/model/loadDefaults';
import { cloneSeries, createSeries, INHERIT_SPLIT, resolveSeries } from '../src/model/workspace';
import { parseRelativeStart, relativeStart } from '../src/spl/timeRange';
import { formatZoomRange } from '../src/spl/zoomLabel';

test('a dimension filter narrows the catalog like the original data filter', () => {
    const filter = dimensionFilter(' host ', '=', ['web-1', ' web-1', 'db*', '']);
    expect(filter).toMatchObject({ dimension: 'host', values: ['web-1', 'db*'] });
    expect(filterLabel(filter)).toBe('host = web-1, db*');
    expect(validateFilter(filter)).toBeNull();
    const search = buildCatalogSearch([{ kind: 'index', value: 'lab' }, filter, dimensionFilter('region', '!=', ['eu'])]);
    expect(search).toContain('index="lab"');
    expect(search).toContain('(host="web-1" OR host="db*")');
    expect(search).toContain('NOT (region="eu")');
});

test('a broken dimension filter is refused and left out of the search', () => {
    expect(validateFilter(dimensionFilter('bad name', '=', ['x']))).not.toBeNull();
    expect(validateFilter(dimensionFilter('host', '=', []))).not.toBeNull();
    expect(validateFilter(dimensionFilter('host', '=', ['a"b']))).not.toBeNull();
    expect(buildCatalogSearch([dimensionFilter('host', '=', ['a"b'])])).not.toContain('host=');
});

test('the value picker lists one dimension in the chosen indexes', () => {
    expect(buildCatalogValueSearch('host', [{ kind: 'index', value: 'lab' }])).toBe(
        '| mcatalog values(metric_name) WHERE (index="lab") AND NOT metric_name="*_mrollup_*" BY "host" | fields "host" | head 1000'
    );
    expect(() => buildCatalogValueSearch('a b', [])).toThrow();
});

test('the custom range dialog turns amount and unit into a token and back', () => {
    expect(relativeStart('4', 'h')).toBe('-4h');
    expect(relativeStart('2', 'q')).toBe('-6mon');
    expect(relativeStart('0', 'd')).toBeNull();
    expect(relativeStart('x', 'd')).toBeNull();
    expect(parseRelativeStart('-6mon')).toEqual({ amount: '6', unit: 'mon' });
    expect(parseRelativeStart('now')).toBeNull();
});

test('the catalog range follows workspace.conf earliest', () => {
    expect(catalogRangeFromMetadata({ earliest: '-1d' })).toBe('-24h');
    expect(catalogRangeFromMetadata({ earliest: '-1h' })).toBe('-60m');
    expect(catalogRangeFromMetadata({ earliest: '-7d' })).toBe('-7d');
    expect(catalogRangeFromMetadata({ earliest: '| delete' })).toBe('-24h');
    expect(catalogRangeFromMetadata({})).toBe('-24h');
});

test('inheriting series take the global split limit, explicit splits keep their own', () => {
    const inherit = { ...createSeries('cpu'), splitBy: INHERIT_SPLIT };
    const own = { ...createSeries('mem'), splitBy: 'host', splitLimit: 20 };
    const [first, second] = resolveSeries([inherit, own], 'region', true, { direction: 'lowest', limit: 10 });
    expect(first).toMatchObject({ splitBy: 'region', splitDirection: 'lowest', splitLimit: 10 });
    expect(second).toMatchObject({ splitBy: 'host', splitLimit: 20 });
});

test('a cloned series gets a new id and its own filters', () => {
    const item = createSeries('cpu', [{ dimension: 'host', mode: 'include', values: ['a'] }]);
    const copy = cloneSeries(item);
    expect(copy.id).not.toBe(item.id);
    copy.filters[0].values.push('b');
    expect(item.filters[0].values).toEqual(['a']);
});

test('the match count counts metrics, not folders', () => {
    expect(countLeaves(buildMetricTree(['a.b', 'a.c', 'd']))).toBe(3);
});

test('the zoom label shows times, and dates when the window spans days', () => {
    const start = new Date(2026, 10, 9, 20, 8).getTime() / 1000;
    const label = formatZoomRange(String(start), String(start + 16 * 60), 'de-DE');
    expect(label).toBe('20:08 - 20:24');
    expect(formatZoomRange(String(start), String(start + 2 * 86400), 'de-DE')).toContain('09.11');
    expect(formatZoomRange('x', 'y')).toBe('x - y');
});

test('host, source, and sourcetype are offered like dimensions', () => {
    const { collectDimensions } = jest.requireActual('../src/search/runSearch');
    expect(collectDimensions({ results: [{ 'values(_dims)': ['region', 'host'] }] })).toEqual(['host', 'region', 'source', 'sourcetype']);
    expect(collectDimensions({ results: [] })).toEqual(['host', 'source', 'sourcetype']);
});
