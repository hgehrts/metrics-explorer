import { SearchRow } from '../search/runSearch';

export type LineTable = {
    fields: { name: string }[];
    columns: string[][];
};

function text(value: unknown): string {
    return value === undefined || value === null ? '' : String(value);
}

function seriesNames(row: SearchRow): string[] {
    return Object.keys(row).filter((key) => key !== '_time' && !key.startsWith('_'));
}

export function toLineTable(rows: SearchRow[], seriesName: string, splitBy?: string): LineTable {
    if (splitBy && rows.some((row) => row[splitBy] !== undefined && row[splitBy] !== null && row[splitBy] !== '')) {
        const times: string[] = [];
        const timeIndex = new Map<string, number>();
        const series = new Map<string, string[]>();
        for (const row of rows) {
            const time = text(row._time);
            const key = text(row[splitBy]);
            if (!time || !key) {
                continue;
            }
            let index = timeIndex.get(time);
            if (index === undefined) {
                index = times.length;
                timeIndex.set(time, index);
                times.push(time);
            }
            const valueKey = seriesNames(row).find((name) => name !== splitBy);
            if (!series.has(key)) {
                series.set(key, []);
            }
            const column = series.get(key) ?? [];
            while (column.length < index) {
                column.push('');
            }
            column[index] = text(valueKey ? row[valueKey] : '');
            series.set(key, column);
        }
        for (const column of series.values()) {
            while (column.length < times.length) {
                column.push('');
            }
        }
        const names = [...series.keys()].sort();
        return {
            fields: [{ name: '_time' }, ...names.map((name) => ({ name }))],
            columns: [times, ...names.map((name) => series.get(name) ?? [])],
        };
    }

    // Splunk leaves empty fields out of a JSON row, so a sparse split shows only some series in each row.
    const names = [...new Set(rows.flatMap((row) => seriesNames(row)))];
    if (names.length <= 1) {
        const times = rows.map((row) => text(row._time)).filter((time, index) => time || rows[index]);
        const values = rows.map((row) => text(names[0] ? row[names[0]] : ''));
        return {
            fields: [{ name: '_time' }, { name: seriesName }],
            columns: [times.filter((_, index) => text(rows[index]._time)), values.filter((_, index) => text(rows[index]._time))],
        };
    }

    const times: string[] = [];
    const columns = names.map(() => [] as string[]);
    for (const row of rows) {
        if (!row._time) {
            continue;
        }
        times.push(text(row._time));
        names.forEach((name, index) => columns[index].push(text(row[name])));
    }
    return {
        fields: [{ name: '_time' }, ...names.map((name) => ({ name }))],
        columns: [times, ...columns],
    };
}
