import { LineTable } from './columns';
import { resolveMetricFunction } from '../spl/functions';

const EPOCH_MIN = 1_000_000_000;
const EPOCH_MAX = 100_000_000_000;

export function formatTimeCell(value: string, locale?: string): string {
    const date = epochDate(value) ?? parsedDate(value);
    return date ? date.toLocaleString(locale) : value;
}

/** latest_time and earliest_time are epoch seconds. Other values stay as returned. */
export function formatStatValue(aggregation: string, value: string, locale?: string): string {
    const name = resolveMetricFunction(aggregation)?.name;
    if (!value || (name !== 'latest_time' && name !== 'earliest_time')) {
        return value;
    }
    const date = epochDate(value);
    return date ? date.toLocaleString(locale) : value;
}

export function formatStatColumns(table: LineTable, aggregation: string, locale?: string): LineTable {
    return {
        fields: table.fields,
        columns: table.columns.map((column, index) =>
            index === 0 ? column : column.map((value) => formatStatValue(aggregation, value, locale))
        ),
    };
}

function epochDate(value: string): Date | null {
    const epoch = Number(value);
    if (!Number.isFinite(epoch) || epoch < EPOCH_MIN || epoch > EPOCH_MAX) {
        return null;
    }
    return new Date(epoch * 1000);
}

function parsedDate(value: string): Date | null {
    if (!value || Number.isFinite(Number(value))) {
        return null;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}
