(function loadI18nParts() {
    const parts = [
        '/client/mobile/scripts/i18n-parts/i18n.part01.chunk',
        '/client/mobile/scripts/i18n-parts/i18n.part02.chunk',
        '/client/mobile/scripts/i18n-parts/i18n.part03.chunk',
        '/client/mobile/scripts/i18n-parts/i18n.part04.chunk',
        '/client/mobile/scripts/i18n-parts/i18n.part05.chunk',
        '/client/mobile/scripts/i18n-parts/i18n.part06.chunk',
    ];

    const source = parts.map((part) => loadText(part)).join('\n');
    try {
        (0, eval)(source + '\n//# sourceURL=/client/mobile/scripts/i18n.bundle.js');
    } catch (e) {
        console.warn('[i18n] eval blocked by CSP, translations unavailable:', e);
    }

    function loadText(path) {
        const request = new XMLHttpRequest();
        request.open('GET', path, false);
        request.send(null);
        if (request.status >= 200 && request.status < 300) return request.responseText;
        throw new Error('Failed to load i18n part: ' + path);
    }
})();
