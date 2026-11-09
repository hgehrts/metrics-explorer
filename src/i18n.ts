/** German for the strings this app owns. English is the source. Splunk's locale in the URL picks the language. */
const GERMAN: Record<string, string> = {
    'Save as report': 'Als Bericht speichern',
    'Save as dashboard panel': 'Als Dashboard-Panel speichern',
    'Save all charts': 'Alle Diagramme speichern',
    'Save as base search': 'Als Base Search speichern',
    'Create alert': 'Benachrichtigung erstellen',
    Workspaces: 'Arbeitsbereiche',
    'Base Searches': 'Base Searches',
    Alerts: 'Benachrichtigungen',
    'Show triggered instances': 'Ausgelöste anzeigen',
    'Use a wider span': 'Größere Spanne verwenden',
    'Loading…': 'Wird geladen…',
    'Exact (exactperc)': 'Exakt (exactperc)',
    'Open workspace': 'Arbeitsbereich öffnen',
    'Save workspace': 'Arbeitsbereich speichern',
    Classic: 'Klassisch',
    'Dashboard Studio': 'Dashboard Studio',
    Scheduled: 'Geplant',
    Streaming: 'Streaming',
};

export function t(text: string): string {
    if (typeof window === 'undefined') {
        return text;
    }
    const german = /\/de-[A-Z]{2}\//.test(window.location.pathname);
    return german ? GERMAN[text] ?? text : text;
}
