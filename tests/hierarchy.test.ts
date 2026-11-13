import { buildSourcetypeTree } from '../src/catalog/metricTree';
import { collectValueMetrics } from '../src/search/runSearch';
import { hierarchyFromMetadata } from '../src/model/loadDefaults';

test('sourcetypes fold on the first colon, and otherwise on a shared underscore', () => {
    const tree = buildSourcetypeTree([
        'node:sidecar:a',
        'node:sidecar:b',
        'splunk_web_access',
        'splunk_web_service',
        'stash',
        'once_only',
    ]);
    expect(tree.map((node) => node.label)).toEqual(['node', 'once_only', 'splunk', 'stash']);
    expect(tree.find((node) => node.label === 'node')?.children.map((child) => child.metricName)).toEqual([
        'node:sidecar:a',
        'node:sidecar:b',
    ]);
    expect(tree.find((node) => node.label === 'splunk')?.children.map((child) => child.label)).toEqual(['web_access', 'web_service']);
});

test('catalog rows become dimension values with their metrics', () => {
    const rows = collectValueMetrics(
        {
            results: [
                { extracted_host: 'lab-a', 'values(metric_name)': ['lab.cpu.user', 'lab.net.bytes_total'] },
                { extracted_host: 'lab-b', 'values(metric_name)': 'lab.net.bytes_total' },
                { extracted_host: '', 'values(metric_name)': 'orphan' },
            ],
        },
        'extracted_host'
    );
    expect(rows).toEqual([
        { value: 'lab-a', metrics: ['lab.cpu.user', 'lab.net.bytes_total'] },
        { value: 'lab-b', metrics: ['lab.net.bytes_total'] },
    ]);
});

test('metadata settings are used only when they are valid', () => {
    expect(hierarchyFromMetadata({ hierarchy_source: 'kepware_path', hierarchy_separator: '/' })).toEqual({
        hierarchySource: 'kepware_path',
        hierarchySeparator: '/',
    });
    expect(hierarchyFromMetadata({ hierarchy_source: 'a"b', hierarchy_separator: '#' })).toEqual({
        hierarchySource: 'metric_name',
        hierarchySeparator: '.',
    });
    expect(hierarchyFromMetadata({})).toEqual({ hierarchySource: 'metric_name', hierarchySeparator: '.' });
});
