import { isPercentText, parsePercentile, percentileMethods, resolveEventFunction, resolveMetricFunction } from '../src/spl/functions';

test('reads perc, the short p form, and upperperc with a decimal value', () => {
    expect(parsePercentile('perc99.9')).toEqual({ kind: 'perc', value: '99.9' });
    expect(parsePercentile('p95')).toEqual({ kind: 'perc', value: '95' });
    expect(parsePercentile('upperperc95')).toEqual({ kind: 'upperperc', value: '95' });
    expect(parsePercentile('perc99.999')).toEqual({ kind: 'perc', value: '99.999' });
});

test('rejects percentages outside 0 to below 100 and more than three decimals', () => {
    expect(parsePercentile('perc101')).toBeNull();
    expect(parsePercentile('perc100')).toBeNull();
    expect(parsePercentile('perc1.2345')).toBeNull();
    expect(parsePercentile('perc')).toBeNull();
    expect(parsePercentile('avg')).toBeNull();
    expect(parsePercentile('exactperc95')).toEqual({ kind: 'exactperc', value: '95' });
    expect(parsePercentile('exactperc99.9')).toEqual({ kind: 'exactperc', value: '99.9' });
    expect(isPercentText('0')).toBe(true);
    expect(isPercentText('-1')).toBe(false);
});

test('labels percentiles the way the list shows them', () => {
    expect(resolveMetricFunction('p99.9')?.label).toBe('p99.9');
    expect(resolveMetricFunction('upperperc95')?.label).toBe('upper p95');
    expect(resolveMetricFunction('perc33.5')?.label).toBe('p33.5');
    expect(resolveMetricFunction('exactperc95')).toBeNull();
    expect(resolveEventFunction('exactperc95')?.label).toBe('exact p95');
    expect(percentileMethods('metric')).toEqual(['perc', 'upperperc']);
    expect(percentileMethods('event')).toContain('exactperc');
});
