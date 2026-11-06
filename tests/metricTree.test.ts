import { buildMetricTree } from '../src/catalog/metricTree';

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
