import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '..');

test('the html view points at the explorer template and bundle', () => {
    const view = fs.readFileSync(
        path.join(root, 'app/default/data/ui/views/explorer.xml'),
        'utf8'
    );
    const template = fs.readFileSync(
        path.join(root, 'app/appserver/templates/explorer.html'),
        'utf8'
    );
    expect(view).toContain('metrics_explorer:/templates/explorer.html');
    expect(template).toContain('/static/app/metrics_explorer/build/explorer.js');
    expect(template).toContain('id="root"');
});
