(function () {
    var locale = window.location.pathname.split('/')[1] || 'en-US';
    window.location.replace('/' + locale + '/app/metric_explorer_ng/explorer');
})();
