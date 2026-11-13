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
    expect(view).toContain('<label>Metric Explorer NG</label>');
});

test('the app name, icons, dashboards link, and documentation view are packaged', () => {
    const conf = fs.readFileSync(path.join(root, 'app/default/app.conf'), 'utf8');
    expect(conf).toContain('label = Metric Explorer NG');
    expect(conf).toContain('name = metric_explorer_ng');
    const nav = fs.readFileSync(path.join(root, 'app/default/data/ui/nav/default.xml'), 'utf8');
    expect(nav).toContain('<view name="workspaces"/>');
    expect(nav).toContain('<view name="dashboards"/>');
    expect(nav).toContain('<view name="documentation"/>');
    const docs = fs.readFileSync(path.join(root, 'app/default/data/ui/views/documentation.xml'), 'utf8');
    const docsDe = fs.readFileSync(path.join(root, 'app/default/data/ui/views/documentation_de.xml'), 'utf8');
    expect(docs).toContain('<label>Documentation</label>');
    expect(docs).toContain('docs-annotated-en.png');
    expect(docs).not.toContain('docs-annotated-de.png');
    expect(docs).toContain('href="#mx-8"');
    expect(docsDe).toContain('<label>Dokumentation</label>');
    expect(docsDe).toContain('docs-annotated-de.png');
    expect(docsDe).not.toContain('docs-annotated-en.png');
    expect(docsDe).toContain('href="#mx-8"');
    expect(fs.readFileSync(path.join(root, 'app/appserver/static/docs.js'), 'utf8')).toContain('documentation_de');
    expect(conf).toContain('supported_themes = light,dark');
    for (const name of ['appIcon.png', 'appIcon_2x.png', 'appIconAlt.png', 'appIconAlt_2x.png', 'appLogo.png', 'appLogo_2x.png']) {
        expect(fs.existsSync(path.join(root, 'app/static', name))).toBe(true);
    }
    expect(fs.existsSync(path.join(root, 'app/appserver/static/docs-annotated-en.png'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'app/appserver/static/docs-annotated-de.png'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'app/locale/de_DE/LC_MESSAGES/messages.mo'))).toBe(true);
});
