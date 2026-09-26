// Translation check (run by deploy.bat before publishing anything):
//   - locales/es.json and locales/en.json must have exactly the same keys
//   - every key used in the code/HTML must exist
//   - no text may be empty
//   - functions/locales must be an up-to-date copy of locales/
// Exits with an error so a deploy can't ship a missing translation.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const langs = { es: JSON.parse(read('locales/es.json')), en: JSON.parse(read('locales/en.json')) };
const errors = [];

// 1. Same keys, no empty values
for (const [a, b] of [['es', 'en'], ['en', 'es']]) {
    for (const key of Object.keys(langs[a])) {
        if (!(key in langs[b])) errors.push(`"${key}" exists in ${a}.json but is missing in ${b}.json`);
    }
}
for (const [lang, strings] of Object.entries(langs)) {
    for (const [key, value] of Object.entries(strings)) {
        if (value === '' || value == null) errors.push(`"${key}" is empty in ${lang}.json`);
    }
}

// 2. Every key used exists
const used = new Map(); // key -> file
const scan = (file, patterns) => {
    const text = read(file);
    for (const re of patterns) for (const m of text.matchAll(re)) if (!used.has(m[1])) used.set(m[1], file);
};
const jsCall = /\bt\(\s*['"]([\w]+)['"]/g;
const serverCall = /\btr\(\s*\w+\s*,\s*["']([\w]+)["']/g;
const attr = /data-i18n(?:-placeholder|-title|-aria-label)?="([\w]+)"/g;
scan('admin.js', [jsCall, attr]);
scan('display.js', [jsCall]);
scan('admin.html', [attr]);
scan('index.html', [attr]);
scan('functions/index.js', [serverCall]);
// Keys built dynamically in display.js / admin.js
['statusAvailable', 'statusInConsultation', 'statusDelayed', 'statusNotAvailable'].forEach((k) => used.set(k, 'display.js'));

for (const [key, file] of used) {
    for (const lang of Object.keys(langs)) {
        if (!(key in langs[lang])) errors.push(`${file} uses "${key}" but it is missing in ${lang}.json`);
    }
}

// 3. Server copy in sync
for (const lang of Object.keys(langs)) {
    const copy = path.join(root, 'functions', 'locales', `${lang}.json`);
    if (!fs.existsSync(copy) || fs.readFileSync(copy, 'utf8') !== read(`locales/${lang}.json`)) {
        errors.push(`functions/locales/${lang}.json is out of date: run  node tools/sync-locales.js`);
    }
}

const unused = Object.keys(langs.es).filter((k) => !used.has(k));
if (unused.length) console.log(`(info) ${unused.length} key(s) not referenced directly in code: ${unused.join(', ')}`);

if (errors.length) {
    console.error(`Translation check FAILED:\n  - ${errors.join('\n  - ')}`);
    process.exit(1);
}
console.log(`Translations OK: ${Object.keys(langs.es).length} texts in Spanish and English, ${used.size} used in code.`);
