import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '..');

test('the explorer view is a Splunk dashboard that keeps the platform chrome', () => {
    const view = fs.readFileSync(path.join(root, 'app/default/data/ui/views/explorer.xml'), 'utf8');
    expect(view).toContain('<dashboard');
    expect(view).toContain('id="root"');
    expect(view).toContain('script="build/explorer.js"');
    expect(view).toContain('stylesheet="build/explorer.css"');
    expect(view).not.toContain('hideSplunkBar');
    expect(view).not.toContain('hideAppBar');
    expect(view).not.toContain('hideChrome');
    expect(fs.existsSync(path.join(root, 'app/appserver/templates/explorer.html'))).toBe(false);
});
