// Copies locales/*.json into functions/locales/ so the Cloud Functions (push notifications,
// calendar feed) use exactly the same texts as the website. Runs automatically before every
// functions deploy (firebase.json "predeploy") and when starting test-local.bat.
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'locales');
const dest = path.join(__dirname, '..', 'functions', 'locales');
fs.mkdirSync(dest, { recursive: true });
for (const file of fs.readdirSync(src).filter((f) => f.endsWith('.json'))) {
    fs.copyFileSync(path.join(src, file), path.join(dest, file));
}
console.log('Locales copied to functions/locales');
