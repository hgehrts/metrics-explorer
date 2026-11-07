export type ChartType = 'line' | 'area' | 'column';

/** Chart only, the statistics table only, or both. Time aggregations always keep the table. */
export type ChartContent = 'chart' | 'table' | 'both';

export type ChartSettings = {
    type: ChartType;
    content: ChartContent;
    /** Empty means automatic. Otherwise an SPL span such as 30s, 5m, 2h or 1d. */
    span: string;
    yMin: string;
    yMax: string;
    yScale: 'linear' | 'log';
};

export const CHART_TYPES: { id: ChartType; label: string }[] = [
    { id: 'line', label: 'Line chart' },
    { id: 'area', label: 'Area chart' },
    { id: 'column', label: 'Column chart' },
];

export const CHART_CONTENT: { id: ChartContent; label: string }[] = [
    { id: 'chart', label: 'Chart' },
    { id: 'table', label: 'Statistics table' },
    { id: 'both', label: 'Chart and statistics table' },
];

export const SPAN_UNITS: { id: 's' | 'm' | 'h' | 'd'; label: string }[] = [
    { id: 's', label: 'Seconds' },
    { id: 'm', label: 'Minutes' },
    { id: 'h', label: 'Hours' },
    { id: 'd', label: 'Days' },
];

export function defaultSettings(): ChartSettings {
    return { type: 'line', content: 'chart', span: '', yMin: '', yMax: '', yScale: 'linear' };
}

const SUFFIX: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 };

/** Accepts 1000, 1k, 3m, 2.5b and negative numbers. Empty text means automatic. */
export function parseAxisValue(text: string): number | undefined | 'invalid' {
    const trimmed = text.trim().toLowerCase();
    if (trimmed === '') {
        return undefined;
    }
    const match = /^(-?\d+(?:\.\d+)?)([kmb])?$/.exec(trimmed);
    if (!match) {
        return 'invalid';
    }
    return Number(match[1]) * (match[2] ? SUFFIX[match[2]] : 1);
}

export function validateAxis(settings: Pick<ChartSettings, 'yMin' | 'yMax' | 'yScale'>): string {
    const min = parseAxisValue(settings.yMin);
    const max = parseAxisValue(settings.yMax);
    if (min === 'invalid') {
        return 'Min must be a valid number.';
    }
    if (max === 'invalid') {
        return 'Max must be a valid number.';
    }
    if (min !== undefined && max !== undefined && max <= min) {
        return 'Max must be greater than min.';
    }
    if (settings.yScale === 'log' && ((min !== undefined && min <= 0) || (max !== undefined && max <= 0))) {
        return 'A log scale needs values above zero.';
    }
    return '';
}

export function axisOptions(settings: ChartSettings): Record<string, number | string> {
    if (validateAxis(settings)) {
        return { yAxisScale: settings.yScale };
    }
    const options: Record<string, number | string> = { yAxisScale: settings.yScale };
    const min = parseAxisValue(settings.yMin);
    const max = parseAxisValue(settings.yMax);
    if (typeof min === 'number') {
        options.yAxisMin = min;
    }
    if (typeof max === 'number') {
        options.yAxisMax = max;
    }
    return options;
}

export function buildSpan(count: string, unit: string): string | null {
    if (!/^[1-9]\d{0,5}$/.test(count.trim()) || !SPAN_UNITS.some((item) => item.id === unit)) {
        return null;
    }
    return `${count.trim()}${unit}`;
}

export function splitSpan(span: string): { count: string; unit: string } {
    const match = /^(\d+)([smhd])$/.exec(span);
    return match ? { count: match[1], unit: match[2] } : { count: '', unit: 's' };
}
