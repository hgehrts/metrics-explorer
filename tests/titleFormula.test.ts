import { applyTitleParts, chartTitleText, createChart, createSeries, titleLineError } from '../src/model/workspace';
import { parseTitleLine, formulaMetrics, assertEvalExpr } from '../src/spl/titleFormula';

const catalog = ['sc4snmp.IF-MIB.ifInOctets', 'sc4snmp.IF-MIB.ifOutOctets', 'lab.cpu.user'];

test('a comma-separated title is two metric series', () => {
    const parts = parseTitleLine('ifInOctets, ifOutOctets', catalog);
    expect(parts.map((part) => part.metrics[0])).toEqual(['sc4snmp.IF-MIB.ifInOctets', 'sc4snmp.IF-MIB.ifOutOctets']);
    expect(parts.every((part) => part.kind === 'metric')).toBe(true);
});

test('a formula uses catalog names and a safe eval expression', () => {
    const [part] = parseTitleLine('(ifInOctets + ifOutOctets) * 8 AS Gesamt', catalog);
    expect(part.kind).toBe('calc');
    expect(part.label).toBe('Gesamt');
    expect(part.metrics).toEqual(['sc4snmp.IF-MIB.ifInOctets', 'sc4snmp.IF-MIB.ifOutOctets']);
    expect(part.evalExpr).toBe('((m1)+(m2))*(8)');
    expect(part.evalExpr).not.toContain('ifInOctets');
});

test('division becomes a null-safe eval', () => {
    const [part] = parseTitleLine('ifInOctets / ifOutOctets', catalog);
    expect(part.evalExpr).toBe('if((m2)==0,null(),(m1)/(m2))');
    expect(() => assertEvalExpr(part.evalExpr, part.metrics.length)).not.toThrow();
});

test('division by a constant number passes safety check', () => {
    const [part] = parseTitleLine('((ifInOctets + ifOutOctets) * 8) / 100', catalog);
    expect(part.evalExpr).toBe('if((100)==0,null(),(((m1)+(m2))*(8))/(100))');
    expect(() => assertEvalExpr(part.evalExpr, part.metrics.length)).not.toThrow();
});

test('a quoted name and a dash in the catalog stay one metric', () => {
    const names = ['if-in', 'if-out'];
    expect(parseTitleLine('"if-in" - "if-out"', names)[0].metrics).toEqual(['if-in', 'if-out']);
    expect(parseTitleLine('if-in', names)[0].metrics).toEqual(['if-in']);
});

test('unknown metrics and injection attempts are refused', () => {
    expect(() => parseTitleLine('nope', catalog)).toThrow(/Unknown metric/);
    expect(() => parseTitleLine('ifInOctets" | delete', catalog)).toThrow();
    expect(() => parseTitleLine('(ifInOctets + ifOutOctets', catalog)).toThrow('unbalanced parentheses');
});

test('ambiguous short names are refused', () => {
    expect(() => parseTitleLine('octets', ['a.octets', 'b.octets'])).toThrow(/more than one metric/);
});

test('an existing series keeps its filters when the title is a formula', () => {
    const chart = createChart('sc4snmp.IF-MIB.ifInOctets', [{ dimension: 'host', mode: 'include', values: ['a'] }]);
    chart.series.push(createSeries('sc4snmp.IF-MIB.ifOutOctets', [{ dimension: 'host', mode: 'include', values: ['a'] }]));
    chart.series[0].aggregation = 'Rate (Avg)';
    chart.series[1].aggregation = 'Rate (Avg)';
    const parts = parseTitleLine('(ifInOctets + ifOutOctets) * 8 AS Gesamt', catalog);
    expect(titleLineError(chart, parts)).toBe('');
    const next = applyTitleParts(chart, parts);
    expect(next.series).toHaveLength(1);
    expect(next.series[0]).toMatchObject({
        source: 'calc',
        aggregation: 'Rate (Avg)',
        label: 'Gesamt',
        filters: [{ dimension: 'host', mode: 'include', values: ['a'] }],
    });
    expect(chartTitleText(next)).toContain('AS Gesamt');
});

test('a formula with mixed aggregations is refused', () => {
    const chart = createChart('sc4snmp.IF-MIB.ifInOctets');
    chart.series.push(createSeries('sc4snmp.IF-MIB.ifOutOctets'));
    chart.series[0].aggregation = 'Avg';
    chart.series[1].aggregation = 'Max';
    expect(titleLineError(chart, parseTitleLine('ifInOctets + ifOutOctets', catalog))).toBe(
        'A formula needs the same aggregation on every metric.'
    );
});

test('formulaMetrics reads operands from a stored formula', () => {
    expect(formulaMetrics('(sc4snmp.IF-MIB.ifInOctets + sc4snmp.IF-MIB.ifOutOctets) * 8')).toEqual([
        'sc4snmp.IF-MIB.ifInOctets',
        'sc4snmp.IF-MIB.ifOutOctets',
    ]);
});
