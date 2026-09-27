// Checks firestore.rules against the LOCAL emulator (run tools/test-local.bat first).
// Uses the emulator's unsigned test tokens, so no passwords are involved.
const BASE = 'http://127.0.0.1:8080/v1/projects/demo-auna/databases/(default)/documents';

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
function tokenFor(uid) {
    const now = Math.floor(Date.now() / 1000);
    return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
        sub: uid, user_id: uid, iss: 'https://securetoken.google.com/demo-auna', aud: 'demo-auna',
        iat: now, exp: now + 3600, auth_time: now, firebase: { sign_in_provider: 'password' }
    })}.`;
}

async function call(method, path, auth, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth) headers.Authorization = `Bearer ${auth}`;
    const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return res.status;
}

async function query(auth, collection, field, value) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth) headers.Authorization = `Bearer ${auth}`;
    const where = field ? { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value } } } : undefined;
    const res = await fetch(`${BASE}:runQuery`, {
        method: 'POST', headers,
        body: JSON.stringify({ structuredQuery: { from: [{ collectionId: collection }], ...(where ? { where } : {}) } })
    });
    return res.status;
}

const apptBody = (doctorId) => ({ fields: {
    doctorId: { stringValue: doctorId }, patientName: { stringValue: 'Rules Test' },
    start: { stringValue: '2030-01-01T16:00:00.000Z' }, end: { stringValue: '2030-01-01T16:30:00.000Z' }
} });

(async () => {
    const admin = 'owner';
    const doc1 = await (await fetch(`${BASE}/doctors/doc-1`, { headers: { Authorization: 'Bearer owner' } })).json();
    const doc2 = await (await fetch(`${BASE}/doctors/doc-2`, { headers: { Authorization: 'Bearer owner' } })).json();
    const staff = await (await fetch(`${BASE}/staff`, { headers: { Authorization: 'Bearer owner' } })).json();
    const d1 = doc1.fields.authUID.stringValue;
    const d2 = doc2.fields.authUID.stringValue;
    const rec = staff.documents[0].name.split('/').pop();
    const T1 = tokenFor(d1), TR = tokenFor(rec), TX = tokenFor('random-stranger');

    // Make sure the doctor has a calendar link record to read (a fresh emulator has none).
    await call('PATCH', `/calendarFeeds/${d1}`, admin, { fields: { token: { stringValue: 'test-token' } } });

    const checks = [
        ['Public reads the TV board', await query(null, 'board'), 200],
        ['Public reads display settings', await call('GET', '/settings/displayConfig'), 200],
        ['Public CANNOT read doctors', await query(null, 'doctors'), 403],
        ['Public CANNOT read appointments', await query(null, 'appointments'), 403],
        ['Public CANNOT write the board', await call('PATCH', '/board/doc-1?updateMask.fieldPaths=status', null, { fields: { status: { stringValue: 'x' } } }), 403],
        ['Doctor finds own profile (login query)', await query(T1, 'doctors', 'authUID', d1), 200],
        ['Doctor CANNOT read another doctor', await call('GET', '/doctors/doc-2', T1), 403],
        ['Doctor reads own appointments', await query(T1, 'appointments', 'doctorId', d1), 200],
        ['Doctor CANNOT read other appointments', await query(T1, 'appointments', 'doctorId', d2), 403],
        ['Doctor books for self', await call('PATCH', '/appointments/rules-test-1', T1, apptBody(d1)), 200],
        ['Doctor CANNOT book for another doctor', await call('PATCH', '/appointments/rules-test-2', T1, apptBody(d2)), 403],
        ['Doctor CANNOT change their authUID', await call('PATCH', '/doctors/doc-1?updateMask.fieldPaths=authUID', T1, { fields: { authUID: { stringValue: 'hijack' } } }), 403],
        ['Doctor reads own calendar token', await call('GET', `/calendarFeeds/${d1}`, T1), 200],
        ['Doctor CANNOT read another calendar token', await call('GET', `/calendarFeeds/${d2}`, T1), 403],
        ['Reception reads all doctors', await query(TR, 'doctors'), 200],
        ['Reception reads any doctor appointments', await query(TR, 'appointments', 'doctorId', d2), 200],
        ['Reception books for any doctor', await call('PATCH', '/appointments/rules-test-3', TR, apptBody(d2)), 200],
        ['Reception updates doctor status', await call('PATCH', '/doctors/doc-2?updateMask.fieldPaths=status', TR, { fields: { status: { stringValue: 'Available' } } }), 200],
        ['Reception CANNOT read calendar tokens', await call('GET', `/calendarFeeds/${d1}`, TR), 403],
        ['Reception CANNOT edit staff profiles', await call('PATCH', `/staff/${rec}?updateMask.fieldPaths=role`, TR, { fields: { role: { stringValue: 'admin' } } }), 403],
        ['Stranger login CANNOT read doctors', await query(TX, 'doctors'), 403],
        ['Stranger login CANNOT book', await call('PATCH', '/appointments/rules-test-4', TX, apptBody(d1)), 403],
        ['Nobody reads unlisted collections (old WhatsApp logs)', await query(TR, 'whatsappLogs'), 403]
    ];

    // Clean up test appointments
    for (const id of ['rules-test-1', 'rules-test-3']) await call('DELETE', `/appointments/${id}`, admin);

    let failed = 0;
    for (const [name, got, expected] of checks) {
        const ok = got === expected;
        if (!ok) failed++;
        console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (got ${got}, expected ${expected})`);
    }
    console.log(failed ? `\n${failed} check(s) FAILED` : `\nAll ${checks.length} rule checks passed`);
    process.exit(failed ? 1 : 0);
})();
