/** Separators offered for the tree. `.` is the default for metric names. */
export const HIERARCHY_SEPARATORS = ['.', '/', '\\', ':', '|'] as const;

export type MetricNode = {
    id: string;
    label: string;
    folder: boolean;
    metricName?: string;
    /** Set on a metric listed under a dimension value: adding it filters the series to that value. */
    filter?: { dimension: string; value: string };
    children: MetricNode[];
};

/** One dimension value from the catalog, with the metrics that carry it. */
export type ValueRow = { value: string; metrics: string[] };

type TrieNode = {
    segment: string;
    children: Map<string, TrieNode>;
    terminal: boolean;
};

function makeNode(segment: string): TrieNode {
    return { segment, children: new Map(), terminal: false };
}

function insert(root: TrieNode, metricName: string, separator: string): void {
    let current = root;
    for (const segment of metricName.split(separator)) {
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

function compress(node: TrieNode, prefix: string[], separator: string): MetricNode[] {
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
        const id = parts.join(separator);
        const label = labels.join(separator);
        if (current.children.size === 0) {
            result.push({ id, label, folder: false, metricName: id, children: [] });
            continue;
        }
        const children = compress(current, parts, separator);
        if (current.terminal) {
            result.push({ id, label, folder: false, metricName: id, children: [] });
        }
        result.push({ id: `${id}/`, label, folder: true, children });
    }
    return result.sort((left, right) => left.label.localeCompare(right.label));
}

/** The metric tree, split at the separator. Metric names are dotted, so `.` is the default. */
export function buildMetricTree(metricNames: string[], separator = '.'): MetricNode[] {
    const root = makeNode('');
    for (const name of metricNames) {
        if (name.trim()) {
            insert(root, name.trim(), separator);
        }
    }
    return compress(root, [], separator);
}

/**
 * A tree of dimension values, split at the separator. Each value lists the metrics that carry it.
 * A metric under a value filters the series to that value when it is added.
 */
export function buildValueTree(dimension: string, rows: ValueRow[], separator: string): MetricNode[] {
    const root = makeNode('');
    const metricsByValue = new Map<string, string[]>();
    for (const row of rows) {
        const value = row.value.trim();
        if (!value || !separator) {
            continue;
        }
        const segments = value.split(separator).filter(Boolean);
        if (segments.length === 0) {
            continue;
        }
        let current = root;
        for (const segment of segments) {
            let child = current.children.get(segment);
            if (!child) {
                child = makeNode(segment);
                current.children.set(segment, child);
            }
            current = child;
        }
        current.terminal = true;
        const key = segments.join(separator);
        metricsByValue.set(key, [...new Set([...(metricsByValue.get(key) ?? []), ...row.metrics])]);
    }

    const build = (node: TrieNode, path: string[]): MetricNode[] => {
        const children: MetricNode[] = sortedChildren(node).map((child) => {
            const parts = [...path, child.segment];
            const id = parts.join(separator);
            return { id: `${dimension}:${id}`, label: child.segment, folder: true, children: build(child, parts) };
        });
        if (node.terminal) {
            const value = path.join(separator);
            for (const metric of (metricsByValue.get(value) ?? []).sort()) {
                children.push({
                    id: `${dimension}:${value}|${metric}`,
                    label: metric,
                    folder: false,
                    metricName: metric,
                    filter: { dimension, value },
                    children: [],
                });
            }
        }
        return children;
    };
    return build(root, []).sort((left, right) => left.label.localeCompare(right.label));
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
