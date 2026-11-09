(function () {
    var locale = window.location.pathname.split('/')[1] || 'en-US';
    window.location.replace('/' + locale + '/app/metrics_explorer/explorer');
})();
