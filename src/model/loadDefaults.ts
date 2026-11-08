import { DataFilter, pickDefaults } from './dataFilters';
import { HIERARCHY_SEPARATORS } from '../catalog/metricTree';

export type ExplorerSettings = {
    filters: DataFilter[];
    /** Field the data tree is grouped by at start. `metric_name` groups by the metric name. */
    hierarchySource: string;
    hierarchySeparator: string;
};

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
        ...hierarchyFromMetadata(metadata),
    };
}

/** The grouping settings from `[metadata]`. Anything unknown or invalid falls back to metric names and `.`. */
export function hierarchyFromMetadata(content: Record<string, string | undefined>): Omit<ExplorerSettings, 'filters'> {
    const configured = typeof content.hierarchy_source === 'string' ? content.hierarchy_source.trim() : '';
    const configuredSeparator = typeof content.hierarchy_separator === 'string' ? content.hierarchy_separator : '';
    return {
        hierarchySource: /^[A-Za-z0-9_.:-]+$/.test(configured) ? configured : 'metric_name',
        hierarchySeparator: (HIERARCHY_SEPARATORS as readonly string[]).includes(configuredSeparator) ? configuredSeparator : '.',
    };
}
