import { buildCatalogSearch, filtersFromStanza, indexFromSearch, pickDefaults, validateFilter } from '../src/model/dataFilters';

test('no filters searches every index', () => {
    expect(buildCatalogSearch([])).toBe('| mcatalog values(metric_name) WHERE index=*');
});

test('index and exclude filters narrow the catalog search', () => {
    expect(
        buildCatalogSearch([
            { kind: 'index', value: 'metrics_lab' },
            { kind: 'index', value: 'other' },
            { kind: 'exclude', value: 'itsi.*' },
        ])
    ).toBe('| mcatalog values(metric_name) WHERE (index="metrics_lab" OR index="other") AND NOT metric_name="itsi.*"');
});

test('filter values are quoted, so they cannot add search terms', () => {
    const search = buildCatalogSearch([{ kind: 'exclude', value: 'a" OR metric_name=*' }]);
    expect(search).toBe('| mcatalog values(metric_name) WHERE index=* AND NOT metric_name="a\\" OR metric_name=*"');
});

test('invalid values are rejected before they reach a search', () => {
    expect(validateFilter({ kind: 'index', value: '' })).toBe('Enter a value.');
    expect(validateFilter({ kind: 'index', value: 'a*' })).not.toBeNull();
    expect(validateFilter({ kind: 'index', value: 'metrics_lab' })).toBeNull();
    expect(validateFilter({ kind: 'exclude', value: 'itsi.*' })).toBeNull();
    expect(validateFilter({ kind: 'exclude', value: 'x"y' })).not.toBeNull();
});

test('a stanza becomes filters, and lists are comma separated', () => {
    expect(filtersFromStanza({ indexes: 'metrics_lab, other', metric_name_exclude: 'itsi.*' })).toEqual([
        { kind: 'index', value: 'metrics_lab' },
        { kind: 'index', value: 'other' },
        { kind: 'exclude', value: 'itsi.*' },
    ]);
    expect(filtersFromStanza({})).toEqual([]);
});

test('a role stanza wins over the default for users with that role', () => {
    const stanzas = [
        { name: 'defaults', content: { metric_name_exclude: 'itsi.*' } },
        { name: 'defaults:role_analyst', content: { indexes: 'metrics_lab' } },
    ];
    expect(pickDefaults(stanzas, ['analyst'])).toEqual([{ kind: 'index', value: 'metrics_lab' }]);
    expect(pickDefaults(stanzas, ['user'])).toEqual([{ kind: 'exclude', value: 'itsi.*' }]);
    expect(pickDefaults([], ['user'])).toEqual([]);
});

test('a grouped catalog search returns one row per dimension value', () => {
    expect(buildCatalogSearch([], 'extracted_host')).toBe(
        '| mcatalog values(metric_name) WHERE index=* BY extracted_host'
    );
    expect(() => buildCatalogSearch([], 'bad dim')).toThrow('Dimension name is not allowed.');
});

test('the catalog names every metric index the user may search, including internal ones', () => {
    expect(buildCatalogSearch([], '', ['_metrics', 'metrics_lab'])).toBe(
        '| mcatalog values(metric_name) WHERE (index="_metrics" OR index="metrics_lab")'
    );
    expect(buildCatalogSearch([{ kind: 'index', value: '_metrics' }], '', ['_metrics', 'metrics_lab'])).toBe(
        '| mcatalog values(metric_name) WHERE index="_metrics"'
    );
    expect(buildCatalogSearch([{ kind: 'index', value: 'secret' }], '', ['_metrics'])).toBe(
        '| mcatalog values(metric_name) WHERE index="__mx_none__"'
    );
});

test('an index from the URL is used only when it is a valid index name', () => {
    expect(indexFromSearch('?index=metrics_lab')).toBe('metrics_lab');
    expect(indexFromSearch('?foo=1&index=other.idx')).toBe('other.idx');
    expect(indexFromSearch('?index=a*')).toBeNull();
    expect(indexFromSearch('?index=x"y')).toBeNull();
    expect(indexFromSearch('?index=')).toBeNull();
    expect(indexFromSearch('')).toBeNull();
});
