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

/** One value per category. Without a split, the single total is one row named after the series. */
export function toCategoryTable(rows: SearchRow[], seriesName: string, splitBy?: string): LineTable {
    if (splitBy) {
        const categories: string[] = [];
        const values: string[] = [];
        for (const row of rows) {
            const category = text(row[splitBy]);
            if (!category) {
                continue;
            }
            const valueKey = seriesNames(row).find((name) => name !== splitBy);
            categories.push(category);
            values.push(text(valueKey ? row[valueKey] : ''));
        }
        return { fields: [{ name: splitBy }, { name: seriesName }], columns: [categories, values] };
    }
    const row = rows.find((item) => seriesNames(item).length > 0);
    const valueKey = row ? seriesNames(row)[0] : '';
    return {
        fields: [{ name: 'category' }, { name: seriesName }],
        columns: [[seriesName], [text(row && valueKey ? row[valueKey] : '')]],
    };
}

/**
 * Joins categorical tables on the category, keeping the order of the first table.
 * The category column is not named `_time`, so the chart does not read it as a time axis.
 */
export function mergeCategoryTables(tables: LineTable[]): LineTable {
    const order: string[] = [];
    const seen = new Set<string>();
    for (const table of tables) {
        for (const key of table.columns[0] ?? []) {
            if (key && !seen.has(key)) {
                seen.add(key);
                order.push(key);
            }
        }
    }
    const counts = new Map<string, number>();
    tables.forEach((table) => {
        table.fields.slice(1).forEach((field) => counts.set(field.name, (counts.get(field.name) ?? 0) + 1));
    });
    const fields = [{ name: 'category' }];
    const columns: string[][] = [order];
    tables.forEach((table, tableIndex) => {
        const index = new Map((table.columns[0] ?? []).map((key, position) => [key, position]));
        table.fields.slice(1).forEach((field, fieldIndex) => {
            const name = (counts.get(field.name) ?? 0) > 1 ? `${tableIndex + 1} ${field.name}` : field.name;
            fields.push({ name });
            const source = table.columns[fieldIndex + 1] ?? [];
            columns.push(order.map((key) => source[index.get(key) ?? -1] ?? ''));
        });
    });
    return { fields, columns };
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
