import { t } from '../src/i18n';

const GERMAN_PATH = '/de-DE/app/metrics_explorer/explorer';

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
});
