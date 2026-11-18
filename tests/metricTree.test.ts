import { buildMetricTree, buildValueTree } from '../src/catalog/metricTree';

test('groups lab metrics the way the original workspace does', () => {
    const tree = buildMetricTree(['lab.cpu.user', 'lab.net.bytes_total']);
    expect(tree).toEqual([
        {
            id: 'lab/',
            label: 'lab',
            folder: true,
            children: [
                { id: 'lab.cpu.user', label: 'cpu.user', folder: false, metricName: 'lab.cpu.user', children: [] },
                {
                    id: 'lab.net.bytes_total',
                    label: 'net.bytes_total',
                    folder: false,
                    metricName: 'lab.net.bytes_total',
                    children: [],
                },
            ],
        },
    ]);
});

test('keeps a unique suffix on the leaf and folds a unique folder chain', () => {
    const tree = buildMetricTree([
        'k8s.namespace.phase',
        'k8s.container.ready',
        'k8s.container.restarts',
        'k8s.container.cpu.usage',
        'k8s.container.cpu.limit',
        'os.unix.nmon.cpu',
        'os.unix.nmon.mem',
    ]);
    const k8s = tree.find((node) => node.label === 'k8s');
    const nmon = tree.find((node) => node.label === 'os.unix.nmon');
    expect(k8s?.folder).toBe(true);
    expect(k8s?.children.map((node) => node.label)).toEqual([
        'container',
        'namespace.phase',
    ]);
    const container = k8s?.children.find((node) => node.label === 'container');
    expect(container?.children.map((node) => `${node.folder ? 'f' : 'l'}:${node.label}`)).toEqual([
        'f:cpu',
        'l:ready',
        'l:restarts',
    ]);
    expect(nmon?.folder).toBe(true);
    expect(nmon?.children.map((node) => node.label)).toEqual(['cpu', 'mem']);
});

test('splits metric names at a chosen separator', () => {
    const tree = buildMetricTree(['lab/cpu/user', 'lab/net/bytes'], '/');
    expect(tree[0]).toMatchObject({ label: 'lab', folder: true });
    expect(tree[0].children.map((node) => node.label)).toEqual(['cpu/user', 'net/bytes']);
});

test('dot and underscore together fold otelcol_* next to dotted names', () => {
    const tree = buildMetricTree(
        [
            'otelcol.k8s.watcher',
            'otelcol_exporter_in_flight_requests',
            'otelcol_exporter_queue_capacity',
            'otelcol_exporter_queue_size',
            'scrape_samples_scraped',
            'scrape_duration_seconds',
            'k8s.pod.cpu.usage',
        ],
        '._'
    );
    expect(tree.map((node) => `${node.folder ? 'f' : 'l'}:${node.label}`)).toEqual([
        'l:k8s.pod.cpu.usage',
        'f:otelcol',
        'f:scrape',
    ]);
    expect(tree.find((node) => node.label === 'k8s.pod.cpu.usage')?.metricName).toBe('k8s.pod.cpu.usage');
    const otelcol = tree.find((node) => node.label === 'otelcol');
    expect(otelcol?.children.map((node) => `${node.folder ? 'f' : 'l'}:${node.label}`)).toEqual([
        'f:exporter',
        'l:k8s.watcher',
    ]);
    const exporter = otelcol?.children.find((node) => node.label === 'exporter');
    expect(exporter?.children.map((node) => `${node.folder ? 'f' : 'l'}:${node.label}`)).toEqual([
        'l:in.flight.requests',
        'f:queue',
    ]);
    expect(exporter?.children.find((node) => node.label === 'in.flight.requests')?.metricName).toBe(
        'otelcol_exporter_in_flight_requests'
    );
    expect(exporter?.children.find((node) => node.label === 'queue')?.children.map((node) => node.metricName)).toEqual([
        'otelcol_exporter_queue_capacity',
        'otelcol_exporter_queue_size',
    ]);
    const scrape = tree.find((node) => node.label === 'scrape');
    expect(scrape?.children.map((node) => node.metricName)).toEqual([
        'scrape_duration_seconds',
        'scrape_samples_scraped',
    ]);
});

test('groups by a dimension value and lists the metrics under each value', () => {
    const tree = buildValueTree(
        'extracted_host',
        [
            { value: 'lab-a', metrics: ['lab.cpu.user', 'lab.net.bytes_total'] },
            { value: 'lab-b', metrics: ['lab.net.bytes_total'] },
        ],
        '.'
    );
    expect(tree.map((node) => node.label)).toEqual(['lab-a', 'lab-b']);
    expect(tree[0].folder).toBe(true);
    expect(tree[0].children.map((node) => node.label)).toEqual(['lab.cpu.user', 'lab.net.bytes_total']);
    expect(tree[0].children[1]).toMatchObject({
        metricName: 'lab.net.bytes_total',
        folder: false,
        filter: { dimension: 'extracted_host', value: 'lab-a' },
    });
});

test('a dimension value with a separator becomes nested folders', () => {
    const tree = buildValueTree(
        'kepware_path',
        [{ value: 'plant/line1/robot', metrics: ['m.a'] }],
        '/'
    );
    expect(tree[0]).toMatchObject({ label: 'plant', folder: true });
    expect(tree[0].children[0]).toMatchObject({ label: 'line1', folder: true });
    expect(tree[0].children[0].children[0]).toMatchObject({ label: 'robot', folder: true });
    expect(tree[0].children[0].children[0].children[0]).toMatchObject({
        metricName: 'm.a',
        filter: { dimension: 'kepware_path', value: 'plant/line1/robot' },
    });
});
