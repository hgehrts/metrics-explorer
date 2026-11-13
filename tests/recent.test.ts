import { recentName } from '../src/model/recent';
import { menuPlace } from '../src/ui/Menu';

test('a recent name keeps the metric segment after the last dot and the minute', () => {
    expect(recentName('sc4snmp.IF-MIB.ifInOctets', Date.UTC(2026, 10, 13, 8, 15))).toMatch(/^ifInOctets \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(recentName('ubnt:wireless', Date.UTC(2026, 10, 13, 8, 15))).toMatch(/^ubnt:wireless /);
});

test('a menu beside the right edge opens inward', () => {
    const wide = menuPlace({ left: 1200, right: 1280, top: 40, bottom: 64 }, false, { width: 1400, height: 800 }, 320);
    expect(wide.right).toBe(120);
    expect(wide.left).toBeUndefined();
    expect(wide.maxWidth).toBe(1384);
    const room = menuPlace({ left: 20, right: 80, top: 40, bottom: 64 }, false, { width: 1400, height: 800 }, 320);
    expect(room.left).toBe(20);
    expect(room.right).toBeUndefined();
});
