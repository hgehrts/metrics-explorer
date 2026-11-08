import { rateExplanation } from '../src/spl/functions';
import { parseTimeShift as parseShift, timeShiftToken as token } from '../src/spl/timeShift';

test('parses presets and custom units, and rejects anything else', () => {
    expect(parseShift('60m')).toEqual({ amount: 60, unit: 'm', token: '60m' });
    expect(parseShift('2mon')).toEqual({ amount: 2, unit: 'mon', token: '2mon' });
    expect(parseShift('3w')).toEqual({ amount: 3, unit: 'w', token: '3w' });
    expect(parseShift('60m | delete')).toBeNull();
    expect(parseShift('0h')).toBeNull();
    expect(parseShift('11y')).toBeNull();
    expect(token('90', 'd')).toBe('90d');
    expect(token('1.5', 'h')).toBeNull();
    expect(token('abc', 'h')).toBeNull();
});

test('explains the three rate aggregations and nothing else', () => {
    expect(rateExplanation('rate')).toContain('per-second change of one counter series');
    expect(rateExplanation('rate_avg')).toContain('averages those rates');
    expect(rateExplanation('rate_sum')).toContain('adds those rates');
    expect(rateExplanation('avg')).toBe('');
});
