// Fills the LOCAL Firebase emulator with fake doctors, a receptionist and today's appointments.
// Never runs against production: it only talks to the emulator hosts below (project "demo-auna").
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';

const path = require('path');
const functionsDir = { paths: [path.join(__dirname, '..', 'functions')] };
const admin = require(require.resolve('firebase-admin', functionsDir));
const { FieldValue } = require(require.resolve('firebase-admin/firestore', functionsDir));

admin.initializeApp({ projectId: 'demo-auna' });
const db = admin.firestore();
const auth = admin.auth();

const PASSWORD = 'prueba123';

async function ensureUser(email) {
    try {
        return (await auth.getUserByEmail(email)).uid;
    } catch (e) {
        return (await auth.createUser({ email, password: PASSWORD, emailVerified: true })).uid;
    }
}

// Every day 07:00–22:00 so bookings can be tested whenever you run this.
function openSchedule() {
    const s = {};
    for (let i = 0; i < 7; i++) s[i] = { active: true, slots: [{ start: '07:00', end: '14:00' }, { start: '15:00', end: '22:00' }] };
    return s;
}

// A time today (Mexico City), rounded to the half hour, offset by N minutes from now.
function todayAt(offsetMinutes) {
    const now = Date.now();
    const rounded = Math.floor(now / (30 * 60000)) * 30 * 60000;
    return new Date(rounded + offsetMinutes * 60000);
}

async function main() {
    await db.collection('settings').doc('displayConfig').set({ language: 'ES', card_view: true, cardDisplayTime: 15 });

    const doctor1 = await ensureUser('doctor1@auna.test');
    const doctor2 = await ensureUser('doctor2@auna.test');
    const reception = await ensureUser('recepcion@auna.test');

    await db.collection('staff').doc(reception).set({ role: 'receptionist', name: 'Recepción (prueba)', active: true });

    await db.collection('doctors').doc('doc-1').set({
        authUID: doctor1, displayName: 'Dra. Ana López', specialty: 'Pediatría', officeNumber: '1',
        status: 'Available', displayCurrentAppointment: '---', workingSchedule: openSchedule(), vacations: [],
        notificationSettings: { newAppt: true, cancelAppt: true, reminderEnabled: true, reminderMinutes: 30 }
    });

    // Shared login: two doctors in one account (multipleUsers)
    await db.collection('doctors').doc('doc-2').set({
        authUID: doctor2, multipleUsers: true,
        doctorDisplayOption1: 'Dr. Luis Pérez', specialty1: 'Cardiología',
        doctorDisplayOption2: 'Dra. Sofía Ramos', specialty2: 'Dermatología',
        displayName: 'Dr. Luis Pérez', specialty: 'Cardiología', officeNumber: '2',
        status: 'Available', displayCurrentAppointment: '---', workingSchedule: openSchedule(), vacations: []
    });

    // Doctors without a login, so the TV has two pages to rotate through.
    const extra = [
        ['Dr. Jorge Méndez', 'Ortopedia'], ['Dra. Paola Ruiz', 'Ginecología'], ['Dr. Carlos Vega', 'Medicina Interna'],
        ['Dra. Laura Torres', 'Nutrición'], ['Dr. Andrés Cruz', 'Oftalmología'], ['Dra. Elena Sánchez', 'Psicología'],
        ['Dr. Miguel Ángel Hernández Gutiérrez', 'Otorrinolaringología']
    ];
    for (let i = 0; i < extra.length; i++) {
        const office = String(i + 3);
        await db.collection('doctors').doc(`doc-${office}`).set({
            authUID: `no-login-${office}`, displayName: extra[i][0], specialty: extra[i][1], officeNumber: office,
            status: ['Available', 'Not Available', 'Consultation Delayed'][i % 3], displayCurrentAppointment: '---',
            workingSchedule: openSchedule(), vacations: []
        });
    }

    const appts = [
        { offset: -90, dur: 30, name: 'María González', phone: '3511111111', extra: { confirmed: true } },
        { offset: -30, dur: 30, name: 'José Martínez', phone: '3512222222', extra: {} },
        { offset: 30, dur: 45, name: 'Lucía Fernández', phone: '3513333333', extra: {} },
        { offset: 90, dur: 60, name: 'Pedro Ramírez', phone: '3514444444', extra: { confirmed: true } },
        { offset: 24 * 60, dur: 30, name: 'Carmen Díaz', phone: '3515555555', extra: {} }
    ];
    for (let i = 0; i < appts.length; i++) {
        const a = appts[i];
        const start = todayAt(a.offset);
        const end = new Date(start.getTime() + a.dur * 60000);
        await db.collection('appointments').doc(`seed-${i + 1}`).set({
            doctorId: doctor1, patientName: a.name, patientPhone: a.phone,
            start: start.toISOString(), end: end.toISOString(), status: 'scheduled',
            createdBy: doctor1, createdByRole: 'doctor', createdAt: FieldValue.serverTimestamp(),
            ...a.extra
        });
    }

    console.log('Test data loaded. Logins (password "prueba123"): doctor1@auna.test, doctor2@auna.test, recepcion@auna.test');
    process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
