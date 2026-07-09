(function loadPhotoEditorParts() {
    const parts = [
        'parts/photo-editor.part01.chunk',
        'parts/photo-editor.part02.chunk',
    ];

    const source = parts.map((part) => loadText(part)).join('\n');
    (0, eval)(source + '\n//# sourceURL=/client/mobile/components/media-editor/photo-editor.bundle.js');

    function loadText(path) {
        const request = new XMLHttpRequest();
        request.open('GET', path, false);
        request.send(null);
        if (request.status >= 200 && request.status < 300) return request.responseText;
        throw new Error('Failed to load photo editor part: ' + path);
    }
})();
