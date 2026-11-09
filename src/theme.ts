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

/** The theme Splunk already chose for this page. `enterprise` is the light theme. */
export function readPageTheme(page: object): ColorScheme | null {
    const record = page as { __splunk_page_theme__?: unknown; DASHBOARD_THEME?: unknown };
    const value = record.__splunk_page_theme__ ?? record.DASHBOARD_THEME;
    if (value === 'dark') {
        return 'dark';
    }
    if (value === 'enterprise' || value === 'light') {
        return 'light';
    }
    return null;
}

/**
 * Splunk only applies a user's dark theme to dashboards that name it.
 * This is the `theme` query that makes the page match the preference, or null when it already does.
 */
export function themeQuery(preference: ColorScheme, page: ColorScheme | null): 'dark' | 'enterprise' | null {
    const wanted = preference === 'dark' ? 'dark' : 'enterprise';
    const shown = page === 'dark' ? 'dark' : 'enterprise';
    return wanted === shown ? null : wanted;
}

export function themeUrl(href: string, theme: 'dark' | 'enterprise'): string {
    const url = new URL(href);
    url.searchParams.set('theme', theme);
    return url.toString();
}
