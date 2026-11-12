import { readPageTheme, readSplunkTheme, themeQuery, themeUrl } from '../src/theme';

test('reads a dark Splunk user preference', () => {
    expect(readSplunkTheme({ entry: [{ content: { theme: 'dark' } }] })).toBe('dark');
});

test('falls back to light when the preference is missing or unknown', () => {
    expect(readSplunkTheme(null)).toBe('light');
    expect(readSplunkTheme({ entry: [{ content: { theme: 'enterprise' } }] })).toBe('light');
});

test('reads the theme Splunk put on the page', () => {
    expect(readPageTheme({ __splunk_page_theme__: 'dark' })).toBe('dark');
    expect(readPageTheme({ DASHBOARD_THEME: 'enterprise' })).toBe('light');
    expect(readPageTheme({})).toBeNull();
});

test('asks Splunk to reload when the page theme disagrees with the user', () => {
    expect(themeQuery('dark', 'light')).toBe('dark');
    expect(themeQuery('dark', null)).toBe('dark');
    expect(themeQuery('light', 'dark')).toBe('enterprise');
    expect(themeQuery('dark', 'dark')).toBeNull();
    expect(themeUrl('http://splunk/de-DE/app/metric_explorer_ng/explorer', 'dark')).toBe(
        'http://splunk/de-DE/app/metric_explorer_ng/explorer?theme=dark'
    );
});
