export type PanelSpec = {
    title: string;
    search: string;
    earliest: string;
    latest: string;
    /** line, area, or column. A heatmap is stored as a column chart, as in the original workspace. */
    chart: 'line' | 'area' | 'column';
    stacked: boolean;
};

const NAME = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/;

export function dashboardNameError(name: string): string {
    const text = name.trim();
    if (!NAME.test(text)) {
        return 'Use letters, numbers, and . _ : -. Start with a letter or number. No spaces.';
    }
    return '';
}

function xml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function cdata(value: string): string {
    if (value.includes(']]>')) {
        throw new Error('The search cannot be stored.');
    }
    return `<![CDATA[${value}]]>`;
}

function panelXml(panel: PanelSpec): string {
    const stack = panel.stacked ? '\n          <option name="charting.chart.stackMode">stacked</option>' : '';
    return `    <row>
      <panel>
        <title>${xml(panel.title)}</title>
        <chart>
          <search>
            <query>${cdata(panel.search)}</query>
            <earliest>${xml(panel.earliest)}</earliest>
            <latest>${xml(panel.latest)}</latest>
          </search>
          <option name="charting.chart">${panel.chart}</option>${stack}
        </chart>
      </panel>
    </row>`;
}

/** A Classic dashboard. One row per panel. */
export function classicDashboard(label: string, panels: PanelSpec[]): string {
    if (panels.length === 0) {
        throw new Error('Nothing to save.');
    }
    return `<dashboard version="1.1">
  <label>${xml(label)}</label>
${panels.map(panelXml).join('\n')}
</dashboard>
`;
}

/** Inserts panels before the closing tag of a Classic dashboard. Studio dashboards are left unchanged. */
export function appendClassicPanels(xmlText: string, panels: PanelSpec[]): string {
    if (!xmlText.includes('<dashboard') || xmlText.includes('version="2"')) {
        throw new Error('That dashboard is not a Classic dashboard.');
    }
    const close = xmlText.lastIndexOf('</dashboard>');
    if (close < 0) {
        throw new Error('That dashboard is not a Classic dashboard.');
    }
    return `${xmlText.slice(0, close)}${panels.map(panelXml).join('\n')}\n${xmlText.slice(close)}`;
}

function studioViz(panel: PanelSpec, id: string): Record<string, unknown> {
    return {
        type: panel.chart === 'area' ? 'splunk.area' : panel.chart === 'column' ? 'splunk.column' : 'splunk.line',
        title: panel.title,
        dataSources: { primary: `ds_${id}` },
        options: panel.stacked ? { stackMode: 'stacked' } : {},
    };
}

/** A Dashboard Studio definition. Panels sit in a grid, one under the other. */
export function studioDashboard(label: string, panels: PanelSpec[]): string {
    if (panels.length === 0) {
        throw new Error('Nothing to save.');
    }
    const visualizations: Record<string, unknown> = {};
    const dataSources: Record<string, unknown> = {};
    const structure: unknown[] = [];
    panels.forEach((panel, index) => {
        const id = `chart_${index + 1}`;
        visualizations[`viz_${id}`] = studioViz(panel, id);
        dataSources[`ds_${id}`] = {
            type: 'ds.search',
            name: panel.title,
            options: {
                query: panel.search,
                queryParameters: { earliest: panel.earliest, latest: panel.latest },
            },
        };
        structure.push({
            item: `viz_${id}`,
            type: 'block',
            position: { x: 0, y: index * 320, w: 1200, h: 300 },
        });
    });
    const definition = {
        title: label,
        description: '',
        inputs: {},
        defaults: {},
        visualizations,
        dataSources,
        layout: { type: 'absolute', options: { width: 1200, height: Math.max(320, panels.length * 320) }, structure, globalInputs: [] },
    };
    return `<dashboard version="2" theme="light">
  <label>${xml(label)}</label>
  <definition>${cdata(JSON.stringify(definition))}</definition>
</dashboard>
`;
}

export function chartKind(type: string): { chart: PanelSpec['chart']; stacked: boolean } {
    if (type === 'area') {
        return { chart: 'area', stacked: false };
    }
    if (type === 'column' || type === 'stacked' || type === 'heatmap') {
        return { chart: 'column', stacked: type === 'stacked' };
    }
    return { chart: 'line', stacked: false };
}
