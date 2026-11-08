import { LineTable } from './columns';

type HeatSeries = { metric: string; splitBy: string };

/** Row labels are the metric, or the split value when the series is split. */
export function heatmapTable(
    series: HeatSeries[],
    tables: LineTable[],
    indexes: number[],
    merged: LineTable
): LineTable {
    const names = merged.fields.map((field) => field.name);
    let cursor = 1;
    indexes.forEach((seriesIndex) => {
        const item = series[seriesIndex];
        const table = tables[seriesIndex];
        table.fields.slice(1).forEach((field) => {
            names[cursor] = item?.splitBy ? field.name : item?.metric ?? field.name;
            cursor += 1;
        });
    });
    return { fields: names.map((name) => ({ name })), columns: merged.columns };
}

/** Stops observed on the original workspace color axis: red at the minimum, yellow in the middle, green at the top. */
const STOPS: Array<[number, number, number, number]> = [
    [0, 0xdc, 0x4e, 0x41],
    [0.5, 0xf8, 0xbe, 0x34],
    [0.9, 0x53, 0xa0, 0x51],
    [1, 0x53, 0xa0, 0x51],
];

export function heatColor(value: number, min: number, max: number): string {
    const span = max - min;
    const ratio = span === 0 ? 1 : Math.min(1, Math.max(0, (value - min) / span));
    let lower = STOPS[0];
    let upper = STOPS[STOPS.length - 1];
    for (let index = 1; index < STOPS.length; index += 1) {
        if (ratio <= STOPS[index][0]) {
            lower = STOPS[index - 1];
            upper = STOPS[index];
            break;
        }
    }
    const width = upper[0] - lower[0] || 1;
    const blend = (ratio - lower[0]) / width;
    const channel = (offset: number) => Math.round(lower[offset] + (upper[offset] - lower[offset]) * blend);
    return `rgb(${channel(1)}, ${channel(2)}, ${channel(3)})`;
}

export function heatRange(columns: string[][]): { min: number; max: number } {
    let min = Infinity;
    let max = -Infinity;
    for (const column of columns.slice(1)) {
        for (const cell of column) {
            if (cell === '') {
                continue;
            }
            const value = Number(cell);
            if (!Number.isFinite(value)) {
                continue;
            }
            min = Math.min(min, value);
            max = Math.max(max, value);
        }
    }
    if (!Number.isFinite(min)) {
        return { min: 0, max: 0 };
    }
    return { min, max };
}

/** Matches the original color-axis labels, for example 500.0m and 1.5b. */
export function formatHeatTick(value: number): string {
    if (value === 0) {
        return '0';
    }
    const sign = value < 0 ? '-' : '';
    const abs = Math.abs(value);
    if (abs >= 1e9) {
        return `${sign}${(abs / 1e9).toFixed(1)}b`;
    }
    if (abs >= 1e6) {
        return `${sign}${(abs / 1e6).toFixed(1)}m`;
    }
    if (abs >= 1e3) {
        return `${sign}${(abs / 1e3).toFixed(1)}k`;
    }
    return `${sign}${abs >= 10 ? Math.round(abs) : abs.toFixed(1)}`;
}
