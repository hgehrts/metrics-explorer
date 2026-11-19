import fs from 'fs';
import path from 'path';
import { APP_GITHUB, APP_LICENSE_URL, APP_VERSION } from '../src/title';

const SEMVER = /^\d+\.\d+\.\d+$/;
const root = path.resolve(__dirname, '..');

test('package, app.conf, and the empty-screen constant share a three-part semver', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string };
    const conf = fs.readFileSync(path.join(root, 'app/default/app.conf'), 'utf8');
    expect(pkg.version).toMatch(SEMVER);
    expect(APP_VERSION).toBe(pkg.version);
    expect(conf).toMatch(new RegExp(`\\[launcher\\][\\s\\S]*?version = ${pkg.version.replace(/\./g, '\\.')}`));
    expect(conf).toMatch(new RegExp(`\\[id\\][\\s\\S]*?version = ${pkg.version.replace(/\./g, '\\.')}`));
    expect(APP_GITHUB).toBe('https://github.com/hgehrts/metrics-explorer');
    expect(APP_LICENSE_URL).toBe('http://www.apache.org/licenses/LICENSE-2.0');
});
