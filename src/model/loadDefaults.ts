import { DataFilter, pickDefaults } from './dataFilters';
import { HIERARCHY_SEPARATORS } from '../catalog/metricTree';

export type ExplorerSettings = {
    filters: DataFilter[];
    /** Field the data tree is grouped by at start. `metric_name` groups by the metric name. */
    hierarchySource: string;
    hierarchySeparator: string;
    /** Most metric names the catalog lists. Above it the explorer says that not all metrics are listed. */
    maxMetrics: number;
    /** Start of the "Data ingested from" range, one of the range presets. */
    catalogRange: string;
};

/** The presets of both time pickers, as in the original workspace. */
export const RANGE_PRESETS = ['-15m', '-30m', '-60m', '-3h', '-6h', '-12h', '-24h', '-48h', '-7d', '-30d'] as const;

const SAME_AS: Record<string, string> = { '-1h': '-60m', '-1d': '-24h', '-2d': '-48h', '-1w': '-7d' };

/** `earliest` from `[metadata]` as a preset. Values without a preset use the last 24 hours. */
export function catalogRangeFromMetadata(content: Record<string, string | undefined>): string {
    const configured = typeof content.earliest === 'string' ? content.earliest.trim() : '';
    const preset = SAME_AS[configured] ?? configured;
    return (RANGE_PRESETS as readonly string[]).includes(preset) ? preset : '-24h';
}

/** Splunk Web forwards REST calls under this prefix with the signed-in session. No credentials are sent or stored here. */
const SPLUNKD = '/splunkd/__raw';

type Entry = { name?: string; content?: Record<string, unknown> };

async function getEntries(path: string): Promise<Entry[]> {
    const response = await fetch(`${SPLUNKD}${path}`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
        throw new Error(`Splunk answered ${response.status} for ${path}.`);
    }
    const body = (await response.json()) as { entry?: Entry[] };
    return body.entry ?? [];
}

/** Reads `[metadata]` and `[defaults]` for the signed-in user. Failures give the built-in settings, never an error page. */
export async function loadSettings(): Promise<ExplorerSettings> {
    const [context] = await getEntries('/services/authentication/current-context?output_mode=json');
    const roles = Array.isArray(context?.content?.roles) ? (context.content.roles as string[]) : [];
    const entries = await getEntries(
        '/servicesNS/nobody/metrics_explorer/configs/conf-metrics_explorer?output_mode=json&count=0'
    );
    const stanzas = entries
        .filter((entry): entry is Entry & { name: string } => typeof entry.name === 'string')
        .map((entry) => ({
            name: entry.name,
            content: (entry.content ?? {}) as Record<string, string | undefined>,
        }));
    const metadata = stanzas.find((stanza) => stanza.name === 'metadata')?.content ?? {};
    return {
        filters: pickDefaults(stanzas, roles),
        maxMetrics: maxMetricsFromMetadata(metadata),
        catalogRange: catalogRangeFromMetadata(metadata),
        ...hierarchyFromMetadata(metadata),
    };
}

export const DEFAULT_MAX_METRICS = 20000;

/** `max_metrics` from `[metadata]`. Only whole numbers from 1 to 1000000 count, everything else uses the default. */
export function maxMetricsFromMetadata(content: Record<string, string | undefined>): number {
    const configured = typeof content.max_metrics === 'string' ? content.max_metrics.trim() : '';
    if (!/^\d{1,7}$/.test(configured)) {
        return DEFAULT_MAX_METRICS;
    }
    const value = Number(configured);
    return value >= 1 && value <= 1000000 ? value : DEFAULT_MAX_METRICS;
}

/** The grouping settings from `[metadata]`. Anything unknown or invalid falls back to metric names and `.`. */
export function hierarchyFromMetadata(content: Record<string, string | undefined>): Pick<ExplorerSettings, 'hierarchySource' | 'hierarchySeparator'> {
    const configured = typeof content.hierarchy_source === 'string' ? content.hierarchy_source.trim() : '';
    const configuredSeparator = typeof content.hierarchy_separator === 'string' ? content.hierarchy_separator : '';
    return {
        hierarchySource: /^[A-Za-z0-9_.:-]+$/.test(configured) ? configured : 'metric_name',
        hierarchySeparator: (HIERARCHY_SEPARATORS as readonly string[]).includes(configuredSeparator) ? configuredSeparator : '.',
    };
}
