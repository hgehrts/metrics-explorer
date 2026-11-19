import { t } from '../src/i18n';

const GERMAN_PATH = '/de-DE/app/metric_explorer_ng/explorer';

beforeEach(() => {
    window.history.pushState({}, '', GERMAN_PATH);
});

test('validation and chart messages that used to stay English are translated', () => {
    expect(t('Filter field is not allowed.')).toBe('Das Filterfeld ist nicht zulässig.');
    expect(t('Line breaks are not allowed.')).toBe('Zeilenumbrüche sind nicht zulässig.');
    expect(t('Months and years need a relative time range.')).toBe('Monate und Jahre brauchen einen relativen Zeitraum.');
    expect(t('No fields in the preview.')).toBe('Keine Felder in der Vorschau.');
    expect(t('This span draws about {0} points.').replace('{0}', '1200')).toBe('Diese Spanne zeichnet etwa 1200 Punkte.');
    expect(t('A chart stays readable under 1,000.')).toBe('Ein Diagramm bleibt unter 1.000 Punkten lesbar.');
    expect(t('Enter a metric name or a formula.')).toBe('Geben Sie einen Metriknamen oder eine Formel ein.');
    expect(t('A streaming alert can use only one series.')).toBe('Eine Streaming-Benachrichtigung kann nur eine Reihe verwenden.');
    expect(t('. and _')).toBe('. und _');
    expect(t('Then split on')).toBe('Dann unterteilen nach');
    expect(t('Show gaps')).toBe('Lücken anzeigen');
    expect(t('Copyright (c) 2026 Metrics Explorer. All rights reserved.')).toBe(
        'Copyright (c) 2026 Metrics Explorer. Alle Rechte vorbehalten.'
    );
});
