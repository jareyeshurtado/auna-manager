// Runs the scheduled Cloud Functions once against the LOCAL emulator (they never fire on their
// own there). Start tools/test-local.bat first. No real push notifications are sent.
Object.assign(process.env, {
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
    GCLOUD_PROJECT: 'demo-auna',
    FUNCTIONS_EMULATOR: 'true'
});

const path = require('path');
const fns = require(path.join(__dirname, '..', 'functions', 'index.js'));

(async () => {
    console.log('--- Doctor reminders ---');
    await fns.sendAppointmentReminders.run({});

    console.log('--- Board reconcile ---');
    await fns.reconcileBoard.run({});

    console.log('--- Nightly maintenance ---');
    await fns.dailyMaintenance.run({});

    console.log('Done.');
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
