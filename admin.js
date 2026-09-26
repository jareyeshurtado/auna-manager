// =================================================================
// --- FIREBASE SETUP ---
// =================================================================
const firebaseConfig = {
  apiKey: "AIzaSyCP2k-VJURlMV3-UNPVYMD4q9-wwNjiiQc",
  authDomain: "auna-board.firebaseapp.com",
  projectId: "auna-board",
  storageBucket: "auna-board.firebasestorage.app",
  messagingSenderId: "542600310440",
  appId: "1:542600310440:web:3b33ba175b862dc96a5c9d"
};

// On localhost the app talks to the Firebase Emulator Suite (fake data; see tools/test-local.bat).
const IS_LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
if (IS_LOCAL) firebaseConfig.projectId = 'demo-auna';

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const FieldValue = firebase.firestore.FieldValue;
if (IS_LOCAL) {
    auth.useEmulator('http://127.0.0.1:9099');
    db.useEmulator('127.0.0.1', 8080);
}

// Some browsers (e.g. iPhone Safari outside the installed app) have no push support; calling
// firebase.messaging() there throws, which used to break the whole admin page.
let messaging = null;
try {
    if (firebase.messaging.isSupported()) messaging = firebase.messaging();
} catch (e) { console.warn("Push messaging not supported here:", e); }

const TZ = "America/Mexico_City";
const publicVapidKey = "BCAf8hW_aOvmRB_HC2GU2_G3HhmDS5LMAMDv9P1ruVtyL4HG_0XpNNPRECppOfbHhFB9CWJMtl1lrFwacRW8K8o";
const FUNCTIONS_REGION = "us-central1";

// Appointment lifecycle. A missing status means "scheduled" (older appointments).
const INACTIVE_STATUSES = ['cancelled', 'completed', 'no-show'];
const isActiveAppt = (appt) => !INACTIVE_STATUSES.includes(appt.status);
const DURATIONS = [30, 45, 60, 90];
const SLOT_LOCK_MINUTES = 15;
const APPT_COLORS = {
    scheduled: '#1976d2',
    confirmed: '#2e7d32',
    completed: '#6d4c41',
    cancelled: '#9e9e9e',
    'no-show': '#c62828'
};

// =================================================================
// --- ELEMENT REFERENCES ---
// =================================================================
const $ = (id) => document.getElementById(id);

// Login
const loginContainer = $('login-container');
const loginEmail = $('login-email');
const loginPassword = $('login-password');
const loginButton = $('login-button');
const loginMessage = $('login-message');

// Header / tabs
const adminContent = $('admin-content');
const adminTitleH1 = $('admin-title-h1');
const signOutButton = $('sign-out-button');
const tabButtons = ['tab-status', 'tab-calendar', 'tab-schedule', 'tab-settings'].map($);
const panels = { 'tab-status': $('panel-status'), 'tab-calendar': $('panel-calendar'), 'tab-schedule': $('panel-schedule'), 'tab-settings': $('panel-settings') };

// Status panel
const upcomingList = $('upcoming-appointments-list');
const mainActionButton = $('main-action-button');
const noShowButton = $('no-show-button');
const callAgainButton = $('call-again-button');
const manualStatusButtonsContainer = $('status-buttons');
const manualUpdateButton = $('manual-update-button');

// Settings panel
const multiDoctorContainer = $('multi-doctor-container');
const multiDoctorSelect = $('multi-doctor-select');
const changePasswordButton = $('change-password-button');
const passwordMessage = $('password-message');
const chkNewAppt = $('chk-new-appt');
const chkCancelAppt = $('chk-cancel-appt');
const chkReminderAppt = $('chk-reminder-appt');
const selRemindTime = $('sel-remind-time');
const saveNotifPrefsBtn = $('save-notif-prefs-btn');
const enableNotifBtn = $('enable-notif-btn');
const notifStatus = $('notif-status');
const getSyncLinkBtn = $('get-sync-link-btn');

// Schedule panel
const scheduleContainer = $('schedule-container');
const copyScheduleBtn = $('copy-schedule-btn');
const vacationPicker = $('vacation-date-picker');
const vacationToPicker = $('vacation-date-to');
const addVacationBtn = $('add-vacation-btn');
const vacationList = $('vacation-list');
const saveSettingsBtn = $('save-settings-btn');
const scheduleDirtyHint = $('schedule-dirty-hint');

// Calendar
const calendarEl = $('calendar-container');

// Reception (staff) mode
const staffDoctorBar = $('staff-doctor-bar');
const staffDoctorSelect = $('staff-doctor-select');

// =================================================================
// --- STATE ---
// =================================================================
let i18n = {};
let allTexts = {};
let currentLang = 'EN';

let currentUser = null;
let currentDoctorDocId = null;
// The doctor being managed. For a doctor login this is themselves; for a staff login it is
// whoever is picked in the doctor selector. appointments.doctorId stores the doctor's authUID.
let activeDoctorUid = null;
let currentDoctorData = null;
let currentDoctorStatus = '';
let currentConsultationApptId = null;

let isStaff = false;
let staffProfile = null;
let staffDoctors = [];

let selectedStatus = '';
let selectedAppointment = null;
let todayAppointments = [];
let todayLoaded = false;

let doctorSchedule = {};
let doctorVacations = [];
let scheduleDirty = false;

let calendar = null;
let calendarEvents = [];

// Live listeners (unsubscribe functions) and timers
let staffDoctorsListener = null;
let doctorDocListener = null;
let todayListener = null;
let todayRolloverTimer = null;
let calendarRangeListener = null;
let profileLoadSeq = 0;

// =================================================================
// --- HELPERS ---
// =================================================================
// Translated text with {placeholder} substitution.
function t(key, fallback, vars) {
    let text = i18n.admin?.[key] ?? i18n.global?.[key] ?? fallback ?? key;
    if (vars) Object.entries(vars).forEach(([k, v]) => { text = text.split(`{${k}}`).join(v); });
    return text;
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const mx = (value) => moment.tz(value, TZ);
const todayKey = () => moment.tz(TZ).format('YYYY-MM-DD');

function toast(icon, title, timer = 2000) {
    Swal.fire({ toast: true, position: 'top-end', icon, title, showConfirmButton: false, timer });
}

function getInitials(name) {
    if (!name) return "";
    return name.trim().split(/\s+/).filter(Boolean).map((word) => word[0].toUpperCase()).join('');
}

function statusLabel(status) {
    return {
        'Available': t('statusAvailable', 'Available'),
        'In Consultation': t('statusInConsultation', 'In Consultation'),
        'Consultation Delayed': t('statusDelayed', 'Consultation Delayed'),
        'Not Available': t('statusNotAvailable', 'Not Available')
    }[status] || status || '';
}

// "scheduled" | "confirmed" | "completed" | "cancelled" | "no-show"
function apptVisualStatus(appt) {
    if (appt.status && appt.status !== 'scheduled') return appt.status;
    return appt.confirmed === true ? 'confirmed' : 'scheduled';
}

function apptStatusLabel(visualStatus) {
    return {
        scheduled: t('apptStatusScheduled', 'Scheduled'),
        confirmed: t('apptStatusConfirmed', 'Confirmed'),
        completed: t('apptStatusCompleted', 'Completed'),
        cancelled: t('apptStatusCancelled', 'Cancelled'),
        'no-show': t('apptStatusNoShow', 'No-show')
    }[visualStatus] || visualStatus;
}

function durationLabel(minutes) {
    return { 30: '30 min', 45: '45 min', 60: t('duration60', '1 hour'), 90: t('duration90', '1 h 30 min') }[minutes] || `${minutes} min`;
}

function randomToken() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Accepts "351 123 4567", "+52 351...", "521351..." and returns the 10-digit number (or null).
function normalizePhone(raw) {
    let digits = String(raw || '').replace(/\D/g, '');
    if (digits.length === 13 && digits.startsWith('521')) digits = digits.slice(3);
    if (digits.length === 12 && digits.startsWith('52')) digits = digits.slice(2);
    return digits.length === 10 ? digits : null;
}

class BookingError extends Error {
    constructor(code) { super(code); this.code = code; }
}

// =================================================================
// --- TEXTS ---
// =================================================================
async function initializeAdmin() {
    try {
        const response = await fetch('texts.json');
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        allTexts = await response.json();
    } catch (error) {
        console.error("Error fetching texts.json:", error);
        allTexts = { EN: { admin: {}, global: {} }, ES: { admin: {}, global: {} } };
    }

    try {
        const docSnap = await db.collection("settings").doc("displayConfig").get();
        if (docSnap.exists) currentLang = (docSnap.data().language || "EN").toUpperCase();
    } catch (error) { console.error("Error fetching language setting:", error); }

    i18n = allTexts[currentLang] || allTexts.EN;
    moment.locale(currentLang === 'ES' ? 'es' : 'en');
    document.documentElement.lang = currentLang === 'ES' ? 'es' : 'en';
    applyStaticTextsAdmin();
    setupAuthListener();
}

const STATIC_TEXTS = [
    ['admin-title-h1', 'controlTitle', 'Doctor Status Control'],
    ['login-title-h2', 'loginTitle', 'Login'],
    ['login-button', 'loginButton', 'Login'],
    ['sign-out-button', 'signOutButton', 'Sign Out'],
    ['staff-doctor-label', 'staffDoctorLabel', 'Doctor:'],
    ['tab-status', 'tabStatus', 'Status'],
    ['tab-calendar', 'tabCalendar', 'Calendar'],
    ['tab-schedule', 'tabSchedule', 'Work Schedule'],
    ['tab-settings', 'tabSettings', 'Settings'],
    ['upcoming-label', 'nextAppointmentTitle', 'Select Next Patient'],
    ['manual-status-label', 'setStatusLabel', 'Manual Status Override'],
    ['manual-update-button', 'updateStatusButton', 'Update Status'],
    ['call-again-button', 'callAgainButton', 'Call Again'],
    ['no-show-button', 'noShowButton', 'Mark as no-show'],
    ['calendar-help', 'calendarHelp', 'Click a free time to book. Click an appointment to see details or cancel it.'],
    ['legend-scheduled', 'apptStatusScheduled', 'Scheduled'],
    ['legend-confirmed', 'apptStatusConfirmed', 'Confirmed'],
    ['legend-completed', 'apptStatusCompleted', 'Completed'],
    ['legend-cancelled', 'apptStatusCancelled', 'Cancelled'],
    ['legend-no-show', 'apptStatusNoShow', 'No-show'],
    ['legend-vacation', 'vacationTitleShort', 'Vacation'],
    ['schedule-title', 'scheduleTitle', 'Work Schedule'],
    ['copy-schedule-btn', 'copyToAll', 'Copy Monday to Tuesday–Friday'],
    ['vacation-title', 'vacationTitle', 'Vacations'],
    ['vacation-label', 'vacationFromLabel', 'From:'],
    ['vacation-to-label', 'vacationToLabel', 'To (optional):'],
    ['add-vacation-btn', 'addVacationButton', 'Block'],
    ['save-settings-btn', 'saveSettingsButton', 'Save Settings'],
    ['schedule-dirty-hint', 'scheduleDirtyHint', 'You have unsaved changes.'],
    ['settings-title-h3', 'settingsTitle', 'Settings'],
    ['select-doctor-label', 'selectDoctorLabel', 'Active Doctor Profile:'],
    ['notif-title', 'notifTitle', 'Notifications'],
    ['notif-desc', 'notifDesc', 'Receive instant alerts on this device.'],
    ['enable-notif-btn', 'enableNotifButton', '🔔 Enable push notifications'],
    ['notif-pref-title', 'notifPreferencesTitle', 'Notification Preferences'],
    ['lbl-new-appt', 'notifNewApptLabel', 'New Appointment Alerts'],
    ['lbl-cancel-appt', 'notifCancelLabel', 'Cancellation Alerts'],
    ['lbl-reminder-appt', 'notifReminderLabel', 'Upcoming Reminder'],
    ['lbl-remind-time', 'notifTimeLabel', 'Time before:'],
    ['save-notif-prefs-btn', 'savePreferencesBtn', 'Save'],
    ['sync-title', 'calendarSyncTitle', 'Sync Calendar'],
    ['sync-desc', 'calendarSyncText', 'Subscribe to updates.'],
    ['get-sync-link-btn', 'calendarSyncBtn', 'Get Link'],
    ['change-password-button', 'changePasswordButton', 'Change Password']
];

function applyStaticTextsAdmin() {
    STATIC_TEXTS.forEach(([id, key, fallback]) => {
        const el = $(id);
        if (el) el.textContent = t(key, fallback);
    });
    if (loginEmail) loginEmail.placeholder = t('loginEmailPlaceholder', 'Email');
    if (loginPassword) loginPassword.placeholder = t('loginPasswordPlaceholder', 'Password');

    manualStatusButtonsContainer?.querySelectorAll('button[data-status]').forEach((b) => {
        b.textContent = statusLabel(b.dataset.status);
    });

    if (i18n.admin?.timeOptions) {
        Array.from(selRemindTime.options).forEach((opt) => {
            if (i18n.admin.timeOptions[opt.value]) opt.textContent = i18n.admin.timeOptions[opt.value];
        });
    }
}

// =================================================================
// --- AUTH ---
// =================================================================
function setupAuthListener() {
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            currentUser = user;
            adminContent.style.display = 'block';
            loginContainer.style.display = 'none';

            staffProfile = await loadStaffProfile(user.uid);
            if (staffProfile) {
                startStaffMode();
                return;
            }

            await findDoctorDocumentId(user.uid);
            if (currentDoctorDocId) {
                activeDoctorUid = user.uid;
                watchActiveDoctor();
                loadDoctorProfile();
            } else {
                alert(t('profileLinkError', "Critical Error: Could not link login to a doctor or staff profile."));
                auth.signOut();
            }
        } else {
            stopAllListeners();
            if (calendar) { calendar.destroy(); calendar = null; }
            currentUser = null; currentDoctorDocId = null; activeDoctorUid = null; currentDoctorData = null;
            isStaff = false; staffProfile = null; staffDoctors = [];
            selectedStatus = ''; selectedAppointment = null; currentConsultationApptId = null;
            document.body.classList.remove('staff-mode');
            if (staffDoctorBar) staffDoctorBar.style.display = 'none';
            adminContent.style.display = 'none';
            loginContainer.style.display = 'block';
        }
    });
}

function stopAllListeners() {
    [staffDoctorsListener, doctorDocListener].forEach((unsub) => unsub && unsub());
    staffDoctorsListener = null;
    doctorDocListener = null;
    stopTodayListener();
    stopCalendarRangeListener();
}

async function findDoctorDocumentId(uid) {
    currentDoctorDocId = null;
    if (!uid) return;
    try {
        const doctorQuery = await db.collection("doctors").where("authUID", "==", uid).limit(1).get();
        if (!doctorQuery.empty) currentDoctorDocId = doctorQuery.docs[0].id;
        else console.error(`No doctor document for authUID: ${uid}`);
    } catch (error) { console.error("Error finding doctor document:", error); }
}

function onLoginClick() {
    const email = loginEmail.value.trim();
    const password = loginPassword.value;

    if (!email || !password) {
        loginMessage.textContent = t('loginErrorCredentials', "Please enter both email and password.");
        loginMessage.style.color = '#c91c1c';
        return;
    }

    loginMessage.textContent = t('loginInProgress', "Logging in...");
    loginMessage.style.color = '#333';
    loginButton.disabled = true;

    auth.signInWithEmailAndPassword(email, password)
        .catch((error) => {
            let message = t('loginErrorGeneric', "Could not sign in. Please try again.");
            if (['auth/invalid-credential', 'auth/user-not-found', 'auth/wrong-password', 'auth/invalid-login-credentials'].includes(error.code)) {
                message = t('loginErrorWrong', "The email or password is incorrect.");
            } else if (error.code === 'auth/invalid-email') {
                message = t('loginErrorInvalidEmail', "The email format is not valid.");
            } else if (error.code === 'auth/too-many-requests') {
                message = t('loginErrorTooMany', "Too many failed attempts. Try again later or reset your password.");
            }
            loginMessage.textContent = message;
            loginMessage.style.color = '#c91c1c';
        })
        .finally(() => { loginButton.disabled = false; });
}

async function onSignOutClick() {
    // Stop push notifications to THIS device only; the doctor's other devices keep working.
    // Staff never touch the push tokens of whichever doctor happens to be selected.
    if (currentUser && currentDoctorDocId && !isStaff) {
        let token = localStorage.getItem('fcmToken');
        if (!token && messaging && window.Notification?.permission === 'granted') {
            try { token = await messaging.getToken({ vapidKey: publicVapidKey }); } catch (e) { /* ignore */ }
        }
        if (token) {
            const update = { fcmTokens: FieldValue.arrayRemove(token) };
            if (currentDoctorData?.fcmToken === token) update.fcmToken = FieldValue.delete();
            try { await db.collection('doctors').doc(currentDoctorDocId).update(update); }
            catch (e) { console.error("Could not remove push token:", e); }
        }
    }

    localStorage.removeItem('fcmToken');
    localStorage.removeItem('currentConsultationApptId');
    scheduleDirty = false;

    try { await auth.signOut(); } catch (error) { console.error("Sign Out Error:", error); }
    window.location.reload();
}

function onChangePasswordClick() {
    if (!currentUser) return;
    passwordMessage.textContent = t('sendingResetEmail', 'Sending reset email...');
    passwordMessage.style.color = '#555';
    auth.sendPasswordResetEmail(currentUser.email)
        .then(() => {
            passwordMessage.textContent = t('resetEmailSuccess', 'Check your email inbox for a reset link.');
            passwordMessage.style.color = '#006421';
            setTimeout(() => { passwordMessage.textContent = ''; }, 7000);
        })
        .catch((error) => {
            passwordMessage.textContent = `${t('resetEmailError', 'Error:')} ${error.message}`;
            passwordMessage.style.color = '#c91c1c';
        });
}

// =================================================================
// --- RECEPTION (STAFF) MODE ---
// =================================================================
// A staff account is a normal Firebase Auth user with a document at staff/{uid}
// ({ role: "receptionist", name: "...", active: true }). It can act on every doctor.
async function loadStaffProfile(uid) {
    try {
        const snap = await db.collection('staff').doc(uid).get();
        const data = snap.exists ? snap.data() : null;
        if (data && ['receptionist', 'admin'].includes(data.role) && data.active !== false) {
            return { uid, ...data };
        }
    } catch (error) {
        // Doctors may not be allowed to read the staff collection; that simply means "not staff".
        console.warn("Staff profile not available:", error.code || error);
    }
    return null;
}

function startStaffMode() {
    isStaff = true;
    document.body.classList.add('staff-mode');
    if (adminTitleH1) adminTitleH1.textContent = t('staffTitle', "Reception");
    if (staffDoctorBar) staffDoctorBar.style.display = 'flex';

    if (staffDoctorsListener) staffDoctorsListener();
    staffDoctorsListener = db.collection('doctors').onSnapshot((snapshot) => {
        staffDoctors = [];
        snapshot.forEach((doc) => {
            const data = doc.data();
            // Appointments are keyed by the doctor's login UID, so a profile without one can't be managed.
            if (data.authUID) staffDoctors.push({ id: doc.id, ...data });
        });
        staffDoctors.sort((a, b) =>
            ((parseInt(a.officeNumber) || 9999) - (parseInt(b.officeNumber) || 9999)) ||
            (a.displayName || '').localeCompare(b.displayName || ''));
        renderStaffDoctorOptions();
    }, (error) => {
        console.error("Error loading doctors:", error);
        Swal.fire(t('genericErrorTitle', 'Error'), t('staffLoadError', 'Could not load the doctor list.'), 'error');
    });
}

function staffDoctorOptionLabel(doctor) {
    let name = doctor.displayName || t('unnamedDoctor', 'Doctor');
    if (doctor.multipleUsers === true) {
        const names = Object.keys(doctor)
            .filter((k) => k.startsWith('doctorDisplayOption'))
            .sort((a, b) => (parseInt(a.replace('doctorDisplayOption', '')) || 0) - (parseInt(b.replace('doctorDisplayOption', '')) || 0))
            .map((k) => doctor[k]);
        if (names.length) name = names.join(' / ');
    }
    const status = statusLabel(doctor.status);
    const office = doctor.officeNumber ? ` — ${t('officeLabel', 'Office:')} ${doctor.officeNumber}` : '';
    return `${name}${office}${status ? ' · ' + status : ''}`;
}

function renderStaffDoctorOptions() {
    if (!staffDoctorSelect) return;

    // Status changes fire this listener constantly; only rebuild when the list itself changed,
    // so an open dropdown isn't closed under the receptionist's finger.
    const sameList = staffDoctorSelect.options.length === staffDoctors.length &&
        staffDoctors.every((d, i) => staffDoctorSelect.options[i].value === d.id);
    if (sameList) {
        staffDoctors.forEach((d, i) => { staffDoctorSelect.options[i].textContent = staffDoctorOptionLabel(d); });
    } else {
        staffDoctorSelect.innerHTML = '';
        staffDoctors.forEach((d) => {
            const opt = document.createElement('option');
            opt.value = d.id;
            opt.textContent = staffDoctorOptionLabel(d);
            staffDoctorSelect.appendChild(opt);
        });
    }

    let wanted = currentDoctorDocId;
    if (!wanted) { try { wanted = localStorage.getItem('staffSelectedDoctorId'); } catch (e) { /* ignore */ } }
    if (!staffDoctors.some((d) => d.id === wanted)) wanted = staffDoctors[0]?.id || null;
    if (!wanted) return;

    staffDoctorSelect.value = wanted;
    if (wanted !== currentDoctorDocId) selectStaffDoctor(wanted);
}

function selectStaffDoctor(docId) {
    const doctor = staffDoctors.find((d) => d.id === docId);
    if (!doctor) return;

    currentDoctorDocId = doctor.id;
    activeDoctorUid = doctor.authUID;
    selectedAppointment = null;
    selectedStatus = '';
    manualStatusButtonsContainer?.querySelectorAll('button').forEach((b) => b.classList.remove('selected'));
    try { localStorage.setItem('staffSelectedDoctorId', doctor.id); } catch (e) { /* ignore */ }
    if (adminTitleH1) adminTitleH1.textContent = `${t('staffTitle', 'Reception')} · ${doctor.displayName || ''}`;

    watchActiveDoctor();
    loadDoctorProfile();
}

async function onStaffDoctorChange(e) {
    if (!(await confirmLeaveSchedule())) {
        staffDoctorSelect.value = currentDoctorDocId;
        return;
    }
    selectStaffDoctor(e.target.value);
}

// Keeps the consultation state in sync when the doctor and reception act on the same profile
// from different devices (otherwise one side keeps showing a stale "Start"/"Finish" button).
function watchActiveDoctor() {
    if (doctorDocListener) doctorDocListener();
    const docId = currentDoctorDocId;
    doctorDocListener = db.collection('doctors').doc(docId).onSnapshot((snap) => {
        if (!snap.exists || docId !== currentDoctorDocId) return;
        const data = snap.data();
        currentDoctorData = { ...(currentDoctorData || {}), ...data };
        currentDoctorStatus = data.status || 'Available';
        currentConsultationApptId = resolveConsultationApptId(data);
        renderAppointmentList();
        refreshNotifStatus();
    }, (error) => console.error("Doctor listener error:", error));
}

function resolveConsultationApptId(data) {
    if (data.status !== 'In Consultation') return null;
    if (data.currentAppointmentId) return data.currentAppointmentId;
    // Consultations started before currentAppointmentId existed are only known to this browser.
    if (!isStaff) { try { return localStorage.getItem('currentConsultationApptId'); } catch (e) { /* ignore */ } }
    return null;
}

// =================================================================
// --- DOCTOR PROFILE ---
// =================================================================
async function loadDoctorProfile() {
    if (!currentDoctorDocId) return;
    const loadId = ++profileLoadSeq;

    let data;
    try {
        const docSnap = await db.collection('doctors').doc(currentDoctorDocId).get();
        // Reception may have switched doctor while this was loading; don't paint the old one.
        if (loadId !== profileLoadSeq || !docSnap.exists) return;
        data = docSnap.data();
    } catch (error) {
        console.error("Error fetching doctor:", error);
        Swal.fire(t('genericErrorTitle', 'Error'), t('profileLoadError', 'Could not load the doctor profile.'), 'error');
        return;
    }

    currentDoctorData = data;
    currentDoctorStatus = data.status || 'Available';
    currentConsultationApptId = resolveConsultationApptId(data);
    if (!currentConsultationApptId && !isStaff) localStorage.removeItem('currentConsultationApptId');

    fillSettingsForms(data);
    loadScheduleFrom(data);

    if (data.multipleUsers === true) setupMultiDoctorDropdown(data);
    else if (multiDoctorContainer) multiDoctorContainer.style.display = 'none';

    startTodayListener();

    if (calendar) { calendar.destroy(); calendar = null; }
    stopCalendarRangeListener();
    initializeCalendar(activeDoctorUid);
}

function getDefaultSchedule() {
    const s = {};
    for (let i = 0; i < 7; i++) {
        // 0=Sun, 6=Sat. Default Mon(1)-Fri(5) active
        s[i] = { active: (i > 0 && i < 6), slots: [{ start: "09:00", end: "17:00" }] };
    }
    return s;
}

// Always returns all 7 days with a slots array, whatever shape was stored.
function normalizeSchedule(raw) {
    if (!raw) return getDefaultSchedule();
    const out = {};
    for (let i = 0; i < 7; i++) {
        const day = raw[i];
        out[i] = {
            active: !!day?.active,
            slots: Array.isArray(day?.slots) ? day.slots.map((s) => ({ start: s.start, end: s.end })) : []
        };
    }
    return out;
}

function loadScheduleFrom(data) {
    doctorSchedule = normalizeSchedule(data.workingSchedule);
    // Past vacation days are dropped; they are saved away on the next save.
    const today = todayKey();
    doctorVacations = [...new Set(data.vacations || [])].filter((d) => d >= today).sort();
    setScheduleDirty(false);
    renderScheduleBuilder();
    renderVacationList();
}

// =================================================================
// --- TODAY'S PATIENTS (live) ---
// =================================================================
function stopTodayListener() {
    if (todayListener) todayListener();
    todayListener = null;
    clearTimeout(todayRolloverTimer);
}

function startTodayListener() {
    stopTodayListener();
    const uid = activeDoctorUid;
    if (!uid) return;

    const dayStart = moment.tz(TZ).startOf('day');
    const dayEnd = dayStart.clone().endOf('day');
    todayAppointments = [];
    todayLoaded = false;
    if (upcomingList) upcomingList.innerHTML = `<div class="appointment-item placeholder">${escapeHtml(t('loading', 'Loading...'))}</div>`;

    todayListener = db.collection('appointments')
        .where('doctorId', '==', uid)
        .where('start', '>=', dayStart.toISOString())
        .where('start', '<=', dayEnd.toISOString())
        .orderBy('start', 'asc')
        .onSnapshot((snap) => {
            if (uid !== activeDoctorUid) return;
            todayLoaded = true;
            todayAppointments = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter(isActiveAppt);
            renderAppointmentList();
        }, (error) => {
            console.error("Error loading today's appointments:", error);
            if (upcomingList) upcomingList.innerHTML = `<div class="appointment-item placeholder">${escapeHtml(t('errorLoading', 'Error loading appointments.'))}</div>`;
        });

    // Screens left open overnight roll over to the new day at midnight.
    todayRolloverTimer = setTimeout(startTodayListener, dayEnd.diff(moment()) + 2000);
}

function renderAppointmentList() {
    if (!upcomingList || !todayLoaded) { updateMainActionButtonState(); return; }

    // Patients stay in the list until they are attended, even when the doctor runs late.
    if (selectedAppointment && !todayAppointments.some((a) => a.id === selectedAppointment.id)) selectedAppointment = null;
    upcomingList.innerHTML = '';

    if (todayAppointments.length === 0) {
        upcomingList.innerHTML = `<div class="appointment-item placeholder">${escapeHtml(t('noAppointmentsFound', 'No more appointments for today.'))}</div>`;
        updateMainActionButtonState();
        return;
    }

    const nowIso = new Date().toISOString();
    todayAppointments.forEach((appt) => {
        const isCurrent = appt.id === currentConsultationApptId;
        const el = document.createElement('div');
        el.className = 'appointment-item';
        if (isCurrent) el.classList.add('current');
        if (selectedAppointment?.id === appt.id) {
            el.classList.add('selected');
            selectedAppointment = appt;
        }

        const badges = [];
        if (isCurrent) badges.push(['badge-info', t('badgeInConsultation', 'In consultation')]);
        else if (appt.end < nowIso) badges.push(['badge-warning', t('badgeOverdue', 'Overdue')]);
        if (appt.confirmed === true) badges.push(['badge-success', t('badgeConfirmed', '✅ Confirmed')]);

        el.innerHTML = `
            <h4>${escapeHtml(appt.patientName)} ${badges.map(([cls, text]) => `<span class="badge ${cls}">${escapeHtml(text)}</span>`).join('')}</h4>
            <p class="appt-time">${escapeHtml(mx(appt.start).format('hh:mm A'))} – ${escapeHtml(mx(appt.end).format('hh:mm A'))}</p>
            <p>${escapeHtml(appt.patientPhone || '')}${appt.specificDoctorName ? ' · ' + escapeHtml(appt.specificDoctorName) : ''}</p>`;

        el.addEventListener('click', () => {
            if (isCurrent) return;
            selectedAppointment = selectedAppointment?.id === appt.id ? null : appt;
            renderAppointmentList();
        });
        upcomingList.appendChild(el);
    });
    updateMainActionButtonState();
}

// Refresh "Overdue" badges as time passes.
setInterval(() => { if (currentUser) renderAppointmentList(); }, 60000);

function updateMainActionButtonState() {
    if (!mainActionButton) return;
    const inConsultation = currentDoctorStatus === 'In Consultation';
    if (inConsultation) {
        mainActionButton.textContent = t('finishButton', "Finish Consultation");
        mainActionButton.style.backgroundColor = "#D32F2F";
        mainActionButton.disabled = false;
    } else {
        mainActionButton.textContent = t('startButton', "Start Consultation");
        mainActionButton.style.backgroundColor = "#5C9458";
        mainActionButton.disabled = !selectedAppointment;
    }
    if (callAgainButton) callAgainButton.style.display = inConsultation ? 'block' : 'none';
    if (noShowButton) noShowButton.style.display = (!inConsultation && selectedAppointment) ? 'block' : 'none';
}

// =================================================================
// --- CONSULTATION ACTIONS ---
// =================================================================
async function onMainActionClick() {
    if (!currentDoctorDocId) return;
    mainActionButton.disabled = true;
    try {
        if (currentDoctorStatus === 'In Consultation') await finishConsultation();
        else await startConsultation();
    } finally {
        renderAppointmentList();
    }
}

async function startConsultation() {
    const appt = selectedAppointment;
    const docId = currentDoctorDocId;
    if (!appt) return;
    const displayString = `${getInitials(appt.patientName)} (${mx(appt.start).format('hh:mm A')})`;
    try {
        // currentAppointmentId lives on the doctor doc (not just in this browser) so the
        // consultation can be finished from any device: the doctor's phone, their PC, or reception.
        await db.collection('doctors').doc(docId).update({
            status: "In Consultation",
            displayCurrentAppointment: displayString,
            currentAppointmentId: appt.id
        });
        if (docId === currentDoctorDocId) {
            currentDoctorStatus = "In Consultation";
            currentConsultationApptId = appt.id;
            selectedAppointment = null;
        }
        toast('success', t('consultationStartSuccess', 'Consultation started!'));
    } catch (e) {
        console.error(e);
        Swal.fire(t('bookingErrorTitle', 'Error'), t('consultationStartError', 'Could not start the consultation.'), 'error');
    }
}

async function finishConsultation() {
    const docId = currentDoctorDocId;
    const apptId = currentConsultationApptId;
    try {
        await db.collection('doctors').doc(docId).update({
            status: "Available",
            displayCurrentAppointment: "---",
            currentAppointmentId: FieldValue.delete()
        });
        if (docId === currentDoctorDocId) {
            currentDoctorStatus = "Available";
            currentConsultationApptId = null;
        }
        if (!isStaff) localStorage.removeItem('currentConsultationApptId');
        if (apptId) await markAppointmentCompleted(apptId);
        toast('success', t('finishSuccessTitle', 'Consultation finished'));
    } catch (e) {
        console.error(e);
        Swal.fire(t('bookingErrorTitle', 'Error'), t('finishError', 'Could not finish the consultation.'), 'error');
    }
}

async function markAppointmentCompleted(apptId) {
    try {
        await db.collection('appointments').doc(apptId).update({
            status: 'completed',
            completedAt: FieldValue.serverTimestamp(),
            completedBy: currentUser.uid
        });
    } catch (e) {
        console.warn("Could not mark the appointment completed (it may have been deleted):", e);
    }
}

async function onNoShowClick() {
    const appt = selectedAppointment;
    if (!appt) return;
    const res = await Swal.fire({
        title: t('noShowButton', 'Mark as no-show'),
        text: t('noShowConfirm', 'Mark {patient} as a no-show?', { patient: appt.patientName }),
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: t('continueButton', 'Continue'),
        cancelButtonText: t('cancelButton', 'Cancel')
    });
    if (!res.isConfirmed) return;
    try {
        await db.collection('appointments').doc(appt.id).update({
            status: 'no-show',
            noShowAt: FieldValue.serverTimestamp(),
            noShowBy: currentUser.uid
        });
        selectedAppointment = null;
        toast('success', t('noShowDone', 'Marked as no-show'));
    } catch (e) {
        console.error(e);
        Swal.fire(t('genericErrorTitle', 'Error'), t('saveError', 'Could not save.'), 'error');
    }
}

async function onCallAgainClick() {
    if (!currentDoctorDocId) return;
    callAgainButton.disabled = true;
    try {
        await db.collection('doctors').doc(currentDoctorDocId).update({ callAgainTrigger: Date.now() });
        toast('success', t('callAgainSent', 'Signal sent!'), 1500);
    } catch (e) {
        console.error(e);
        Swal.fire(t('genericErrorTitle', 'Error'), t('callAgainError', 'Could not send the signal.'), 'error');
    } finally {
        setTimeout(() => { callAgainButton.disabled = false; }, 2000);
    }
}

function onManualStatusClick(event) {
    const btn = event.target.closest('button[data-status]');
    if (!btn) return;
    manualStatusButtonsContainer.querySelectorAll('button').forEach((b) => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedStatus = btn.dataset.status;
}

async function onManualUpdateClick() {
    if (!selectedStatus) {
        Swal.fire(t('warningTitle', 'Warning'), t('validationStatus', 'Please select a status first.'), 'warning');
        return;
    }
    const docId = currentDoctorDocId;
    const apptId = currentConsultationApptId;
    const endingConsultation = currentDoctorStatus === 'In Consultation';

    if (endingConsultation) {
        const res = await Swal.fire({
            title: t('warningTitle', 'Warning'),
            text: t('manualEndsConsultation', 'This will finish the current consultation. Continue?'),
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: t('continueButton', 'Continue'),
            cancelButtonText: t('cancelButton', 'Cancel')
        });
        if (!res.isConfirmed) return;
    }

    manualUpdateButton.disabled = true;
    manualUpdateButton.textContent = t('updatingStatusButton', 'Updating...');
    try {
        // Clear the "current patient" so the TV doesn't keep showing someone's initials.
        await db.collection('doctors').doc(docId).update({
            status: selectedStatus,
            displayCurrentAppointment: '---',
            currentAppointmentId: FieldValue.delete()
        });
        if (endingConsultation && apptId) await markAppointmentCompleted(apptId);
        if (docId === currentDoctorDocId) {
            currentDoctorStatus = selectedStatus;
            currentConsultationApptId = null;
        }
        renderAppointmentList();
        toast('success', t('statusUpdateSuccess', 'Status updated!'));
    } catch (e) {
        console.error(e);
        Swal.fire(t('bookingErrorTitle', 'Error'), t('statusUpdateError', 'Could not update status.'), 'error');
    } finally {
        manualUpdateButton.disabled = false;
        manualUpdateButton.textContent = t('updateStatusButton', 'Update Status');
    }
}

// =================================================================
// --- CALENDAR ---
// =================================================================
function scheduleToBusinessHours(schedule) {
    const businessHours = [];
    let minTime = "24:00";
    let maxTime = "00:00";
    for (let i = 0; i < 7; i++) {
        const day = schedule[i];
        if (!day?.active) continue;
        day.slots.forEach((slot) => {
            businessHours.push({ daysOfWeek: [i], startTime: slot.start, endTime: slot.end });
            if (slot.start < minTime) minTime = slot.start;
            if (slot.end > maxTime) maxTime = slot.end;
        });
    }
    if (businessHours.length === 0) { minTime = "08:00"; maxTime = "20:00"; }
    return { businessHours, minTime, maxTime };
}

function stopCalendarRangeListener() {
    if (calendarRangeListener) calendarRangeListener();
    calendarRangeListener = null;
}

function initializeCalendar(uid) {
    if (calendar || !calendarEl || !uid) return;

    const { businessHours, minTime, maxTime } = scheduleToBusinessHours(doctorSchedule);
    const isMobile = window.innerWidth <= 600;
    calendarEvents = vacationBackgroundEvents();

    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: isMobile ? 'timeGridDay' : 'timeGridWeek',
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: isMobile ? 'dayGridMonth,timeGridDay' : 'dayGridMonth,timeGridWeek,timeGridDay'
        },
        height: isMobile ? 'auto' : undefined,
        locale: currentLang === 'ES' ? 'es' : 'en',
        timeZone: TZ,
        businessHours,
        slotMinTime: minTime,
        slotMaxTime: maxTime,
        firstDay: 1,
        nowIndicator: true,
        allDaySlot: false,
        editable: false,
        selectable: false,
        eventSources: [{ id: 'appointments', events: (info, success) => success(calendarEvents) }],
        // Live data for exactly the visible range, so bookings made by reception or the doctor
        // appear immediately on every open screen.
        datesSet: (info) => subscribeCalendarRange(uid, info.startStr, info.endStr),
        dateClick: (info) => onCalendarDateClick(info, uid),
        eventClick: (info) => {
            if (info.event.display !== 'background') showAppointmentDetails(info.event);
        }
    });
    calendar.render();
}

function subscribeCalendarRange(uid, rangeStart, rangeEnd) {
    stopCalendarRangeListener();
    // Starts up to 1 day before the range catch appointments that cross into it.
    const from = mx(rangeStart).subtract(1, 'day').toISOString();
    const to = mx(rangeEnd).toISOString();
    calendarRangeListener = db.collection('appointments')
        .where('doctorId', '==', uid)
        .where('start', '>=', from)
        .where('start', '<', to)
        .onSnapshot((snap) => {
            if (uid !== activeDoctorUid) return;
            calendarEvents = snap.docs.map((d) => toCalendarEvent(d.id, d.data())).concat(vacationBackgroundEvents());
            calendar?.getEventSourceById('appointments')?.refetch();
        }, (error) => console.error("Calendar listener error:", error));
}

function toCalendarEvent(id, appt) {
    const status = apptVisualStatus(appt);
    return {
        id,
        title: (status === 'confirmed' ? '✓ ' : '') + (appt.patientName || ''),
        start: appt.start,
        end: appt.end,
        color: APPT_COLORS[status] || APPT_COLORS.scheduled,
        classNames: [`appt-${status}`],
        extendedProps: { appt: { id, ...appt } }
    };
}

function vacationBackgroundEvents() {
    return doctorVacations.map((d) => ({
        start: `${d}T00:00:00`,
        end: mx(d).add(1, 'day').format('YYYY-MM-DD[T]00:00:00'),
        display: 'background',
        color: '#ff9f89'
    }));
}

async function onCalendarDateClick(info, uid) {
    // In month view a click zooms into that day instead of booking.
    if (info.view.type === 'dayGridMonth') {
        calendar.changeView('timeGridDay', info.dateStr);
        return;
    }

    // Everything is evaluated in Mexico City time, regardless of the device's time zone.
    const start = mx(info.dateStr);
    const dateKey = start.format('YYYY-MM-DD');

    if (doctorVacations.includes(dateKey)) {
        Swal.fire(t('vacationTitleShort', 'Vacation'), t('vacationBlocked', "Doctor is on vacation."), 'warning');
        return;
    }

    const dayConfig = doctorSchedule[start.day()];
    if (!dayConfig?.active) {
        Swal.fire(t('offDayTitle', 'Day off'), t('nonWorkingTimeError', "Doctor is not working."), 'warning');
        return;
    }

    const hhmm = start.format('HH:mm');
    const slot = dayConfig.slots.find((s) => hhmm >= s.start && hhmm < s.end);
    if (!slot) {
        Swal.fire(t('closedTitle', 'Outside working hours'), t('nonWorkingTimeError', "Doctor is not working at this time."), 'warning');
        return;
    }
    const maxMinutes = mx(`${dateKey}T${slot.end}`).diff(start, 'minutes');

    if (start.isBefore(moment().subtract(15, 'minutes'))) {
        const res = await Swal.fire({
            title: t('pastTimeTitle', 'Time already passed'),
            text: t('pastTimeText', 'The selected time is in the past. Book anyway?'),
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: t('continueButton', 'Continue'),
            cancelButtonText: t('cancelButton', 'Cancel')
        });
        if (!res.isConfirmed) return;
    }

    promptBooking(start, uid, maxMinutes);
}

function promptBooking(start, uid, maxMinutes) {
    if (!DURATIONS.some((d) => d <= maxMinutes)) {
        Swal.fire(t('closedTitle', 'Outside working hours'), t('durationTooLong', 'No appointment length fits before the end of working hours.'), 'warning');
        return;
    }

    let doctorButtonsHtml = '';
    if (multiDoctorContainer && multiDoctorContainer.style.display !== 'none' && multiDoctorSelect.options.length > 0) {
        const buttons = Array.from(multiDoctorSelect.options).map((opt) =>
            `<button type="button" class="swal2-confirm swal2-styled doctor-button" data-doctor="${escapeHtml(opt.value)}">${escapeHtml(opt.textContent)}</button>`
        ).join('');
        doctorButtonsHtml = `
            <span class="swal2-label" style="margin-top: 10px;">${escapeHtml(t('specificDoctorLabel', 'Doctor:'))}</span>
            <div id="swal-doctor-buttons">${buttons}</div>`;
    }

    const durationButtons = DURATIONS.map((d) => d <= maxMinutes
        ? `<button type="button" class="swal2-confirm swal2-styled duration-button" data-duration="${d}">${escapeHtml(durationLabel(d))}</button>`
        : `<button type="button" class="swal2-confirm swal2-styled duration-button" data-duration="${d}" disabled title="${escapeHtml(t('durationTooLongShort', 'Ends after working hours'))}">${escapeHtml(durationLabel(d))}</button>`
    ).join('');

    Swal.fire({
        title: t('bookAppointmentTitle', 'Book Appointment at {time}', { time: start.format('hh:mm A') }),
        width: '600px',
        html: `<div>
            <p class="swal-subtitle">${escapeHtml(start.format('dddd D MMMM YYYY'))}</p>
            <span class="swal2-label">${escapeHtml(t('patientNameLabel', 'Patient Name:'))}</span>
            <input id="swal-input-name" class="swal2-input" autocomplete="off" maxlength="80" placeholder="${escapeHtml(t('patientNamePlaceholder', ''))}">
            <span class="swal2-label">${escapeHtml(t('phoneLabel', 'Phone:'))}</span>
            <input id="swal-input-phone" class="swal2-input" type="tel" inputmode="numeric" autocomplete="off" placeholder="${escapeHtml(t('phonePlaceholder', ''))}">
            ${doctorButtonsHtml}
            <span class="swal2-label" style="margin-top: 10px;">${escapeHtml(t('durationLabel', 'Duration:'))}</span>
            <div id="swal-duration-buttons">${durationButtons}</div>
        </div>`,
        showCancelButton: true,
        confirmButtonText: t('bookButton', 'Book'),
        cancelButtonText: t('cancelButton', 'Cancel'),
        focusConfirm: false,
        showLoaderOnConfirm: true,
        allowOutsideClick: () => !Swal.isLoading(),
        didOpen: () => {
            wireChoiceButtons('#swal-duration-buttons', '.duration-button', 'selectedDuration', 'duration');
            wireChoiceButtons('#swal-doctor-buttons', '.doctor-button', 'selectedDoctor', 'doctor');
            $('swal-input-name')?.focus();
        },
        preConfirm: async () => {
            const name = $('swal-input-name').value.trim().replace(/\s+/g, ' ');
            const rawPhone = $('swal-input-phone').value;
            const phone = normalizePhone(rawPhone);
            const duration = parseInt($('swal-duration-buttons').dataset.selectedDuration);
            const specificDoctor = $('swal-doctor-buttons')?.dataset.selectedDoctor || null;

            if (name.length < 2) { Swal.showValidationMessage(t('validationName', "Please enter the patient's name")); return false; }
            if (!rawPhone.trim()) { Swal.showValidationMessage(t('validationPhone', "Please enter the patient's phone number")); return false; }
            if (!phone) { Swal.showValidationMessage(t('validationPhoneDigits', "Phone number must be exactly 10 digits")); return false; }
            if (!duration) { Swal.showValidationMessage(t('validationDuration', "Please select an appointment duration")); return false; }

            try {
                await bookAppointment({ uid, start, end: start.clone().add(duration, 'minutes'), name, phone, specificDoctor });
                return true;
            } catch (e) {
                console.error("Booking failed:", e);
                Swal.showValidationMessage(e.code === 'overlap'
                    ? t('overlapErrorText', "This time slot overlaps with an existing appointment.")
                    : t('bookingErrorText', "Could not create appointment. Please try again."));
                return false;
            }
        }
    }).then((res) => {
        if (res.isConfirmed) toast('success', t('bookingSuccessText', 'Appointment booked.'));
    });
}

// Makes a row of buttons behave like radio buttons; the choice is stored on the container.
function wireChoiceButtons(containerSelector, buttonSelector, dataKey, valueKey) {
    const container = document.querySelector(containerSelector);
    if (!container) return;
    const buttons = container.querySelectorAll(buttonSelector);
    buttons.forEach((btn) => btn.addEventListener('click', () => {
        buttons.forEach((b) => b.classList.remove('selected-swal-btn'));
        btn.classList.add('selected-swal-btn');
        container.dataset[dataKey] = btn.dataset[valueKey];
    }));
    const first = Array.from(buttons).find((b) => !b.disabled);
    if (first) first.click();
}

// One lock document per 15-minute block, keyed by doctor + UTC time, e.g. "uid_20260925T1600".
function slotLockIds(uid, start, end) {
    const ids = [];
    const cursor = start.clone().utc().startOf('minute');
    cursor.minutes(Math.floor(cursor.minutes() / SLOT_LOCK_MINUTES) * SLOT_LOCK_MINUTES);
    for (; cursor.isBefore(end); cursor.add(SLOT_LOCK_MINUTES, 'minutes')) {
        ids.push(`${uid}_${cursor.format('YYYYMMDD[T]HHmm')}`);
    }
    return ids;
}

async function bookAppointment({ uid, start, end, name, phone, specificDoctor }) {
    const startIso = start.toISOString();
    const endIso = end.toISOString();

    // 1. Appointments created before slot locks existed have no locks: check them by query.
    //    (Same doctorId+start index as the rest of the app; a failure blocks the booking.)
    const existing = await db.collection('appointments')
        .where('doctorId', '==', uid)
        .where('start', '>=', start.clone().subtract(1, 'day').toISOString())
        .where('start', '<', endIso)
        .get();
    if (existing.docs.some((d) => isActiveAppt(d.data()) && d.data().end > startIso)) throw new BookingError('overlap');

    // 2. Atomic: claim every 15-minute block. If the doctor and reception book the same
    //    time at the same moment, only one transaction can win.
    const apptRef = db.collection('appointments').doc();
    const lockIds = slotLockIds(uid, start, end);
    const lockRefs = lockIds.map((id) => db.collection('slotLocks').doc(id));

    await db.runTransaction(async (tx) => {
        const lockSnaps = await Promise.all(lockRefs.map((r) => tx.get(r)));
        for (const snap of lockSnaps) {
            if (!snap.exists) continue;
            // A lock left behind by a cancelled/deleted appointment doesn't block the slot.
            const holder = await tx.get(db.collection('appointments').doc(snap.data().apptId));
            if (holder.exists && isActiveAppt(holder.data())) throw new BookingError('overlap');
        }
        lockRefs.forEach((r) => tx.set(r, { doctorId: uid, apptId: apptRef.id, start: startIso }));

        const data = {
            doctorId: uid,
            patientName: name,
            patientPhone: phone,
            start: startIso,
            end: endIso,
            status: 'scheduled',
            lockIds,
            // Audit trail: who booked it (the doctor or reception)
            createdBy: currentUser.uid,
            createdByRole: isStaff ? 'staff' : 'doctor',
            createdByName: staffProfile?.name || currentUser.email || '',
            createdAt: FieldValue.serverTimestamp()
        };
        if (specificDoctor) data.specificDoctorName = specificDoctor;
        tx.set(apptRef, data);
    });
}

async function showAppointmentDetails(event) {
    const appt = event.extendedProps.appt;
    if (!appt) return;
    const status = apptVisualStatus(appt);

    const rows = [
        [t('detailPatient', 'Patient'), appt.patientName],
        [t('detailPhone', 'Phone'), appt.patientPhone || '—'],
        [t('detailWhen', 'When'), `${mx(appt.start).format('dddd D MMM YYYY')}, ${mx(appt.start).format('hh:mm A')} – ${mx(appt.end).format('hh:mm A')}`],
        [t('detailStatus', 'Status'), apptStatusLabel(status)]
    ];
    if (appt.specificDoctorName) rows.push([t('detailDoctor', 'Doctor'), appt.specificDoctorName]);
    if (appt.createdByRole) rows.push([t('detailBookedBy', 'Booked by'), appt.createdByRole === 'staff' ? t('createdByStaff', 'Reception') : t('createdByDoctor', 'Doctor')]);
    if (appt.cancelReason) rows.push([t('detailReason', 'Reason'), appt.cancelReason]);

    // Confirming, cancelling and deleting are done by hand (reception or the doctor).
    const active = isActiveAppt(appt);
    const actions = [];
    if (active && appt.confirmed !== true) actions.push(['confirm', 'act-confirm', t('confirmApptButton', '✅ Mark as confirmed')]);
    if (active && appt.confirmed === true) actions.push(['unconfirm', 'act-unconfirm', t('unconfirmApptButton', 'Remove confirmation')]);
    if (active) actions.push(['cancel', 'act-cancel', t('cancelApptButton', 'Cancel appointment')]);
    actions.push(['delete', 'act-delete', t('deleteForeverButton', 'Delete permanently')]);

    let chosen = null;
    await Swal.fire({
        title: t('apptDetailsTitle', 'Appointment details'),
        html: `<table class="appt-details">${rows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join('')}</table>
            <div class="appt-actions">${actions.map(([key, cls, label]) => `<button type="button" class="${cls}" data-action="${key}">${escapeHtml(label)}</button>`).join('')}</div>`,
        showConfirmButton: false,
        showCloseButton: true,
        didOpen: (popup) => {
            popup.querySelectorAll('.appt-actions button').forEach((btn) => btn.addEventListener('click', () => {
                chosen = btn.dataset.action;
                Swal.close();
            }));
        }
    });

    if (chosen === 'confirm') setAppointmentConfirmed(appt, true);
    else if (chosen === 'unconfirm') setAppointmentConfirmed(appt, false);
    else if (chosen === 'cancel') promptCancelAppointment(appt);
    else if (chosen === 'delete') confirmDeleteAppointment(appt);
}

async function setAppointmentConfirmed(appt, confirmed) {
    try {
        await db.collection('appointments').doc(appt.id).update(confirmed
            ? { confirmed: true, confirmedAt: FieldValue.serverTimestamp(), confirmedBy: currentUser.uid }
            : { confirmed: false, confirmedAt: FieldValue.delete(), confirmedBy: FieldValue.delete() });
        toast('success', confirmed ? t('apptConfirmed', 'Appointment confirmed') : t('apptUnconfirmed', 'Confirmation removed'));
    } catch (e) {
        console.error(e);
        Swal.fire(t('genericErrorTitle', 'Error'), t('saveError', 'Could not save.'), 'error');
    }
}

async function promptCancelAppointment(appt) {
    const res = await Swal.fire({
        title: t('cancelReasonTitle', 'Cancel appointment'),
        text: `${appt.patientName} — ${mx(appt.start).format('D MMM, hh:mm A')}`,
        input: 'text',
        inputPlaceholder: t('cancelReasonPlaceholder', 'Reason (optional)'),
        inputAttributes: { maxlength: 200 },
        showCancelButton: true,
        confirmButtonText: t('cancelConfirmButton', 'Yes, cancel it'),
        confirmButtonColor: '#d33',
        cancelButtonText: t('closeButton', 'Close'),
        showLoaderOnConfirm: true,
        preConfirm: async (reason) => {
            try {
                await cancelAppointment(appt.id, (reason || '').trim());
                return true;
            } catch (e) {
                console.error(e);
                Swal.showValidationMessage(t('saveError', 'Could not save.'));
                return false;
            }
        }
    });
    if (res.isConfirmed) toast('success', t('apptCancelled', 'Appointment cancelled'));
}

// Cancelling keeps the record (who, when, why) and frees the time for new bookings.
async function cancelAppointment(apptId, reason) {
    const ref = db.collection('appointments').doc(apptId);
    await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error('not-found');
        const lockIds = snap.data().lockIds || [];
        const lockSnaps = await Promise.all(lockIds.map((id) => tx.get(db.collection('slotLocks').doc(id))));

        const update = {
            status: 'cancelled',
            cancelledAt: FieldValue.serverTimestamp(),
            cancelledBy: currentUser.uid,
            cancelledByRole: isStaff ? 'staff' : 'doctor',
            cancelledVia: 'app'
        };
        if (reason) update.cancelReason = reason;
        tx.update(ref, update);
        lockSnaps.forEach((s) => { if (s.exists && s.data().apptId === apptId) tx.delete(s.ref); });
    });
}

async function confirmDeleteAppointment(appt) {
    const res = await Swal.fire({
        title: t('deleteConfirmTitle', 'Delete Appointment?'),
        text: t('deleteConfirmText', "Delete the appointment for '{patient}'?", { patient: appt.patientName }),
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: t('deleteButton', 'Yes, delete it!'),
        confirmButtonColor: '#d33',
        cancelButtonText: t('cancelButton', 'Cancel')
    });
    if (!res.isConfirmed) return;
    try {
        await db.collection('appointments').doc(appt.id).delete();
        toast('success', t('deleteSuccessTitle', 'Deleted!'));
    } catch (e) {
        console.error(e);
        Swal.fire(t('genericErrorTitle', 'Error'), t('deleteErrorText', 'Could not delete appointment.'), 'error');
    }
}

// =================================================================
// --- WORK SCHEDULE & VACATIONS ---
// =================================================================
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first, like the calendar

function dayNames() {
    return i18n.admin?.days || ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
}

function setScheduleDirty(dirty) {
    scheduleDirty = dirty;
    if (scheduleDirtyHint) scheduleDirtyHint.style.display = dirty ? 'block' : 'none';
}

function renderScheduleBuilder() {
    if (!scheduleContainer) return;
    scheduleContainer.innerHTML = '';
    const days = dayNames();

    WEEK_ORDER.forEach((i) => {
        const dayData = doctorSchedule[i];
        const row = document.createElement('div');
        row.className = 'schedule-day';

        const header = document.createElement('label');
        header.className = 'schedule-day-header';
        const check = document.createElement('input');
        check.type = 'checkbox';
        check.checked = dayData.active;
        check.onchange = (e) => {
            dayData.active = e.target.checked;
            if (dayData.active && dayData.slots.length === 0) dayData.slots.push({ start: "09:00", end: "17:00" });
            setScheduleDirty(true);
            renderScheduleBuilder();
        };
        const label = document.createElement('span');
        label.textContent = days[i];
        if (!dayData.active) label.className = 'inactive';
        header.append(check, label);
        row.appendChild(header);

        if (dayData.active) {
            const slotsContainer = document.createElement('div');
            slotsContainer.className = 'schedule-slots';

            dayData.slots.forEach((slot, index) => {
                const slotRow = document.createElement('div');
                slotRow.className = 'schedule-slot';
                if (!slot.start || !slot.end || slot.start >= slot.end) slotRow.classList.add('invalid');

                const makeTimeInput = (field) => {
                    const input = document.createElement('input');
                    input.type = 'time';
                    input.step = 900; // 15 minutes
                    input.value = slot[field];
                    input.onchange = (e) => {
                        slot[field] = e.target.value;
                        setScheduleDirty(true);
                        slotRow.classList.toggle('invalid', !slot.start || !slot.end || slot.start >= slot.end);
                    };
                    return input;
                };

                const delBtn = document.createElement('button');
                delBtn.type = 'button';
                delBtn.className = 'slot-delete';
                delBtn.textContent = '×';
                delBtn.setAttribute('aria-label', t('removeSlot', 'Remove hours'));
                delBtn.onclick = () => {
                    dayData.slots.splice(index, 1);
                    setScheduleDirty(true);
                    renderScheduleBuilder();
                };

                slotRow.append(makeTimeInput('start'), document.createTextNode('–'), makeTimeInput('end'), delBtn);
                slotsContainer.appendChild(slotRow);
            });

            const addBtn = document.createElement('button');
            addBtn.type = 'button';
            addBtn.textContent = t('addSlot', "+ Add Hours");
            addBtn.className = "secondary-button small-button";
            addBtn.onclick = () => {
                const last = dayData.slots[dayData.slots.length - 1];
                dayData.slots.push(last ? { start: last.end, end: last.end < "20:00" ? "20:00" : "23:59" } : { start: "09:00", end: "13:00" });
                setScheduleDirty(true);
                renderScheduleBuilder();
            };
            slotsContainer.appendChild(addBtn);
            row.appendChild(slotsContainer);
        }
        scheduleContainer.appendChild(row);
    });
}

// Returns an error message, or null when the schedule is valid. Sorts each day's slots.
function validateSchedule() {
    const days = dayNames();
    for (let i = 0; i < 7; i++) {
        const day = doctorSchedule[i];
        if (!day.active) continue;
        day.slots.sort((a, b) => (a.start || '').localeCompare(b.start || ''));
        for (const s of day.slots) {
            if (!s.start || !s.end || s.start >= s.end) {
                return t('scheduleInvalidEnd', '{day}: the end time must be after the start time.', { day: days[i] });
            }
        }
        for (let k = 1; k < day.slots.length; k++) {
            if (day.slots[k].start < day.slots[k - 1].end) {
                return t('scheduleOverlap', '{day}: some hours overlap.', { day: days[i] });
            }
        }
    }
    return null;
}

function groupVacationRanges(dates) {
    const groups = [];
    [...dates].sort().forEach((d) => {
        const last = groups[groups.length - 1];
        if (last && mx(last.end).add(1, 'day').format('YYYY-MM-DD') === d) {
            last.end = d;
            last.dates.push(d);
        } else {
            groups.push({ start: d, end: d, dates: [d] });
        }
    });
    return groups;
}

function renderVacationList() {
    if (!vacationList) return;
    vacationList.innerHTML = '';
    if (doctorVacations.length === 0) {
        vacationList.innerHTML = `<span class="muted">${escapeHtml(t('noVacations', 'No blocked days'))}</span>`;
        return;
    }

    groupVacationRanges(doctorVacations).forEach((group) => {
        const chip = document.createElement('div');
        chip.className = 'vacation-chip';
        const text = document.createElement('span');
        text.textContent = group.start === group.end
            ? mx(group.start).format('ddd D MMM YYYY')
            : `${mx(group.start).format('D MMM')} – ${mx(group.end).format('D MMM YYYY')}`;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = '×';
        remove.setAttribute('aria-label', t('removeVacation', 'Remove'));
        remove.onclick = () => {
            doctorVacations = doctorVacations.filter((d) => !group.dates.includes(d));
            setScheduleDirty(true);
            renderVacationList();
        };
        chip.append(text, remove);
        vacationList.appendChild(chip);
    });
}

function onAddVacationClick() {
    const from = vacationPicker.value;
    const to = vacationToPicker?.value || from;
    if (!from) return;
    if (to < from) {
        Swal.fire(t('warningTitle', 'Warning'), t('vacationRangeInvalid', 'The end date must be on or after the start date.'), 'warning');
        return;
    }
    if (mx(to).diff(mx(from), 'days') > 180) {
        Swal.fire(t('warningTitle', 'Warning'), t('vacationRangeTooLong', 'The maximum range is 180 days.'), 'warning');
        return;
    }
    const today = todayKey();
    for (let d = mx(from); d.format('YYYY-MM-DD') <= to; d.add(1, 'day')) {
        const key = d.format('YYYY-MM-DD');
        if (key >= today && !doctorVacations.includes(key)) doctorVacations.push(key);
    }
    doctorVacations.sort();
    vacationPicker.value = '';
    if (vacationToPicker) vacationToPicker.value = '';
    setScheduleDirty(true);
    renderVacationList();
}

function onCopyMondayClick() {
    const monday = doctorSchedule[1];
    for (let i = 2; i <= 5; i++) doctorSchedule[i] = JSON.parse(JSON.stringify(monday));
    setScheduleDirty(true);
    renderScheduleBuilder();
    toast('success', t('copiedToast', 'Copied!'), 1000);
}

// Saves schedule + vacations. Returns true on success.
async function saveSchedule() {
    if (!currentDoctorDocId) return false;
    const error = validateSchedule();
    if (error) {
        renderScheduleBuilder();
        Swal.fire(t('warningTitle', 'Warning'), error, 'warning');
        return false;
    }

    saveSettingsBtn.disabled = true;
    saveSettingsBtn.textContent = t('savingButton', "Saving...");
    try {
        await db.collection('doctors').doc(currentDoctorDocId).update({
            workingSchedule: doctorSchedule,
            vacations: doctorVacations
        });
        currentDoctorData = { ...currentDoctorData, workingSchedule: JSON.parse(JSON.stringify(doctorSchedule)), vacations: [...doctorVacations] };
        setScheduleDirty(false);
        renderScheduleBuilder();

        const clashes = await countAppointmentsOnVacation();
        if (clashes > 0) {
            Swal.fire(t('settingsSaved', "Settings saved!"), t('vacationApptWarning', 'Note: {count} appointment(s) fall on blocked days. They were not cancelled.', { count: clashes }), 'warning');
        } else {
            toast('success', t('settingsSaved', "Settings saved!"));
        }

        if (calendar) { calendar.destroy(); calendar = null; }
        stopCalendarRangeListener();
        initializeCalendar(activeDoctorUid);
        return true;
    } catch (e) {
        console.error(e);
        Swal.fire(t('genericErrorTitle', 'Error'), t('saveError', 'Could not save.'), 'error');
        return false;
    } finally {
        saveSettingsBtn.disabled = false;
        saveSettingsBtn.textContent = t('saveSettingsButton', "Save Settings");
    }
}

async function countAppointmentsOnVacation() {
    if (!doctorVacations.length) return 0;
    const first = mx(doctorVacations[0]).startOf('day').toISOString();
    const last = mx(doctorVacations[doctorVacations.length - 1]).endOf('day').toISOString();
    try {
        const snap = await db.collection('appointments')
            .where('doctorId', '==', activeDoctorUid)
            .where('start', '>=', first)
            .where('start', '<=', last)
            .get();
        return snap.docs.filter((d) => isActiveAppt(d.data()) && doctorVacations.includes(mx(d.data().start).format('YYYY-MM-DD'))).length;
    } catch (e) {
        console.warn("Could not check appointments on vacation days:", e);
        return 0;
    }
}

function discardScheduleChanges() {
    if (currentDoctorData) loadScheduleFrom(currentDoctorData);
}

// Asks what to do with unsaved schedule changes. Resolves true when it's OK to move on.
async function confirmLeaveSchedule() {
    if (!scheduleDirty) return true;
    const res = await Swal.fire({
        title: t('scheduleUnsavedTitle', 'Unsaved changes'),
        text: t('scheduleUnsavedText', 'You have unsaved changes in the work schedule. What do you want to do?'),
        icon: 'warning',
        showDenyButton: true,
        showCancelButton: true,
        confirmButtonText: t('saveButton', 'Save'),
        denyButtonText: t('discardButton', 'Discard'),
        cancelButtonText: t('stayButton', 'Keep editing')
    });
    if (res.isConfirmed) return saveSchedule();
    if (res.isDenied) { discardScheduleChanges(); return true; }
    return false;
}

window.addEventListener('beforeunload', (e) => {
    if (scheduleDirty) { e.preventDefault(); e.returnValue = ''; }
});

// =================================================================
// --- TABS ---
// =================================================================
async function handleTabClick(event) {
    const target = event.currentTarget.id;
    if (panels['tab-schedule'].classList.contains('active') && target !== 'tab-schedule') {
        if (!(await confirmLeaveSchedule())) return;
    }
    tabButtons.forEach((b) => b.classList.toggle('active', b.id === target));
    Object.entries(panels).forEach(([id, panel]) => panel.classList.toggle('active', id === target));
    // FullCalendar can't measure itself while hidden.
    if (target === 'tab-calendar' && calendar) calendar.updateSize();
}

// =================================================================
// --- SETTINGS ---
// =================================================================
function fillSettingsForms(data) {
    const prefs = data.notificationSettings || {};
    chkNewAppt.checked = prefs.newAppt !== false;
    chkCancelAppt.checked = prefs.cancelAppt !== false;
    chkReminderAppt.checked = prefs.reminderEnabled === true;
    selRemindTime.value = String(prefs.reminderMinutes || "30");
    selRemindTime.disabled = !chkReminderAppt.checked;

    refreshNotifStatus();
}

function refreshNotifStatus() {
    if (!notifStatus || isStaff) return;
    const token = localStorage.getItem('fcmToken');
    const tokens = [...(currentDoctorData?.fcmTokens || []), currentDoctorData?.fcmToken].filter(Boolean);
    if (token && tokens.includes(token)) {
        notifStatus.textContent = t('notifActive', "✅ Notifications active on this device");
        notifStatus.style.color = "green";
    } else if (!messaging) {
        notifStatus.textContent = t('notifUnsupported', "This browser does not support push notifications.");
        notifStatus.style.color = "#666";
    } else {
        notifStatus.textContent = '';
    }
}

async function onEnableNotifClick() {
    if (!currentDoctorDocId || isStaff) return;
    if (!messaging || !('Notification' in window)) {
        notifStatus.textContent = t('notifUnsupported', "This browser does not support push notifications.");
        notifStatus.style.color = "#666";
        return;
    }

    enableNotifBtn.disabled = true;
    notifStatus.textContent = t('notifRequesting', "Requesting permission...");
    notifStatus.style.color = "#333";
    try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            notifStatus.textContent = t('notifDenied', "Permission denied. Enable notifications in your browser settings.");
            notifStatus.style.color = "red";
            return;
        }
        const token = await messaging.getToken({ vapidKey: publicVapidKey });
        if (!token) {
            notifStatus.textContent = t('notifNoToken', "Could not register this device.");
            notifStatus.style.color = "red";
            return;
        }
        // One entry per device, so the doctor's phone and PC both receive alerts.
        await db.collection('doctors').doc(currentDoctorDocId).update({ fcmTokens: FieldValue.arrayUnion(token) });
        localStorage.setItem('fcmToken', token);
        currentDoctorData = { ...currentDoctorData, fcmTokens: [...(currentDoctorData?.fcmTokens || []), token] };
        refreshNotifStatus();
        Swal.fire(t('savedTitle', 'Saved'), t('notifEnabledText', 'You will now receive alerts on this device.'), 'success');
    } catch (err) {
        console.error('Error enabling notifications:', err);
        notifStatus.textContent = `${t('genericErrorTitle', 'Error')}: ${err.message}`;
        notifStatus.style.color = "red";
    } finally {
        enableNotifBtn.disabled = false;
    }
}

async function onSaveNotifPrefsClick() {
    if (!currentDoctorDocId) return;
    saveNotifPrefsBtn.disabled = true;
    saveNotifPrefsBtn.textContent = t('savingButton', "Saving...");
    try {
        await db.collection('doctors').doc(currentDoctorDocId).update({
            notificationSettings: {
                newAppt: chkNewAppt.checked,
                cancelAppt: chkCancelAppt.checked,
                reminderEnabled: chkReminderAppt.checked,
                reminderMinutes: parseInt(selRemindTime.value)
            }
        });
        toast('success', t('notifPrefsSaved', 'Notification preferences updated.'));
    } catch (e) {
        console.error(e);
        Swal.fire(t('genericErrorTitle', 'Error'), t('saveError', 'Could not save.'), 'error');
    } finally {
        saveNotifPrefsBtn.disabled = false;
        saveNotifPrefsBtn.textContent = t('savePreferencesBtn', "Save Preferences");
    }
}

// Shared accounts (multipleUsers): choose which doctor name/specialty the TV shows.
function setupMultiDoctorDropdown(data) {
    if (!multiDoctorContainer || !multiDoctorSelect) return;
    multiDoctorContainer.style.display = 'block';

    const options = Object.keys(data)
        .filter((key) => key.startsWith('doctorDisplayOption'))
        .map((key) => ({ key, name: data[key] }))
        .sort((a, b) => (parseInt(a.key.replace('doctorDisplayOption', '')) || 0) - (parseInt(b.key.replace('doctorDisplayOption', '')) || 0));

    multiDoctorSelect.innerHTML = '';
    options.forEach((opt) => {
        const el = document.createElement('option');
        el.value = opt.name;
        el.dataset.key = opt.key;
        el.textContent = opt.name;
        multiDoctorSelect.appendChild(el);
    });
    if (data.displayName) multiDoctorSelect.value = data.displayName;

    // Assigning onchange (instead of cloning the <select>) replaces any previous handler while
    // keeping the multiDoctorSelect reference attached, so this can safely run on every reload.
    multiDoctorSelect.onchange = async (e) => {
        const selectedOption = e.target.options[e.target.selectedIndex];
        const newName = selectedOption.value;
        const number = selectedOption.dataset.key.replace('doctorDisplayOption', '');
        const matchingSpecialty = data['specialty' + number] || data.specialty || "Especialista";

        const msgEl = $('multi-doctor-message');
        msgEl.textContent = t('updatingStatusButton', "Updating...");
        msgEl.style.color = "#666";
        try {
            await db.collection('doctors').doc(currentDoctorDocId).update({
                displayName: newName,
                specialty: matchingSpecialty
            });
            msgEl.textContent = t('doctorChangedSuccess', "Updated to: ") + newName;
            msgEl.style.color = "green";
            setTimeout(() => { msgEl.textContent = ''; }, 3000);
        } catch (error) {
            console.error(error);
            msgEl.textContent = t('doctorUpdateError', "Error updating.");
            msgEl.style.color = "red";
        }
    };
}

// =================================================================
// --- CALENDAR SUBSCRIPTION LINK ---
// =================================================================
function feedUrlFor(token) {
    const base = IS_LOCAL
        ? `http://127.0.0.1:5001/${firebaseConfig.projectId}/${FUNCTIONS_REGION}`
        : `https://${FUNCTIONS_REGION}-${firebaseConfig.projectId}.cloudfunctions.net`;
    return `${base}/calendarFeed?token=${token}`;
}

// The link contains a random secret; regenerating it disables the old link.
async function getCalendarFeedToken(regenerate) {
    const ref = db.collection('calendarFeeds').doc(activeDoctorUid);
    if (!regenerate) {
        const snap = await ref.get();
        if (snap.exists && snap.data().token) return snap.data().token;
    }
    const token = randomToken();
    await ref.set({ token, createdAt: FieldValue.serverTimestamp() });
    return token;
}

async function onGetSyncLinkClick(regenerate = false) {
    if (!activeDoctorUid || isStaff) return;
    let token;
    try {
        token = await getCalendarFeedToken(regenerate);
    } catch (e) {
        console.error(e);
        Swal.fire(t('genericErrorTitle', 'Error'), t('saveError', 'Could not save.'), 'error');
        return;
    }

    const feedUrl = feedUrlFor(token);
    const webcalUrl = feedUrl.replace(/^https?:\/\//, 'webcal://');
    const googleWebUrl = `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(feedUrl)}`;

    Swal.fire({
        title: t('calendarSyncTitle', "Sync Calendar"),
        html: `
            <p class="swal-text">${escapeHtml(t('calendarSyncText', "Select your device to subscribe:"))}</p>
            <div class="sync-buttons">
                <a href="${escapeHtml(googleWebUrl)}" target="_blank" rel="noopener" class="sync-button" style="background-color: #DB4437;">📅 Google Calendar</a>
                <a href="${escapeHtml(webcalUrl)}" class="sync-button" style="background-color: #007AFF;">🍏 Apple Calendar</a>
                <button type="button" id="swal-copy-btn" class="sync-button" style="background-color: #6c757d;">📋 ${escapeHtml(t('copyLink', "Copy Link"))}</button>
            </div>
            <p class="swal-note">${escapeHtml(t('calendarSyncGoogleHint', 'Google users: the link opens Chrome. Click "Add" and it will appear in your app.'))}</p>
            <p class="swal-note">${escapeHtml(t('calendarSyncPrivateHint', 'This link is private: anyone who has it can see your agenda.'))}</p>
            <button type="button" id="swal-regen-btn" class="link-button">${escapeHtml(t('regenerateLink', 'Generate a new link'))}</button>`,
        showConfirmButton: false,
        showCloseButton: true,
        didOpen: () => {
            const copyBtn = $('swal-copy-btn');
            copyBtn.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(feedUrl);
                    copyBtn.textContent = t('linkCopied', "Copied!");
                    copyBtn.style.backgroundColor = "#28a745";
                    setTimeout(() => Swal.close(), 1500);
                } catch (e) {
                    window.prompt(t('copyLink', "Copy Link"), feedUrl);
                }
            });
            $('swal-regen-btn').addEventListener('click', async () => {
                const res = await Swal.fire({
                    title: t('regenerateLink', 'Generate a new link'),
                    text: t('regenerateConfirm', 'The current link will stop working on every device that uses it. Continue?'),
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonText: t('continueButton', 'Continue'),
                    cancelButtonText: t('cancelButton', 'Cancel')
                });
                if (res.isConfirmed) onGetSyncLinkClick(true);
            });
        }
    });
}

// =================================================================
// --- EVENT LISTENERS ---
// =================================================================
loginButton.addEventListener('click', onLoginClick);
loginPassword.addEventListener('keydown', (e) => { if (e.key === 'Enter') onLoginClick(); });
signOutButton.addEventListener('click', onSignOutClick);
changePasswordButton.addEventListener('click', onChangePasswordClick);
tabButtons.forEach((b) => b.addEventListener('click', handleTabClick));

mainActionButton?.addEventListener('click', onMainActionClick);
noShowButton?.addEventListener('click', onNoShowClick);
callAgainButton?.addEventListener('click', onCallAgainClick);
manualStatusButtonsContainer?.addEventListener('click', onManualStatusClick);
manualUpdateButton?.addEventListener('click', onManualUpdateClick);

staffDoctorSelect?.addEventListener('change', onStaffDoctorChange);

copyScheduleBtn?.addEventListener('click', onCopyMondayClick);
addVacationBtn?.addEventListener('click', onAddVacationClick);
saveSettingsBtn?.addEventListener('click', () => saveSchedule());

chkReminderAppt?.addEventListener('change', () => { selRemindTime.disabled = !chkReminderAppt.checked; });
saveNotifPrefsBtn?.addEventListener('click', onSaveNotifPrefsClick);
enableNotifBtn?.addEventListener('click', onEnableNotifClick);
getSyncLinkBtn?.addEventListener('click', () => onGetSyncLinkClick(false));

// Push messages that arrive while the admin page is open are shown as a toast.
messaging?.onMessage((payload) => {
    const n = payload.notification || {};
    Swal.fire({ title: n.title || '', text: n.body || '', icon: 'info', toast: true, position: 'top-end', showConfirmButton: false, timer: 6000 });
});

// Start
initializeAdmin();
