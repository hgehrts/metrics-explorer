/** Separators offered for the tree. `. and _` is the default so both dotted and underscored names fold. */
export const HIERARCHY_SEPARATORS = ['.', '._', '_', '/', '\\', ':', '|'] as const;

export const DEFAULT_HIERARCHY_SEPARATOR = '._';

/** Splits a name at every character in `separator`. `._` splits on both `.` and `_`. */
export function splitHierarchyName(name: string, separator: string): string[] {
    if (!separator) {
        return [name];
    }
    const chars = separator === '._' ? '._' : separator;
    const parts: string[] = [];
    let current = '';
    for (const ch of name) {
        if (chars.includes(ch)) {
            if (current) {
                parts.push(current);
                current = '';
            }
            continue;
        }
        current += ch;
    }
    if (current) {
        parts.push(current);
    }
    return parts;
}

function joinHierarchyLabel(parts: string[], separator: string): string {
    return parts.join(separator === '._' ? '.' : separator);
}

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
    /** Original names that end at this node. Needed when `.` and `_` collapse to the same path. */
    names: string[];
};

function makeNode(segment: string): TrieNode {
    return { segment, children: new Map(), names: [] };
}

function insert(root: TrieNode, metricName: string, separator: string): void {
    const segments = splitHierarchyName(metricName, separator);
    if (segments.length === 0) {
        return;
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
    if (!current.names.includes(metricName)) {
        current.names.push(metricName);
    }
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
        while (current.names.length === 0 && current.children.size === 1) {
            const only = sortedChildren(current)[0];
            labels.push(only.segment);
            current = only;
        }
        const parts = [...prefix, ...labels];
        const folderId = `${parts.join('\u001f')}/`;
        const label = joinHierarchyLabel(labels, separator);
        const leaves = [...current.names]
            .sort((left, right) => left.localeCompare(right))
            .map((name) => ({
                id: name,
                label: current.names.length > 1 ? name : label,
                folder: false,
                metricName: name,
                children: [] as MetricNode[],
            }));
        if (current.children.size === 0) {
            result.push(...leaves);
            continue;
        }
        result.push(...leaves);
        result.push({ id: folderId, label, folder: true, children: compress(current, parts, separator) });
    }
    return result.sort((left, right) => left.label.localeCompare(right.label));
}

/**
 * Separator for a sourcetype list. Splunk sourcetypes usually use `:`, metric-like names use `.`.
 * The character that appears in the most names wins, so the list folds into folders instead of one long column.
 */
function sourcetypeLeaf(name: string, label: string): MetricNode {
    return { id: name, label, folder: false, metricName: name, children: [] };
}

/**
 * Sourcetypes fold on the first `:`. Names without one fold on the first `.`, then on the first `_`, when several share it.
 * A group of one stays a single row. Folders start closed, so a long list opens as a short one.
 */
export function buildSourcetypeTree(names: string[]): MetricNode[] {
    const colon = new Map<string, string[]>();
    const dot = new Map<string, string[]>();
    const under = new Map<string, string[]>();
    const loose: string[] = [];
    for (const name of names) {
        const text = name.trim();
        if (!text) {
            continue;
        }
        const colonAt = text.indexOf(':');
        if (colonAt > 0) {
            const head = text.slice(0, colonAt);
            colon.set(head, [...(colon.get(head) ?? []), text]);
            continue;
        }
        const dotAt = text.indexOf('.');
        if (dotAt > 0) {
            const head = text.slice(0, dotAt);
            dot.set(head, [...(dot.get(head) ?? []), text]);
            continue;
        }
        const underAt = text.indexOf('_');
        if (underAt > 0) {
            const head = text.slice(0, underAt);
            under.set(head, [...(under.get(head) ?? []), text]);
            continue;
        }
        loose.push(text);
    }
    const nodes: MetricNode[] = loose.map((name) => sourcetypeLeaf(name, name));
    const addGroups = (groups: Map<string, string[]>, separator: string): void => {
        for (const [head, members] of groups) {
            if (members.length < 2) {
                nodes.push(sourcetypeLeaf(members[0], members[0]));
                continue;
            }
            nodes.push({
                id: `${head}/`,
                label: head,
                folder: true,
                children: [...members].sort().map((name) => sourcetypeLeaf(name, name.slice(head.length + separator.length))),
            });
        }
    };
    addGroups(colon, ':');
    addGroups(dot, '.');
    addGroups(under, '_');
    return nodes.sort((left, right) => left.label.localeCompare(right.label));
}

/** The metric tree, split at the separator. `. and _` is the explorer default. */
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
        const segments = splitHierarchyName(value, separator);
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
        if (!current.names.includes(value)) {
            current.names.push(value);
        }
        metricsByValue.set(value, [...new Set([...(metricsByValue.get(value) ?? []), ...row.metrics])]);
    }

    const build = (node: TrieNode, path: string[]): MetricNode[] => {
        const children: MetricNode[] = sortedChildren(node).map((child) => {
            const parts = [...path, child.segment];
            const id = parts.join('\u001f');
            return { id: `${dimension}:${id}`, label: child.segment, folder: true, children: build(child, parts) };
        });
        for (const value of node.names) {
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

/**
 * Matches a search text against a name. `*` stands for any run of characters, anywhere in the text.
 * Without `*` the text is a plain, case-insensitive substring.
 */
export function matchesQuery(text: string, query: string): boolean {
    const needle = query.trim().toLowerCase();
    if (!needle) {
        return true;
    }
    const haystack = text.toLowerCase();
    if (!needle.includes('*')) {
        return haystack.includes(needle);
    }
    const pattern = needle
        .split('*')
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*');
    return new RegExp(pattern).test(haystack);
}

/** Number of metrics (leaves) in a tree, for the "N matches found" line of a search. */
export function countLeaves(nodes: MetricNode[]): number {
    return nodes.reduce((total, node) => total + (node.folder ? countLeaves(node.children) : 1), 0);
}

export function filterMetricTree(nodes: MetricNode[], query: string): MetricNode[] {
    if (!query.trim()) {
        return nodes;
    }
    const visit = (node: MetricNode): MetricNode | null => {
        if (!node.folder) {
            return matchesQuery(`${node.metricName} ${node.label}`, query) ? node : null;
        }
        const children = node.children
            .map(visit)
            .filter((child): child is MetricNode => child !== null);
        if (children.length === 0 && !matchesQuery(node.label, query)) {
            return null;
        }
        return { ...node, children };
    };
    return nodes.map(visit).filter((node): node is MetricNode => node !== null);
}

/**
 * Keeps at most `max` distinct metric names, in name order. Used for `max_metrics`.
 * `truncated` tells the explorer to say that not all metrics are listed.
 */
export function limitMetricNames(names: string[], max: number): { names: string[]; truncated: boolean } {
    const sorted = [...new Set(names)].sort();
    return { names: sorted.slice(0, max), truncated: sorted.length > max };
}

/** Same limit for the grouped tree: drops metrics beyond `max` and any value row left without metrics. */
export function limitValueRows(rows: ValueRow[], max: number): { rows: ValueRow[]; truncated: boolean } {
    const distinct = limitMetricNames(
        rows.flatMap((row) => row.metrics),
        max
    );
    if (!distinct.truncated) {
        return { rows, truncated: false };
    }
    const allowed = new Set(distinct.names);
    const limited = rows
        .map((row) => ({ value: row.value, metrics: row.metrics.filter((name) => allowed.has(name)) }))
        .filter((row) => row.metrics.length > 0);
    return { rows: limited, truncated: true };
}
