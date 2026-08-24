/**
 * Apple Emoji Renderer
 * Replaces text emojis with Apple PNG images
 */
(function() {
    // Add favicon to all pages
    const faviconLink = document.querySelector('link[rel="icon"]');
    if (!faviconLink) {
        const link = document.createElement('link');
        link.rel = 'icon';
        link.type = 'image/png';
        link.href = 'https://i.ibb.co/1Y4Pg7BF/94-20260317155000.png';
        document.head.appendChild(link);
    }

    let emojiMap = null;
    let loading = false;
    let pendingCallbacks = [];

    function getEmojiMap(cb) {
        if (emojiMap) return cb(emojiMap);
        pendingCallbacks.push(cb);
        if (loading) return;
        loading = true;

        try {
            const cached = localStorage.getItem('craneapp_apple_emojis');
            if (cached) {
                emojiMap = JSON.parse(cached);
                loading = false;
                pendingCallbacks.forEach(fn => fn(emojiMap));
                pendingCallbacks = [];
                return;
            }
        } catch (_) {}

        const token = localStorage.getItem('craneapp_auth_token');
        if (!token) { loading = false; return; }

        fetch('/api/v2/emojis', { headers: { 'Authorization': 'Bearer ' + token } })
            .then(r => r.json())
            .then(data => {
                emojiMap = {};
                (data.emojis || []).forEach(e => {
                    const cp = parseInt(e.code.replace('U+', ''), 16);
                    if (!isNaN(cp)) emojiMap[cp] = e.img;
                });
                try { localStorage.setItem('craneapp_apple_emojis', JSON.stringify(emojiMap)); } catch (_) {}
                loading = false;
                pendingCallbacks.forEach(fn => fn(emojiMap));
                pendingCallbacks = [];
            })
            .catch(() => { loading = false; });
    }

    const EMOJI_REGEX = /(\p{Emoji_Presentation}|\p{Extended_Pictographic})/gu;

    function getCodePoint(char) {
        return char.codePointAt(0);
    }

    function replaceEmojisInNode(node, map) {
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent;
            EMOJI_REGEX.lastIndex = 0;
            if (!EMOJI_REGEX.test(text)) return;
            EMOJI_REGEX.lastIndex = 0;

            const matches = Array.from(text.matchAll(EMOJI_REGEX));
            const hasReplacement = matches.some(match => {
                const cp = getCodePoint(match[0]);
                return Boolean(map[cp]);
            });
            if (!hasReplacement) return;
            EMOJI_REGEX.lastIndex = 0;

            const frag = document.createDocumentFragment();
            let lastIndex = 0;
            let match;

            while ((match = EMOJI_REGEX.exec(text)) !== null) {
                const emoji = match[0];
                const cp = getCodePoint(emoji);
                const img = map[cp];

                if (match.index > lastIndex) {
                    frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
                }

                if (img) {
                    const el = document.createElement('img');
                    el.src = img;
                    el.alt = emoji;
                    el.className = 'apple-emoji';
                    el.draggable = false;
                    frag.appendChild(el);
                } else {
                    frag.appendChild(document.createTextNode(emoji));
                }

                lastIndex = match.index + emoji.length;
            }

            if (lastIndex < text.length) {
                frag.appendChild(document.createTextNode(text.slice(lastIndex)));
            }

            node.parentNode.replaceChild(frag, node);
        } else if (
            node.nodeType === Node.ELEMENT_NODE &&
            node.tagName !== 'SCRIPT' &&
            node.tagName !== 'STYLE' &&
            node.tagName !== 'INPUT' &&
            node.tagName !== 'TEXTAREA' &&
            node.contentEditable !== 'true' &&
            !node.classList.contains('apple-emoji') &&
            !node.hasAttribute('data-no-emoji')
        ) {
            Array.from(node.childNodes).forEach(child => replaceEmojisInNode(child, map));
        }
    }

    function processNode(node) {
        getEmojiMap(map => replaceEmojisInNode(node, map));
    }

    // ── Contenteditable emoji replacement with cursor restore ──────────────
    function getCaretOffset(el) {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return 0;
        const range = sel.getRangeAt(0).cloneRange();
        range.selectNodeContents(el);
        range.setEnd(sel.getRangeAt(0).endContainer, sel.getRangeAt(0).endOffset);
        return range.toString().length;
    }

    function setCaretOffset(el, offset) {
        const sel = window.getSelection();
        if (!sel) return;
        const range = document.createRange();
        let remaining = offset;
        let found = false;

        function walk(node) {
            if (found) return;
            if (node.nodeType === Node.TEXT_NODE) {
                if (remaining <= node.textContent.length) {
                    range.setStart(node, remaining);
                    range.collapse(true);
                    found = true;
                } else {
                    remaining -= node.textContent.length;
                }
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.tagName === 'IMG') {
                    // apple-emoji img counts as 1 char (the original emoji)
                    if (remaining <= 1) {
                        range.setStartAfter(node);
                        range.collapse(true);
                        found = true;
                    } else {
                        remaining -= 1;
                    }
                } else {
                    for (let i = 0; i < node.childNodes.length; i++) {
                        walk(node.childNodes[i]);
                        if (found) return;
                    }
                }
            }
        }

        walk(el);
        if (!found) {
            range.selectNodeContents(el);
            range.collapse(false);
        }
        sel.removeAllRanges();
        sel.addRange(range);
    }

    function processContentEditable(el) {
        getEmojiMap(map => {
            // Check if there are any emojis to replace first
            const text = el.innerText || '';
            EMOJI_REGEX.lastIndex = 0;
            if (!EMOJI_REGEX.test(text)) return;

            // Save caret position as text offset
            const offset = getCaretOffset(el);

            // Process all text nodes
            Array.from(el.childNodes).forEach(child => replaceEmojisInNode(child, map));

            // Restore caret
            try { setCaretOffset(el, offset); } catch (_) {}

            // Notify page that content changed (e.g. to update send button)
            if (typeof window._updateSendButton === 'function') window._updateSendButton();
        });
    }

    // Debounce helper
    function debounce(fn, ms) {
        let t;
        return function(...args) {
            clearTimeout(t);
            t = setTimeout(() => fn.apply(this, args), ms);
        };
    }

    // Attach to contenteditable inputs
    function attachToContentEditable(el) {
        if (el._appleEmojiAttached) return;
        el._appleEmojiAttached = true;
        const handler = debounce(() => {
            el._appleEmojiProcessing = true;
            processContentEditable(el);
            setTimeout(() => { el._appleEmojiProcessing = false; }, 50);
        }, 150);
        el.addEventListener('input', () => {
            if (!el._appleEmojiProcessing) handler();
        });
    }

    // ── DOM observer ───────────────────────────────────────────────────────
    function startObserver() {
        const observer = new MutationObserver(mutations => {
            mutations.forEach(m => {
                m.addedNodes.forEach(node => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        // Attach to any new contenteditable elements
                        if (node.contentEditable === 'true') attachToContentEditable(node);
                        node.querySelectorAll('[contenteditable="true"]').forEach(attachToContentEditable);
                        // Process static content (non-editable)
                        if (node.contentEditable !== 'true' && !node.closest('[contenteditable="true"]')) {
                            processNode(node);
                        }
                    } else if (node.nodeType === Node.TEXT_NODE) {
                        if (!node.parentElement || node.parentElement.closest('[contenteditable="true"]')) return;
                        processNode(node);
                    }
                });
            });
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    function init() {
        if (!document.body) return;

        // Process existing static content (skip contenteditable areas)
        const allNodes = document.body.querySelectorAll('*:not([contenteditable="true"])');
        // Process body text nodes that are not inside contenteditable
        processNode(document.body);

        // Attach to existing contenteditable elements
        document.querySelectorAll('[contenteditable="true"]').forEach(attachToContentEditable);

        startObserver();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.appleEmoji = { processNode, getEmojiMap, processContentEditable };
})();
