import { LineTable } from '../chart/columns';

function cell(value: string): string {
    if (/[",\n]/.test(value)) {
        return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
}

export function toCsv(table: LineTable): string {
    const fields = table.fields.map((field) => field.name);
    const lines = [fields.map(cell).join(',')];
    const count = table.columns[0]?.length ?? 0;
    for (let row = 0; row < count; row += 1) {
        lines.push(fields.map((_, index) => cell(table.columns[index]?.[row] ?? '')).join(','));
    }
    return lines.join('\n');
}

export function mergeTables(tables: LineTable[]): LineTable {
    const times = [...new Set(tables.flatMap((table) => table.columns[0] ?? []))].sort();
    const fields = [{ name: '_time' }];
    const columns: string[][] = [times];
    const prefix = tables.length > 1;
    tables.forEach((table, tableIndex) => {
        const index = new Map((table.columns[0] ?? []).map((time, position) => [time, position]));
        table.fields.slice(1).forEach((field, fieldIndex) => {
            const name = prefix ? `${tableIndex + 1} ${field.name}` : field.name;
            fields.push({ name });
            const source = table.columns[fieldIndex + 1] ?? [];
            columns.push(times.map((time) => source[index.get(time) ?? -1] ?? ''));
        });
    });
    return { fields, columns };
}

export function splunkSearchUrl(locale: string, search: string, earliest: string, latest: string): string {
    const params = new URLSearchParams({ q: search, earliest, latest });
    return `/${locale}/app/search/search?${params.toString()}`;
}
