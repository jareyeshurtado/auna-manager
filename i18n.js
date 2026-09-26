// Shared translations for the admin panel and the TV board.
//
// Texts live in locales/es.json and locales/en.json (one flat "key": "text" file per language).
// The language comes from Firestore: settings/displayConfig.language ("ES" or "EN").
//
// In HTML:  <button data-i18n="saveButton"></button>
//           <input data-i18n-placeholder="loginEmailPlaceholder">
// In JS:    I18N.t('noShowConfirm', { patient: 'Ana' })   ->  "¿Marcar que Ana no asistió?"
//
// tools/check-i18n.js (run by deploy.bat) blocks a deploy if a key is missing in either language.
const I18N = (() => {
    let lang = 'es';
    let strings = {};
    let fallback = {};

    async function fetchLocale(code) {
        // 'no-cache' = always ask the server whether the file changed, so a deploy shows up at once.
        const res = await fetch(`locales/${code}.json`, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`locales/${code}.json: HTTP ${res.status}`);
        return res.json();
    }

    async function load(language) {
        lang = String(language || 'ES').toLowerCase().startsWith('en') ? 'en' : 'es';
        const other = lang === 'es' ? 'en' : 'es';
        const [main, second] = await Promise.allSettled([fetchLocale(lang), fetchLocale(other)]);
        strings = main.status === 'fulfilled' ? main.value : {};
        fallback = second.status === 'fulfilled' ? second.value : {};
        if (main.status === 'rejected') console.error('Could not load translations:', main.reason);
        document.documentElement.lang = lang;
    }

    function t(key, vars) {
        let text = strings[key] ?? fallback[key];
        if (text === undefined) {
            console.warn(`Missing translation: ${key}`);
            return key;
        }
        if (vars && typeof text === 'string') {
            Object.entries(vars).forEach(([k, v]) => { text = text.split(`{${k}}`).join(v); });
        }
        return text;
    }

    function apply(root = document) {
        root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
        root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
        root.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
        root.querySelectorAll('[data-i18n-aria-label]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel)); });
        // Pages start hidden (class "i18n-loading") so nobody sees untranslated text flash by.
        document.documentElement.classList.remove('i18n-loading');
    }

    return {
        load,
        t,
        apply,
        get lang() { return lang; }
    };
})();

// Never leave a page hidden if something goes wrong while loading translations.
setTimeout(() => document.documentElement.classList.remove('i18n-loading'), 4000);
