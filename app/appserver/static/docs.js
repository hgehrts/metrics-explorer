(function () {
    var path = window.location.pathname;
    var search = window.location.search || '';
    var hash = window.location.hash || '';
    var germanLocale = /\/de([-_][A-Za-z]+)?\//.test(path);
    var germanView = /\/documentation_de\/?$/.test(path);
    var englishView = /\/documentation\/?$/.test(path);
    if (germanLocale && englishView) {
        window.location.replace(path.replace(/\/documentation\/?$/, '/documentation_de') + search + hash);
        return;
    }
    if (!germanLocale && germanView) {
        window.location.replace(path.replace(/\/documentation_de\/?$/, '/documentation') + search + hash);
        return;
    }

    if (germanView) {
        var mark = function () {
            var links = document.querySelectorAll('a[data-test="nav-item"]');
            for (var i = 0; i < links.length; i++) {
                var href = links[i].getAttribute('href') || '';
                if (/\/documentation\/?$/.test(href)) {
                    links[i].setAttribute('aria-current', 'page');
                }
            }
        };
        mark();
        window.setTimeout(mark, 500);
    }

    document.addEventListener('click', function (event) {
        var node = event.target;
        while (node && node !== document) {
            if (node.classList && node.classList.contains('mx-hot')) {
                var id = (node.getAttribute('href') || '').replace(/^#/, '');
                var target = id && document.getElementById(id);
                if (target) {
                    event.preventDefault();
                    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
                return;
            }
            node = node.parentNode;
        }
    });

    var locale = path.split('/')[1] || 'en-US';
    var params = new URLSearchParams(search);
    var pageDark = window.__splunk_page_theme__ === 'dark' || window.DASHBOARD_THEME === 'dark';
    var pageLight = window.__splunk_page_theme__ === 'enterprise' || window.DASHBOARD_THEME === 'enterprise' || window.__splunk_page_theme__ === 'light';
    fetch('/' + locale + '/splunkd/__raw/services/authentication/current-context?output_mode=json', { credentials: 'same-origin' })
        .then(function (response) { return response.ok ? response.json() : null; })
        .then(function (payload) {
            var content = payload && payload.entry && payload.entry[0] && payload.entry[0].content;
            var wanted = content && content.theme === 'dark' ? 'dark' : 'enterprise';
            var shown = pageDark ? 'dark' : (pageLight ? 'enterprise' : null);
            if (!content || shown === wanted || params.get('theme') === wanted) {
                return;
            }
            params.set('theme', wanted);
            window.location.replace(path + '?' + params.toString() + hash);
        })
        .catch(function () {});
})();
