import { LineTable } from './columns';
import { resolveMetricFunction } from '../spl/functions';
import { parseTimeShift, shiftSeconds } from '../spl/timeShift';

export type ReferenceLine = {
    kind: 'constant' | 'aggregation';
    value: string;
    label: string;
    includeValue: boolean;
    /** Set together with latest for a window other than the chart. Both are allowlisted relative times. */
    earliest?: string;
    latest?: string;
};

function isBound(value: string): boolean {
    if (value === 'now') {
        return true;
    }
    return value.startsWith('-') && parseTimeShift(value.slice(1)) !== null;
}

function agoSeconds(value: string): number | null {
    if (value === 'now') {
        return 0;
    }
    const parsed = parseTimeShift(value.slice(1));
    if (!parsed) {
        return null;
    }
    if (parsed.unit === 'mon') {
        return parsed.amount * 30 * 86400;
    }
    if (parsed.unit === 'y') {
        return parsed.amount * 365 * 86400;
    }
    return shiftSeconds(value.slice(1));
}

/** Accepts now or -7d, -2mon and similar. The start must be earlier than the end. */
export function referenceWindow(earliest: string, latest: string): { earliest: string; latest: string } | null {
    const start = earliest.trim();
    const end = latest.trim();
    if (!isBound(start) || !isBound(end)) {
        return null;
    }
    const startAgo = agoSeconds(start);
    const endAgo = agoSeconds(end);
    if (startAgo === null || endAgo === null || startAgo <= endAgo) {
        return null;
    }
    return { earliest: start, latest: end };
}

export function referenceSummary(line: ReferenceLine): string {
    const name = line.label.trim() || line.value.trim();
    if (!line.earliest) {
        return name;
    }
    return `${name} (${line.earliest} to ${line.latest || 'now'})`;
}

function finiteNumbers(table: LineTable): number[] {
    const numbers: number[] = [];
    table.columns.slice(1).forEach((column) => {
        column.forEach((cell) => {
            if (cell === '') {
                return;
            }
            const value = Number(cell);
            if (Number.isFinite(value)) {
                numbers.push(value);
            }
        });
    });
    return numbers;
}

function percentile(sorted: number[], percent: number): number {
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percent / 100) * sorted.length) - 1));
    return sorted[index];
}

function mean(values: number[]): number {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function referenceNumber(table: LineTable, line: ReferenceLine): number | null {
    if (line.kind === 'constant') {
        const value = Number(line.value);
        return Number.isFinite(value) ? value : null;
    }
    const chosen = resolveMetricFunction(line.value);
    if (!chosen || chosen.chart !== 'line' || chosen.rate || chosen.name.startsWith('upperperc')) {
        return null;
    }
    const values = finiteNumbers(table);
    if (values.length === 0) {
        return null;
    }
    const sorted = [...values].sort((left, right) => left - right);
    const name = chosen.name;
    if (name === 'avg') {
        return mean(values);
    }
    if (name === 'sum') {
        return values.reduce((sum, value) => sum + value, 0);
    }
    if (name === 'min') {
        return sorted[0];
    }
    if (name === 'max') {
        return sorted[sorted.length - 1];
    }
    if (name === 'count') {
        return values.length;
    }
    if (name === 'range') {
        return sorted[sorted.length - 1] - sorted[0];
    }
    if (name === 'median') {
        return percentile(sorted, 50);
    }
    if (name === 'sumsq') {
        return values.reduce((sum, value) => sum + value * value, 0);
    }
    if (name === 'stdev' || name === 'stdevp' || name === 'var' || name === 'varp') {
        const average = mean(values);
        const divisor = name === 'stdev' ? Math.max(1, values.length - 1) : values.length;
        const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / divisor;
        return name.startsWith('stdev') ? Math.sqrt(variance) : variance;
    }
    if (name === 'latest') {
        return values[values.length - 1];
    }
    if (name === 'earliest') {
        return values[0];
    }
    const percent = /^(?:perc|p)(\d+(?:\.\d+)?)$/.exec(name);
    if (percent) {
        return percentile(sorted, Number(percent[1]));
    }
    return null;
}

export function formatReferenceNumber(value: number): string {
    if (Number.isInteger(value)) {
        return String(value);
    }
    return String(Math.round(value * 1000) / 1000);
}

export function referenceLegend(line: ReferenceLine, numeric: number): string {
    const shown = line.kind === 'constant' ? line.value.trim() : formatReferenceNumber(numeric);
    const label = line.label.trim();
    if (label && line.includeValue) {
        return `${label}: ${shown}`;
    }
    return label || shown;
}

export function addReferenceLines(
    table: LineTable,
    lines: ReferenceLine[],
    supplied?: Array<number | null | undefined>
): LineTable {
    const count = table.columns[0]?.length ?? 0;
    if (count === 0 || lines.length === 0) {
        return table;
    }
    const fields = [...table.fields];
    const columns = table.columns.map((column) => [...column]);
    lines.forEach((line, index) => {
        const given = supplied?.[index];
        const numeric = given === undefined ? referenceNumber(table, line) : given;
        if (numeric === null) {
            return;
        }
        const name = referenceLegend(line, numeric);
        const shown = line.kind === 'constant' ? line.value.trim() : formatReferenceNumber(numeric);
        fields.push({ name });
        columns.push(Array.from({ length: count }, () => shown));
    });
    return { fields, columns };
}
