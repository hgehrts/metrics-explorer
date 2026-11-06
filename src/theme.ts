export type ColorScheme = 'light' | 'dark';

export function readSplunkTheme(payload: unknown): ColorScheme {
    if (!payload || typeof payload !== 'object') {
        return 'light';
    }
    const entry = (payload as { entry?: unknown }).entry;
    if (!Array.isArray(entry) || !entry[0] || typeof entry[0] !== 'object') {
        return 'light';
    }
    const content = (entry[0] as { content?: unknown }).content;
    if (!content || typeof content !== 'object') {
        return 'light';
    }
    const theme = (content as { theme?: unknown }).theme;
    return theme === 'dark' ? 'dark' : 'light';
}
