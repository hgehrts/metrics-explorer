export type MetricNode = {
    id: string;
    label: string;
    folder: boolean;
    metricName?: string;
    children: MetricNode[];
};

type TrieNode = {
    segment: string;
    children: Map<string, TrieNode>;
    terminal: boolean;
};

function makeNode(segment: string): TrieNode {
    return { segment, children: new Map(), terminal: false };
}

function insert(root: TrieNode, metricName: string): void {
    let current = root;
    for (const segment of metricName.split('.')) {
        if (!segment) {
            return;
        }
        let child = current.children.get(segment);
        if (!child) {
            child = makeNode(segment);
            current.children.set(segment, child);
        }
        current = child;
    }
    current.terminal = true;
}

function sortedChildren(node: TrieNode): TrieNode[] {
    return [...node.children.values()].sort((left, right) =>
        left.segment.localeCompare(right.segment)
    );
}

function compress(node: TrieNode, prefix: string[]): MetricNode[] {
    const result: MetricNode[] = [];
    for (const child of sortedChildren(node)) {
        const labels = [child.segment];
        let current = child;
        while (!current.terminal && current.children.size === 1) {
            const only = sortedChildren(current)[0];
            labels.push(only.segment);
            current = only;
        }
        const parts = [...prefix, ...labels];
        const id = parts.join('.');
        const label = labels.join('.');
        if (current.children.size === 0) {
            result.push({ id, label, folder: false, metricName: id, children: [] });
            continue;
        }
        const children = compress(current, parts);
        if (current.terminal) {
            result.push({ id, label, folder: false, metricName: id, children: [] });
        }
        result.push({ id: `${id}/`, label, folder: true, children });
    }
    return result.sort((left, right) => left.label.localeCompare(right.label));
}

export function buildMetricTree(metricNames: string[]): MetricNode[] {
    const root = makeNode('');
    for (const name of metricNames) {
        if (name.trim()) {
            insert(root, name.trim());
        }
    }
    return compress(root, []);
}

export function filterMetricTree(nodes: MetricNode[], query: string): MetricNode[] {
    const needle = query.trim().toLowerCase();
    if (!needle) {
        return nodes;
    }
    const visit = (node: MetricNode): MetricNode | null => {
        if (!node.folder) {
            const haystack = `${node.metricName} ${node.label}`.toLowerCase();
            return haystack.includes(needle) ? node : null;
        }
        const children = node.children
            .map(visit)
            .filter((child): child is MetricNode => child !== null);
        if (children.length === 0 && !node.label.toLowerCase().includes(needle)) {
            return null;
        }
        return { ...node, children };
    };
    return nodes.map(visit).filter((node): node is MetricNode => node !== null);
}
