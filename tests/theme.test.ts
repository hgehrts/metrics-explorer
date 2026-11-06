import { readSplunkTheme } from '../src/theme';

test('reads a dark Splunk user preference', () => {
    expect(readSplunkTheme({ entry: [{ content: { theme: 'dark' } }] })).toBe('dark');
});

test('falls back to light when the preference is missing or unknown', () => {
    expect(readSplunkTheme(null)).toBe('light');
    expect(readSplunkTheme({ entry: [{ content: { theme: 'enterprise' } }] })).toBe('light');
});
