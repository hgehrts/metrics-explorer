import { abbreviateMetricName, abbreviateMetricTitle } from '../src/chart/metricLabel';

const LONG = 'spl.intr.disk_objects.BundleReplication.data.searchpeer_ko_bundle_dir_size_bytes';

test('a long metric keeps the first segment and the name after the last dot', () => {
    expect(abbreviateMetricName(LONG)).toBe('spl.<...>.searchpeer_ko_bundle_dir_size_bytes');
});

test('short names stay whole, including three segments', () => {
    expect(abbreviateMetricName('lab.cpu.user')).toBe('lab.cpu.user');
    expect(abbreviateMetricName('lab.net.bytes_total')).toBe('lab.net.bytes_total');
    expect(abbreviateMetricName('splunkd')).toBe('splunkd');
    expect(abbreviateMetricName('a.b')).toBe('a.b');
});

test('an abbreviation that would be longer than the name is not used', () => {
    expect(abbreviateMetricName('a.b.c.dd')).toBe('a.b.c.dd');
    expect(abbreviateMetricName('a..b.c')).toBe('a..b.c');
});

test('each metric in a combined title is shortened on its own', () => {
    expect(abbreviateMetricTitle(`lab.cpu.user, ${LONG}`)).toBe(
        'lab.cpu.user, spl.<...>.searchpeer_ko_bundle_dir_size_bytes'
    );
});
