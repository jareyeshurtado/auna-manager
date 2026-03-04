// STEP 1: Firebase Config
const firebaseConfig = {
  apiKey: "AIzaSyCP2k-VJURlMV3-UNPVYMD4q9-wwNjiiQc",
  authDomain: "auna-board.firebaseapp.com",
  projectId: "auna-board",
  storageBucket: "auna-board.firebasestorage.app",
  messagingSenderId: "542600310440",
  appId: "1:542600310440:web:3b33ba175b862dc96a5c9d"
};

// STEP 2: Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const messaging = firebase.messaging();
const MEXICO_TIMEZONE = "America/Mexico_City";
const publicVapidKey = "BCAf8hW_aOvmRB_HC2GU2_G3HhmDS5LMAMDv9P1ruVtyL4HG_0XpNNPRECppOfbHhFB9CWJMtl1lrFwacRW8K8o";

// STEP 3: Get references
// --- Login elements ---
const loginContainer = document.getElementById('login-container');
const loginTitleH2 = document.getElementById('login-title-h2');
const loginEmail = document.getElementById('login-email');
const loginPassword = document.getElementById('login-password');
const loginButton = document.getElementById('login-button');
const loginMessage = document.getElementById('login-message');

// --- Admin content elements ---
const adminContent = document.getElementById('admin-content');
const adminTitleH1 = document.getElementById('admin-title-h1');
const signOutButton = document.getElementById('sign-out-button');

// --- Tab elements ---
const tabStatus = document.getElementById('tab-status');
const tabCalendar = document.getElementById('tab-calendar');
const tabSchedule = document.getElementById('tab-schedule'); 
const syncTitle = document.getElementById('sync-title');
const syncDesc = document.getElementById('sync-desc');
const getSyncLinkBtn = document.getElementById('get-sync-link-btn');
const tabSettings = document.getElementById('tab-settings');

const panelStatus = document.getElementById('panel-status');
const panelCalendar = document.getElementById('panel-calendar');
const panelSchedule = document.getElementById('panel-schedule'); // NEW
const panelSettings = document.getElementById('panel-settings');

// --- Status Panel Elements ---
const upcomingList = document.getElementById('upcoming-appointments-list');
const mainActionButton = document.getElementById('main-action-button');
const callAgainButton = document.getElementById('call-again-button'); 
const upcomingLabel = document.getElementById('upcoming-label'); 
const manualStatusLabel = document.getElementById('manual-status-label'); 

// --- Manual Status Buttons ---
const manualStatusButtonsContainer = document.getElementById('status-buttons');
const manualUpdateButton = document.getElementById('manual-update-button'); 
const updateMessage = document.getElementById('update-message');

// --- Settings/Multi-Doctor ---
const settingsTitleH3 = document.getElementById('settings-title-h3');
const multiDoctorContainer = document.getElementById('multi-doctor-container');
const multiDoctorSelect = document.getElementById('multi-doctor-select');
const multiDoctorMessage = document.getElementById('multi-doctor-message');
const selectDoctorLabel = document.getElementById('select-doctor-label');
const changePasswordButton = document.getElementById('change-password-button');
const passwordMessage = document.getElementById('password-message');
const saveProfileBtn = document.getElementById('save-profile-btn');
const chkReplyAppt = document.getElementById('chk-reply-appt');
const lblReplyAppt = document.getElementById('lbl-reply-appt');

// --- Schedule & Vacation Elements ---
const scheduleTitle = document.getElementById('schedule-title');
const scheduleContainer = document.getElementById('schedule-container');
const copyScheduleBtn = document.getElementById('copy-schedule-btn');
const vacationTitle = document.getElementById('vacation-title');
const vacationLabel = document.getElementById('vacation-label');
const vacationPicker = document.getElementById('vacation-date-picker');
const addVacationBtn = document.getElementById('add-vacation-btn');
const vacationList = document.getElementById('vacation-list');
const saveSettingsBtn = document.getElementById('save-settings-btn');

const chkNewAppt = document.getElementById('chk-new-appt');
const chkCancelAppt = document.getElementById('chk-cancel-appt');
const chkReminderAppt = document.getElementById('chk-reminder-appt');
const selRemindTime = document.getElementById('sel-remind-time');
const saveNotifPrefsBtn = document.getElementById('save-notif-prefs-btn');
// Labels for translation
const lblNewAppt = document.getElementById('lbl-new-appt');
const lblCancelAppt = document.getElementById('lbl-cancel-appt');
const lblReminderAppt = document.getElementById('lbl-reminder-appt');
const lblRemindTime = document.getElementById('lbl-remind-time');
const notifPrefTitle = document.getElementById('notif-pref-title');

// --- Calendar element ---
const calendarEl = document.getElementById('calendar-container');

// --- Push Notifications ---
const enableNotifBtn = document.getElementById('enable-notif-btn');
const notifStatus = document.getElementById('notif-status');

// STEP 4: Global variables
let currentUser = null;
let currentDoctorDocId = null;
let calendar = null;
let appointmentsListener = null;
let i18n = {};
let allTexts = {};
let selectedStatus = ''; 
let selectedAppointment = null; 
let currentDoctorStatus = ''; 
let currentConsultationApptId = null; 
let doctorSchedule = {}; 
let doctorVacations = []; 

// =================================================================
// --- Load Texts and Settings ---
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

    let lang = "EN";
    try {
        const docRef = db.collection("settings").doc("displayConfig");
        const docSnap = await docRef.get();
        if (docSnap.exists) lang = docSnap.data().language || "EN";
    } catch (error) { console.error("Error fetching language setting:", error); }

    i18n = allTexts[lang.toUpperCase()] || allTexts.EN;
    applyStaticTextsAdmin();
    setupAuthListener();
}

function applyStaticTextsAdmin() {
    if (adminTitleH1) adminTitleH1.textContent = i18n.admin?.controlTitle || "Admin";
    if (loginTitleH2) loginTitleH2.textContent = i18n.admin?.loginTitle || "Login";
    if (loginEmail) loginEmail.placeholder = i18n.admin?.loginEmailPlaceholder || "Email";
    if (loginPassword) loginPassword.placeholder = i18n.admin?.loginPasswordPlaceholder || "Password";
    if (loginButton) loginButton.textContent = i18n.admin?.loginButton || "Login";
    if (signOutButton) signOutButton.textContent = i18n.admin?.signOutButton || "Sign Out";
    
    // TABS
    if (tabStatus) tabStatus.textContent = i18n.admin?.tabStatus || "Status";
    if (tabCalendar) tabCalendar.textContent = i18n.admin?.tabCalendar || "Calendar";
    if (tabSchedule) tabSchedule.textContent = i18n.admin?.tabSchedule || "Work Schedule"; 
	if (syncTitle) syncTitle.textContent = i18n.admin?.calendarSyncTitle || "Sync Calendar";
    if (syncDesc) syncDesc.textContent = i18n.admin?.calendarSyncText || "Subscribe to updates.";
    if (getSyncLinkBtn) getSyncLinkBtn.textContent = i18n.admin?.calendarSyncBtn || "Get Link";
    if (tabSettings) tabSettings.textContent = i18n.admin?.tabSettings || "Settings";

    if (settingsTitleH3) settingsTitleH3.textContent = i18n.admin?.settingsTitle || "Settings";
    if (changePasswordButton) changePasswordButton.textContent = i18n.admin?.changePasswordButton || "Change Password";
    if (selectDoctorLabel) selectDoctorLabel.textContent = i18n.admin?.selectDoctorLabel || "Active Doctor Profile:";
    if (upcomingLabel) upcomingLabel.textContent = i18n.admin?.nextAppointmentTitle || "Select Next Patient";
    if (manualStatusLabel) manualStatusLabel.textContent = i18n.admin?.setStatusLabel || "Manual Status Override";
    if (callAgainButton) callAgainButton.textContent = i18n.admin?.callAgainButton || "Call Again";
    
    // Schedule Text
    if (scheduleTitle) scheduleTitle.textContent = i18n.admin?.scheduleTitle || "Work Schedule";
    if (vacationTitle) vacationTitle.textContent = i18n.admin?.vacationTitle || "Vacations";
    if (vacationLabel) vacationLabel.textContent = i18n.admin?.vacationLabel || "Pick date:";
    if (addVacationBtn) addVacationBtn.textContent = i18n.admin?.addVacationButton || "Block";
    if (saveSettingsBtn) saveSettingsBtn.textContent = i18n.admin?.saveSettingsButton || "Save Settings";
    if (copyScheduleBtn) copyScheduleBtn.textContent = i18n.admin?.copyToAll || "Copy Mon to All";
	
	if (notifPrefTitle) notifPrefTitle.textContent = i18n.admin?.notifPreferencesTitle || "Notification Preferences";
    if (lblNewAppt) lblNewAppt.textContent = i18n.admin?.notifNewApptLabel || "New Appointment Alerts";
    if (lblCancelAppt) lblCancelAppt.textContent = i18n.admin?.notifCancelLabel || "Cancellation Alerts";
    if (lblReminderAppt) lblReminderAppt.textContent = i18n.admin?.notifReminderLabel || "Upcoming Reminder";
    if (lblRemindTime) lblRemindTime.textContent = i18n.admin?.notifTimeLabel || "Time before:";
    if (saveNotifPrefsBtn) saveNotifPrefsBtn.textContent = i18n.admin?.savePreferencesBtn || "Save";
    
    // Update Dropdown Options dynamically
    if (i18n.admin?.timeOptions) {
        Array.from(selRemindTime.options).forEach(opt => {
            if (i18n.admin.timeOptions[opt.value]) {
                opt.textContent = i18n.admin.timeOptions[opt.value];
            }
        });
    }
}

// =================================================================
// --- AUTH ---
// =================================================================
function setupAuthListener() {
    auth.onAuthStateChanged(user => {
        if (user) {
            currentUser = user;
            adminContent.style.display = 'block';
            loginContainer.style.display = 'none';
            findDoctorDocumentId(user.uid).then(() => {
                if (currentDoctorDocId) {
                    // NOTE: We do NOT initialize calendar here anymore.
                    // We wait until the profile (and schedule) is loaded.
                    loadDoctorProfileAndAppointments(); 
                } else {
                    alert("Critical Error: Could not link login to doctor profile.");
                    auth.signOut();
                }
            });
        } else {
            currentUser = null; currentDoctorDocId = null;
            adminContent.style.display = 'none'; loginContainer.style.display = 'block';
            if (appointmentsListener) appointmentsListener();
            if (calendar) { calendar.destroy(); calendar = null; }
            appointmentsListener = null; selectedStatus = ''; selectedAppointment = null;
            currentConsultationApptId = localStorage.getItem('currentConsultationApptId'); 
        }
    });
}

// =================================================================
// --- DATA LOADING ---
// =================================================================
async function loadDoctorProfileAndAppointments() {
    if (!currentDoctorDocId) return;

    try {
        const docSnap = await db.collection('doctors').doc(currentDoctorDocId).get();
        if (docSnap.exists) {
            const data = docSnap.data();
            currentDoctorStatus = data.status || 'Available';
			
			// --- LOAD NOTIFICATION PREFERENCES ---
			const prefs = data.notificationSettings || {};
			// Default to TRUE if not set
			chkNewAppt.checked = prefs.newAppt !== false; 
			chkCancelAppt.checked = prefs.cancelAppt !== false;
			chkReplyAppt.checked = prefs.whatsappReplies !== false;
			chkReminderAppt.checked = prefs.reminderEnabled === true; // Default false for reminders
			selRemindTime.value = prefs.reminderMinutes || "30";

			// Toggle visibility of time selector
			selRemindTime.disabled = !chkReminderAppt.checked;
			chkReminderAppt.addEventListener('change', () => {
				selRemindTime.disabled = !chkReminderAppt.checked;
			});
            
			// --- LOAD PROFILE TEXT BOXES ---
            if (document.getElementById('input-payment')) {
                document.getElementById('input-payment').value = data.paymentMethods || '';
            }
            if (document.getElementById('input-extrainfo')) {
                document.getElementById('input-extrainfo').value = data.extraInfo || '';
            }
			if (document.getElementById('input-email')) {
				document.getElementById('input-email').value = data.contactEmail || '';
			}
			if (document.getElementById('input-whatsapp')) {
				document.getElementById('input-whatsapp').value = data.contactWhatsapp || '';
			}
			
            // --- LOAD SCHEDULE & VACATIONS ---
            // If none exists, load default
            doctorSchedule = data.workingSchedule || getDefaultSchedule();
            doctorVacations = data.vacations || [];
            
            renderScheduleBuilder();
            renderVacationList();
            
            // --- INITIALIZE CALENDAR NOW (Since we have the data!) ---
            if (calendar) { calendar.destroy(); calendar = null; }
            initializeCalendar(currentUser.uid); 
            // --------------------------------------------------------

            if (data.multipleUsers === true) {
                setupMultiDoctorDropdown(data);
            } else {
                if (multiDoctorContainer) multiDoctorContainer.style.display = 'none';
            }

            if (currentDoctorStatus === 'In Consultation') {
                 currentConsultationApptId = localStorage.getItem('currentConsultationApptId');
            } else {
                 currentConsultationApptId = null;
                 localStorage.removeItem('currentConsultationApptId');
            }
            
            updateMainActionButtonState(); 
        }
    } catch (error) { console.error("Error fetching doctor:", error); }

    loadUpcomingAppointments();
}

function getDefaultSchedule() {
    const s = {};
    for(let i=0; i<7; i++) {
        // 0=Sun, 6=Sat. Default Mon(1)-Fri(5) active
        s[i] = { 
            active: (i > 0 && i < 6), 
            slots: [{start: "09:00", end: "17:00"}] 
        };
    }
    return s;
}

// ... (loadUpcomingAppointments, renderAppointmentList, updateMainActionButtonState remain the same) ...
async function loadUpcomingAppointments() {
    if (!currentUser) return;
    if (upcomingList) upcomingList.innerHTML = `<div class="appointment-item placeholder">${i18n.global?.loading || 'Loading...'}</div>`;
    selectedAppointment = null;
    updateMainActionButtonState(); 

    const now = new Date();
    // Start of Today (00:00:00)
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0); 
    // NEW: End of Today (23:59:59) - This stops it from seeing tomorrow/Saturday
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59); 
    
    try {
        const snapshot = await db.collection("appointments")
            .where("doctorId", "==", currentUser.uid)
            .where("start", ">=", todayStart.toISOString())
            .where("start", "<=", todayEnd.toISOString()) // <--- NEW FILTER
            .orderBy("start", "asc")
            .get();

        const upcoming = [];
        const nowMs = Date.now();

        snapshot.forEach(doc => {
            const data = doc.data();
            const endMs = new Date(data.end).getTime();
            
            // Only show appointments that haven't ended yet (or are in progress)
            if (endMs > nowMs && data.status !== 'completed') {
                upcoming.push({ id: doc.id, ...data });
            }
        });

        // Limit to 3, though for "Today only" you might want to see them all. 
        // Keeping it at 3 to fit the UI nicely.
        const nextThree = upcoming.slice(0, 3);
        renderAppointmentList(nextThree);

    } catch (error) {
        console.error("Error loading upcoming:", error);
        if (upcomingList) upcomingList.innerHTML = `<div class="appointment-item placeholder">${i18n.global?.errorLoading || 'Error loading appointments.'}</div>`;
    }
}

function renderAppointmentList(appointments) {
    if (!upcomingList) return;
    upcomingList.innerHTML = '';
    
    if (appointments.length === 0) {
        upcomingList.innerHTML = `<div class="appointment-item placeholder">${i18n.admin?.noAppointmentsFound || 'No appointments for TODAY.'}</div>`;
        return;
    }

    appointments.forEach(appt => {
        const el = document.createElement('div');
        el.className = 'appointment-item';
        
        const dateObj = new Date(appt.start);
        
        const dateStr = dateObj.toLocaleDateString("es-MX", { 
            weekday: 'short', 
            day: 'numeric', 
            month: 'short',
            timeZone: MEXICO_TIMEZONE 
        });

        const timeStr = dateObj.toLocaleTimeString("en-US", {
            hour: "2-digit", 
            minute: "2-digit", 
            hour12: true, 
            timeZone: MEXICO_TIMEZONE
        });
        
        // --- NEW: Confirmation Badge Logic ---
        let confirmationBadge = '';
        if (appt.confirmed === true) {
            // Patient replied "SI"
            confirmationBadge = `<span style="font-size: 0.85rem; background-color: #d4edda; color: #155724; padding: 2px 6px; border-radius: 10px; margin-left: 8px; vertical-align: middle;">✅ Confirmada</span>`;
        } else if (appt.confirmed === false) {
            // Patient replied "NO"
            confirmationBadge = `<span style="font-size: 0.85rem; background-color: #f8d7da; color: #721c24; padding: 2px 6px; border-radius: 10px; margin-left: 8px; vertical-align: middle;">❌ Cancelada</span>`;
        } else if (appt.whatsappConfirmationSent === true) {
            // Message sent, waiting for reply
            confirmationBadge = `<span style="font-size: 0.85rem; background-color: #fff3cd; color: #856404; padding: 2px 6px; border-radius: 10px; margin-left: 8px; vertical-align: middle;">⏳ Esperando</span>`;
        }

        // We inject the confirmationBadge right next to the patient's name
        el.innerHTML = `
            <h4 style="display: flex; align-items: center; margin-bottom: 5px;">
                ${appt.patientName} ${confirmationBadge}
            </h4>
            <p style="font-weight:bold; color:#333; margin: 2px 0;">${dateStr} - ${timeStr}</p>
            <p style="margin: 2px 0;">${appt.patientPhone || ''}</p>
        `;
        
        el.addEventListener('click', () => {
            const items = upcomingList.querySelectorAll('.appointment-item');
            items.forEach(i => i.classList.remove('selected'));
            el.classList.add('selected');
            selectedAppointment = appt;
            updateMainActionButtonState(); 
        });

        upcomingList.appendChild(el);
    });
}

function updateMainActionButtonState() {
    if (!mainActionButton) return;
    if (currentDoctorStatus === 'In Consultation') {
        mainActionButton.textContent = i18n.admin?.finishButton || "Finish Consultation"; 
        mainActionButton.style.backgroundColor = "#D32F2F"; 
        mainActionButton.disabled = false;
        if (callAgainButton) callAgainButton.style.display = 'block';
    } else {
        mainActionButton.textContent = i18n.admin?.startButton || "Start Consultation";
        mainActionButton.style.backgroundColor = "#5C9458"; 
        if (callAgainButton) callAgainButton.style.display = 'none';
        if (selectedAppointment) { mainActionButton.disabled = false; } 
        else { mainActionButton.disabled = true; }
    }
}

// =================================================================
// --- ACTION HANDLERS (Same as before) ---
// =================================================================
async function onMainActionClick() {
    if (currentDoctorStatus === 'In Consultation') {
        const updateData = { status: "Available", displayCurrentAppointment: "---" };
        try {
            await db.collection('doctors').doc(currentDoctorDocId).update(updateData);
            if (currentConsultationApptId) {
                await db.collection('appointments').doc(currentConsultationApptId).update({ status: 'completed' });
                localStorage.removeItem('currentConsultationApptId');
                currentConsultationApptId = null;
            }
            currentDoctorStatus = "Available";
            Swal.fire('Finished', 'Consultation finished.', 'success');
            loadUpcomingAppointments();
        } catch (e) { console.error(e); Swal.fire('Error', 'Could not finish.', 'error'); }
    } else {
        if (!selectedAppointment) return;
        const startTime = new Date(selectedAppointment.start).toLocaleTimeString("en-US", {
            hour: "2-digit", minute: "2-digit", hour12: true, timeZone: MEXICO_TIMEZONE
        });
        const patientInitials = getInitials(selectedAppointment.patientName);
        const displayString = `${patientInitials} (${startTime})`;
        const updateData = { status: "In Consultation", displayCurrentAppointment: displayString };
        try {
            await db.collection('doctors').doc(currentDoctorDocId).update(updateData);
            currentConsultationApptId = selectedAppointment.id;
            localStorage.setItem('currentConsultationApptId', currentConsultationApptId);
            currentDoctorStatus = "In Consultation";
            Swal.fire(i18n.admin?.bookingSuccessTitle, i18n.admin?.consultationStartSuccess || 'Started!', 'success');
            selectedAppointment = null;
            updateMainActionButtonState();
            loadUpcomingAppointments();
        } catch (e) { console.error(e); Swal.fire(i18n.admin?.bookingErrorTitle, i18n.admin?.consultationStartError || 'Error starting.', 'error'); }
    }
}

async function onCallAgainClick() {
    if (!currentDoctorDocId) return;
    callAgainButton.disabled = true;
    try {
        await db.collection('doctors').doc(currentDoctorDocId).update({ callAgainTrigger: Date.now() });
        const Toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
        Toast.fire({ icon: 'success', title: i18n.admin?.callAgainSent || 'Signal Sent' });
    } catch (e) { console.error(e); Swal.fire('Error', 'Could not send signal.', 'error'); } 
    finally { setTimeout(() => callAgainButton.disabled = false, 2000); }
}

function onManualStatusClick(event) {
    const btn = event.target.closest('button[data-status]');
    if (!btn) return;
    const btns = manualStatusButtonsContainer.querySelectorAll('button');
    btns.forEach(b => { b.classList.remove('selected'); b.style.border = '1px solid #ccc'; });
    btn.classList.add('selected');
    btn.style.border = '2px solid black';
    selectedStatus = btn.dataset.status;
}

async function onManualUpdateClick() {
    if (!selectedStatus) { Swal.fire('Warning', i18n.admin?.validationStatus, 'warning'); return; }
    if (manualUpdateButton) { manualUpdateButton.disabled = true; manualUpdateButton.textContent = i18n.admin?.updatingStatusButton; }
    try {
        await db.collection('doctors').doc(currentDoctorDocId).update({ status: selectedStatus });
        currentDoctorStatus = selectedStatus;
        updateMainActionButtonState(); 
        Swal.fire(i18n.admin?.bookingSuccessTitle, i18n.admin?.statusUpdateSuccess, 'success');
    } catch (e) { console.error(e); Swal.fire(i18n.admin?.bookingErrorTitle, i18n.admin?.statusUpdateError, 'error'); } 
    finally { if (manualUpdateButton) { manualUpdateButton.disabled = false; manualUpdateButton.textContent = i18n.admin?.updateStatusButton; } }
}

function getInitials(name) {
    if (!name) return "";
    return name.trim().split(/\s+/).map(word => word[0].toUpperCase()).join('');
}

// =================================================================
// --- EVENT LISTENERS ---
// =================================================================
loginButton.addEventListener('click', onLoginClick);
signOutButton.addEventListener('click', onSignOutClick);
changePasswordButton.addEventListener('click', onChangePasswordClick);

tabStatus.addEventListener('click', handleTabClick);
tabCalendar.addEventListener('click', handleTabClick);
tabSchedule.addEventListener('click', handleTabClick); // NEW
tabSettings.addEventListener('click', handleTabClick);

if (mainActionButton) mainActionButton.addEventListener('click', onMainActionClick);
if (callAgainButton) callAgainButton.addEventListener('click', onCallAgainClick);
if (manualStatusButtonsContainer) manualStatusButtonsContainer.addEventListener('click', onManualStatusClick);
if (manualUpdateButton) manualUpdateButton.addEventListener('click', onManualUpdateClick);

// =================================================================
// --- AUTH & HELPERS ---
// =================================================================
function onLoginClick() {
    const email = loginEmail.value; 
    const password = loginPassword.value;
    
    if (!email || !password) { 
        loginMessage.textContent = i18n.admin?.loginErrorCredentials || "Por favor ingresa tu correo y contraseña."; 
        loginMessage.style.color = '#c91c1c';
        return; 
    }
    
    loginMessage.textContent = i18n.admin?.loginInProgress || "Iniciando sesión...";
    loginMessage.style.color = '#333';
    
    auth.signInWithEmailAndPassword(email, password)
        .then(() => {
            // Login successful, the auth listener handles the rest
        }) 
        .catch(error => { 
            // --- NEW: Friendly Error Messages ---
            let friendlyMessage = "Error al iniciar sesión. Por favor, intenta de nuevo.";
            
            if (error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
                friendlyMessage = "El correo o la contraseña son incorrectos. Por favor, verifica tus datos.";
            } else if (error.code === 'auth/invalid-email') {
                friendlyMessage = "El formato del correo electrónico no es válido.";
            } else if (error.code === 'auth/too-many-requests') {
                friendlyMessage = "Demasiados intentos fallidos. Por favor, intenta más tarde o restablece tu contraseña.";
            }
            
            loginMessage.textContent = friendlyMessage; 
            loginMessage.style.color = '#c91c1c'; // A nice visible red color
        });
}
async function onSignOutClick() { 
    if (currentUser && currentDoctorDocId) {
        // 1. Security Step: Remove the Notification Token from DB
        try {
            await db.collection('doctors').doc(currentDoctorDocId).update({
                fcmToken: firebase.firestore.FieldValue.delete()
            });
            console.log("Token removed for security.");
        } catch (e) {
            console.error("Could not remove token:", e);
        }
    }

    // 2. Clear Local Data
    localStorage.removeItem('currentConsultationApptId');
    
    // 3. Actually Sign Out
    auth.signOut()
        .then(() => {
            console.log("Signed out successfully");
            // Optional: Reload to clear any memory states
            window.location.reload();
        })
        .catch(error => console.error("Sign Out Error:", error)); 
}

function onChangePasswordClick() {
    if (!currentUser) { Swal.fire('Error!', 'Must be logged in.', 'error'); return; }
    const email = currentUser.email; passwordMessage.textContent = i18n.admin?.sendingResetEmail; passwordMessage.style.color = '#555';
    auth.sendPasswordResetEmail(email)
        .then(() => { passwordMessage.textContent = i18n.admin?.resetEmailSuccess; passwordMessage.style.color = '#006421'; setTimeout(() => { passwordMessage.textContent = ''; }, 7000); })
        .catch(error => { passwordMessage.textContent = (i18n.admin?.resetEmailError || 'Error:') + ' ' + error.message; passwordMessage.style.color = '#c91c1c'; });
}
async function findDoctorDocumentId(uid) {
    if (!uid) return;
    try {
        const doctorQuery = await db.collection("doctors").where("authUID", "==", uid).limit(1).get();
        if (!doctorQuery.empty) currentDoctorDocId = doctorQuery.docs[0].id;
        else { console.error(`No doc for authUID: ${uid}`); currentDoctorDocId = null; }
    } catch (error) { console.error("Error finding doc:", error); currentDoctorDocId = null; }
}

// UPDATED TAB HANDLER
function handleTabClick(event) {
    const clickedTab = event.target;
    // Remove active
    tabStatus.classList.remove('active'); tabCalendar.classList.remove('active'); 
    tabSchedule.classList.remove('active'); tabSettings.classList.remove('active');
    panelStatus.classList.remove('active'); panelCalendar.classList.remove('active'); 
    panelSchedule.classList.remove('active'); panelSettings.classList.remove('active');
    
    // Add active
    if (clickedTab.id === 'tab-status') { 
        tabStatus.classList.add('active'); panelStatus.classList.add('active'); 
        loadDoctorProfileAndAppointments(); 
    }
    else if (clickedTab.id === 'tab-calendar') { 
        tabCalendar.classList.add('active'); panelCalendar.classList.add('active'); 
        if (calendar) calendar.render(); 
    }
    else if (clickedTab.id === 'tab-schedule') { 
        tabSchedule.classList.add('active'); panelSchedule.classList.add('active'); 
        // Re-render builders to ensure they are fresh
        renderScheduleBuilder();
        renderVacationList();
    }
    else if (clickedTab.id === 'tab-settings') { 
        tabSettings.classList.add('active'); panelSettings.classList.add('active'); 
    }
}

// =================================================================
// --- SCHEDULE UI LOGIC ---
// =================================================================
function renderScheduleBuilder() {
    if (!scheduleContainer) return;
    scheduleContainer.innerHTML = '';
    const days = i18n.admin?.days || ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    for (let i = 0; i < 7; i++) {
        const dayData = doctorSchedule[i] || { active: false, slots: [] };
        
        const row = document.createElement('div');
        row.style.borderBottom = '1px solid #eee';
        row.style.padding = '10px 0';
        
        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        header.style.marginBottom = '5px';
        
        const check = document.createElement('input');
        check.type = 'checkbox';
        check.checked = dayData.active;
        check.style.width = 'auto';
        check.style.marginRight = '10px';
        check.onchange = (e) => {
            doctorSchedule[i].active = e.target.checked;
            renderScheduleBuilder();
        };

        const label = document.createElement('span');
        label.textContent = days[i];
        label.style.fontWeight = 'bold';
        if (!dayData.active) label.style.color = '#aaa';

        header.appendChild(check);
        header.appendChild(label);
        row.appendChild(header);

        if (dayData.active) {
            const slotsContainer = document.createElement('div');
            slotsContainer.style.marginLeft = '25px';
            
            dayData.slots.forEach((slot, index) => {
                const slotRow = document.createElement('div');
                slotRow.style.display = 'flex';
                slotRow.style.gap = '10px';
                slotRow.style.marginBottom = '5px';
                
                const startIn = document.createElement('input');
                startIn.type = 'time';
                startIn.value = slot.start;
                startIn.onchange = (e) => doctorSchedule[i].slots[index].start = e.target.value;

                const endIn = document.createElement('input');
                endIn.type = 'time';
                endIn.value = slot.end;
                endIn.onchange = (e) => doctorSchedule[i].slots[index].end = e.target.value;

                const delBtn = document.createElement('button');
                delBtn.textContent = 'x';
                delBtn.style.backgroundColor = '#d9534f';
                delBtn.style.color = 'white';
                delBtn.style.border = 'none';
                delBtn.style.borderRadius = '4px';
                delBtn.style.width = '30px';
                delBtn.onclick = () => {
                    doctorSchedule[i].slots.splice(index, 1);
                    renderScheduleBuilder();
                };

                slotRow.appendChild(startIn);
                slotRow.appendChild(document.createTextNode(' - '));
                slotRow.appendChild(endIn);
                slotRow.appendChild(delBtn);
                slotsContainer.appendChild(slotRow);
            });

            const addBtn = document.createElement('button');
            addBtn.textContent = i18n.admin?.addSlot || "+ Add Hours";
            addBtn.className = "secondary-button";
            addBtn.style.fontSize = "0.8rem";
            addBtn.style.padding = "5px 10px";
            addBtn.style.marginTop = "5px";
            addBtn.onclick = () => {
                doctorSchedule[i].slots.push({ start: "09:00", end: "13:00" });
                renderScheduleBuilder();
            };
            slotsContainer.appendChild(addBtn);
            row.appendChild(slotsContainer);
        }
        scheduleContainer.appendChild(row);
    }
}

if (copyScheduleBtn) {
    copyScheduleBtn.addEventListener('click', () => {
        const mon = doctorSchedule[1]; 
        for (let i = 2; i <= 5; i++) {
            doctorSchedule[i] = JSON.parse(JSON.stringify(mon));
        }
        renderScheduleBuilder();
        Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Copied!', showConfirmButton: false, timer: 1000 });
    });
}

function renderVacationList() {
    if (!vacationList) return;
    vacationList.innerHTML = '';
    doctorVacations.sort();
    doctorVacations.forEach((dateStr, index) => {
        const tag = document.createElement('div');
        tag.style.backgroundColor = '#e0e0e0';
        tag.style.padding = '5px 10px';
        tag.style.borderRadius = '15px';
        tag.style.fontSize = '0.9rem';
        tag.style.display = 'flex';
        tag.style.alignItems = 'center';
        tag.style.gap = '8px';

        const span = document.createElement('span');
        span.textContent = dateStr;
        const x = document.createElement('span');
        x.textContent = '×';
        x.style.cursor = 'pointer';
        x.style.fontWeight = 'bold';
        x.style.color = '#d9534f';
        x.onclick = () => { doctorVacations.splice(index, 1); renderVacationList(); };
        tag.appendChild(span); tag.appendChild(x);
        vacationList.appendChild(tag);
    });
}

if (addVacationBtn) {
    addVacationBtn.addEventListener('click', () => {
        const val = vacationPicker.value;
        if (!val) return;
        if (!doctorVacations.includes(val)) {
            doctorVacations.push(val);
            renderVacationList();
        }
        vacationPicker.value = '';
    });
}

if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener('click', async () => {
        if (!currentDoctorDocId) return;
        saveSettingsBtn.disabled = true;
        saveSettingsBtn.textContent = i18n.admin?.updatingStatusButton || "Saving...";
        try {
            await db.collection('doctors').doc(currentDoctorDocId).update({
                workingSchedule: doctorSchedule,
                vacations: doctorVacations
            });
            Swal.fire('Success', i18n.admin?.settingsSaved || "Settings Saved", 'success');
            if (calendar) { calendar.destroy(); calendar = null; initializeCalendar(currentUser.uid); }
        } catch (e) { console.error(e); Swal.fire('Error', 'Could not save settings.', 'error'); } 
        finally { saveSettingsBtn.disabled = false; saveSettingsBtn.textContent = i18n.admin?.saveSettingsButton || "Save Settings"; }
    });
}

// =================================================================
// --- INITIALIZE CALENDAR (Fixed) ---
// =================================================================
function initializeCalendar(uid) {
    if (calendar) return;

    // 1. Convert Schedule to Business Hours
    const businessHours = [];
    let minTime = "24:00";
    let maxTime = "00:00";

    for (let i = 0; i < 7; i++) {
        const dayData = doctorSchedule[i];
        if (dayData && dayData.active && dayData.slots) {
            dayData.slots.forEach(slot => {
                businessHours.push({
                    daysOfWeek: [i],
                    startTime: slot.start,
                    endTime: slot.end
                });
                if (slot.start < minTime) minTime = slot.start;
                if (slot.end > maxTime) maxTime = slot.end;
            });
        }
    }
    if (businessHours.length === 0) { minTime = "08:00"; maxTime = "20:00"; }

    // --- NEW: Detect if the user is on a mobile phone ---
    const isMobile = window.innerWidth <= 600;

    calendar = new FullCalendar.Calendar(calendarEl, {
        // Start in Day View for phones, Week View for PCs
        initialView: isMobile ? 'timeGridDay' : 'timeGridWeek',
        
        // Hide the "Week" button on phones to save space
        headerToolbar: { 
            left: 'prev,next today', 
            center: 'title', 
            right: isMobile ? 'dayGridMonth,timeGridDay' : 'dayGridMonth,timeGridWeek,timeGridDay' 
        },
        
        // Let the calendar grow naturally on mobile so it doesn't get squished
        height: isMobile ? 'auto' : undefined, 
        
        timeZone: MEXICO_TIMEZONE,
        businessHours: businessHours, 
        selectConstraint: "businessHours", 
        slotMinTime: minTime, 
        slotMaxTime: maxTime, 
        firstDay: 1, 

        editable: false, 
        selectable: true, 
        
        dateClick: function(clickInfo) { 
             // --- NEW: Month View Fix ---
             // If they click a day in Month view, zoom into that day's schedule instead of booking!
             if (clickInfo.view.type === 'dayGridMonth') {
                 calendar.changeView('timeGridDay', clickInfo.dateStr);
                 return; 
             }

             const dateStr = clickInfo.dateStr.split('T')[0]; 
             const dateObj = clickInfo.date;
             
             // 1. CHECK VACATIONS
             if (doctorVacations.includes(dateStr)) {
                 Swal.fire('Vacation', i18n.admin?.vacationBlocked || "Doctor is on vacation.", 'warning');
                 return;
             }

             // 2. CHECK WORKING HOURS 
             const dayIndex = dateObj.getDay(); // 0=Sun
             const dayConfig = doctorSchedule[dayIndex];
             
             if (!dayConfig || !dayConfig.active) {
                 Swal.fire('Off Day', i18n.admin?.nonWorkingTimeError || "Doctor is not working.", 'warning');
                 return;
             }

             // Check slots
             const clickedTime = dateObj.toLocaleTimeString('en-US', {hour12: false, hour:'2-digit', minute:'2-digit'});
             let isWithinSlot = false;
             if (dayConfig.slots) {
                 for (let slot of dayConfig.slots) {
                     if (clickedTime >= slot.start && clickedTime < slot.end) {
                         isWithinSlot = true;
                         break;
                     }
                 }
             }

             if (!isWithinSlot) {
                 Swal.fire('Closed', i18n.admin?.nonWorkingTimeError || "Doctor is not working at this time.", 'warning');
                 return;
             }
             
             // If passed checks, open booking
             promptBooking(clickInfo, uid); 
        },
        
        eventClick: function(clickInfo) {
             confirmDelete(clickInfo);
        },

        events: function(info, successCallback, failureCallback) {
            db.collection('appointments')
                .where('doctorId', '==', uid)
                .where('start', '>=', info.start.toISOString())
                .where('end', '<=', info.end.toISOString())
                .get()
                .then(snap => {
                    const events = snap.docs.map(d => ({
                        id: d.id, 
                        title: d.data().patientName, 
                        start: d.data().start, 
                        end: d.data().end
                    }));
                    doctorVacations.forEach(vDate => {
                        events.push({
                            start: vDate, end: vDate,
                            display: 'background', color: '#ff9f89', allDay: true
                        });
                    });
                    successCallback(events);
                })
                .catch(e => failureCallback(e));
        }
    });
    calendar.render();
}

function setupMultiDoctorDropdown(data) {
    if (!multiDoctorContainer || !multiDoctorSelect) return;
    multiDoctorContainer.style.display = 'block';
    
    const options = [];
    Object.keys(data).forEach(key => {
        if (key.startsWith('doctorDisplayOption')) {
            options.push({ key: key, name: data[key] });
        }
    });
    
    options.sort((a, b) => {
        const numA = parseInt(a.key.replace('doctorDisplayOption', '')) || 0;
        const numB = parseInt(b.key.replace('doctorDisplayOption', '')) || 0;
        return numA - numB;
    });
    
    multiDoctorSelect.innerHTML = '';
    options.forEach(opt => {
        const el = document.createElement('option');
        el.value = opt.name; 
        el.dataset.key = opt.key; // NEW: Store the original key (e.g., doctorDisplayOption2)
        el.textContent = opt.name;
        multiDoctorSelect.appendChild(el);
    });
    
    if (data.displayName) { multiDoctorSelect.value = data.displayName; }
    
    const newSelect = multiDoctorSelect.cloneNode(true);
    multiDoctorSelect.parentNode.replaceChild(newSelect, multiDoctorSelect);
    
    // NEW: The updated Change Listener
    newSelect.addEventListener('change', async (e) => {
        const selectedOption = e.target.options[e.target.selectedIndex];
        const newName = selectedOption.value;
        const optionKey = selectedOption.dataset.key; // Gets 'doctorDisplayOption1', 'doctorDisplayOption2', etc.
        
        // Extract the number and find the matching specialty
        const number = optionKey.replace('doctorDisplayOption', ''); 
        const matchingSpecialty = data['specialty' + number] || data.specialty || "Especialista";

        const msgEl = document.getElementById('multi-doctor-message'); 
        msgEl.textContent = i18n.admin?.updatingStatusButton || "Updating..."; 
        msgEl.style.color = "#666";
        
        try {
            // Update BOTH the name and the specialty in the database
            await db.collection('doctors').doc(currentDoctorDocId).update({ 
                displayName: newName,
                specialty: matchingSpecialty // <--- This pushes the new specialty to the display!
            });
            
            msgEl.textContent = (i18n.admin?.doctorChangedSuccess || "Updated to: ") + newName; 
            msgEl.style.color = "green";
            setTimeout(() => { msgEl.textContent = ''; }, 3000);
            
        } catch (error) { 
            console.error(error); 
            msgEl.textContent = i18n.admin?.doctorUpdateError || "Error updating."; 
            msgEl.style.color = "red"; 
        }
    });
}

// Helper to keep code clean: The Booking Prompt
function promptBooking(clickInfo, uid) {
    const startDate = clickInfo.date;
    const startTimeFormatted = startDate.toLocaleTimeString("en-US", { 
        hour: "2-digit", 
        minute: "2-digit", 
        hour12: true, 
        timeZone: MEXICO_TIMEZONE 
    });
     
    // --- NEW: Build dynamic BUTTONS instead of a dropdown ---
    let multiDoctorHtml = '';
    if (multiDoctorContainer && multiDoctorContainer.style.display !== 'none' && multiDoctorSelect.options.length > 0) {
        let buttonsHtml = Array.from(multiDoctorSelect.options).map(opt => 
            `<button class="swal2-confirm swal2-styled doctor-button" data-doctor="${opt.value}">${opt.textContent}</button>`
        ).join('');
        
        multiDoctorHtml = `
            <span class="swal2-label" style="margin-top: 10px;">Doctor de la Cita:</span>
            <div id="swal-doctor-buttons">
                ${buttonsHtml}
            </div>
        `;
    }

    Swal.fire({
        title: (i18n.admin?.bookAppointmentTitle || 'Book {time}').replace('{time}', startTimeFormatted),
        width: '600px',
        html: `<div>
            <span class="swal2-label">${i18n.admin?.patientNameLabel}</span>
            <input id="swal-input-name" class="swal2-input">
            <span class="swal2-label">${i18n.admin?.phoneLabel}</span>
            <input id="swal-input-phone" class="swal2-input" type="tel">
            
            ${multiDoctorHtml} <span class="swal2-label" style="margin-top: 10px;">${i18n.admin?.durationLabel}</span>
            <div id="swal-duration-buttons">
                <button class="swal2-confirm swal2-styled duration-button" data-duration="30">30 min</button>
                <button class="swal2-confirm swal2-styled duration-button" data-duration="45">45 min</button>
                <button class="swal2-confirm swal2-styled duration-button" data-duration="60">1 hour</button>
                <button class="swal2-confirm swal2-styled duration-button" data-duration="90">1:30</button>
            </div>
        </div>`,
        confirmButtonText: i18n.admin?.bookButton, 
        focusConfirm: false,
        didOpen: () => {
            // 1. Duration Buttons Click Logic
            const durationButtons = document.querySelectorAll('#swal-duration-buttons .duration-button');
            durationButtons.forEach(btn => btn.addEventListener('click', () => { 
                // Remove the beautiful class from ALL buttons first
                durationButtons.forEach(b => {
                    b.classList.remove('selected-swal-btn');
                    b.style.border = 'none'; // Strip old inline styles just in case
                }); 
                // Add the beautiful class to the CLICKED button
                btn.classList.add('selected-swal-btn'); 
                document.getElementById('swal-duration-buttons').dataset.selectedDuration = btn.dataset.duration; 
            }));
            
            // Auto-select 30 mins by default
            const defBtn = document.querySelector('#swal-duration-buttons .duration-button[data-duration="30"]'); 
            if(defBtn) defBtn.click();

            // 2. Doctor Buttons Click Logic
            const docButtonsContainer = document.getElementById('swal-doctor-buttons');
            if (docButtonsContainer) {
                const docButtons = document.querySelectorAll('#swal-doctor-buttons .doctor-button');
                docButtons.forEach(btn => btn.addEventListener('click', () => { 
                    docButtons.forEach(b => {
                        b.classList.remove('selected-swal-btn');
                        b.style.border = 'none';
                    }); 
                    btn.classList.add('selected-swal-btn'); 
                    docButtonsContainer.dataset.selectedDoctor = btn.dataset.doctor; 
                }));
                
                // Auto-select the first doctor in the list by default
                if (docButtons.length > 0) docButtons[0].click();
            }
        },
        preConfirm: () => {
            const name = document.getElementById('swal-input-name').value;
            const phone = document.getElementById('swal-input-phone').value;
            const dur = document.getElementById('swal-duration-buttons').dataset.selectedDuration;
            
            // --- NEW: Read which doctor button was selected ---
            const specificDoctorContainer = document.getElementById('swal-doctor-buttons');
            const specificDoctor = specificDoctorContainer ? specificDoctorContainer.dataset.selectedDoctor : null;

            const phoneRegex = /^\d{10}$/;
            
            if(!name) { Swal.showValidationMessage(i18n.admin?.validationName); return false; }
            if(!phone) { Swal.showValidationMessage(i18n.admin?.validationPhone); return false; }
            if(!phoneRegex.test(phone)) { Swal.showValidationMessage(i18n.admin?.validationPhoneDigits); return false; }
            if(!dur) { Swal.showValidationMessage(i18n.admin?.validationDuration); return false; }
            
            return {name, phone, duration: parseInt(dur), specificDoctor};
        }
    }).then(async (res) => {
        if(res.isConfirmed && res.value) {
            const end = new Date(startDate.getTime() + res.value.duration * 60000);
            
            try {
                const q = await db.collection('appointments')
                    .where('doctorId','==',uid)
                    .where('start','<',end.toISOString())
                    .where('end','>',startDate.toISOString())
                    .get();
                
                if(!q.empty) { 
                    Swal.fire('Error', i18n.admin?.overlapErrorText || "Overlap detected", 'warning'); 
                    return; 
                }
            } catch(e) { console.error("Overlap check skipped", e); }

            // --- SAVE TO DB ---
            const apptData = {
                doctorId: uid, 
                patientName: res.value.name, 
                patientPhone: res.value.phone,
                start: startDate.toISOString(), 
                end: end.toISOString()
            };

            if (res.value.specificDoctor) {
                apptData.specificDoctorName = res.value.specificDoctor;
            }

            db.collection('appointments').add(apptData).then(() => {
                Swal.fire(i18n.admin?.bookingSuccessTitle, '', 'success');
                if (calendar) calendar.refetchEvents(); 
            });
        }
    });
}

function confirmDelete(clickInfo) {
    if (clickInfo.event.display === 'background') return;
    Swal.fire({
         title: i18n.admin?.deleteConfirmTitle, 
         text: (i18n.admin?.deleteConfirmText || '').replace('{patient}', clickInfo.event.title), 
         showCancelButton: true, confirmButtonText: i18n.admin?.deleteButton
    }).then(res => {
         if(res.isConfirmed) db.collection('appointments').doc(clickInfo.event.id).delete()
            .then(() => { clickInfo.event.remove(); Swal.fire(i18n.admin?.deleteSuccessTitle, '', 'success'); });
    });
}

if (getSyncLinkBtn) {
    getSyncLinkBtn.addEventListener('click', () => {
        if (!currentUser) return;
        
        // 1. Construct the Feed URL
        const projectId = "auna-board"; 
        const region = "us-central1";
        const feedUrl = `https://${region}-${projectId}.cloudfunctions.net/calendarFeed?uid=${currentUser.uid}`;
        
        // 2. Apple/Outlook Link (webcal://)
        const webcalUrl = feedUrl.replace('https://', 'webcal://');

        // 3. Google Calendar Web Link
        const googleWebUrl = `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(feedUrl)}`;

        // Common Button Style
        const btnStyle = "display: block; width: 100%; padding: 12px; margin: 8px 0; border: none; border-radius: 5px; color: white; font-weight: bold; font-size: 1rem; text-decoration: none; text-align: center; cursor: pointer; box-sizing: border-box; font-family: sans-serif;";

        // 4. Show SweetAlert
        Swal.fire({
            title: i18n.admin?.calendarSyncTitle || "Sync Calendar",
            html: `
                <p style="font-size:1rem; color:#555; margin-bottom:20px;">
                    ${i18n.admin?.calendarSyncText || "Select your device to subscribe:"}
                </p>
                
                <div style="padding: 0 10px;">
                    
                    <a href="${googleWebUrl}" target="_blank" 
                       style="${btnStyle} background-color: #DB4437;">
                       📅 Google Calendar
                    </a>

                    <a href="${webcalUrl}" 
                       style="${btnStyle} background-color: #007AFF;">
                       🍏 Apple Calendar
                    </a>

                    <button id="swal-copy-btn" 
                       style="${btnStyle} background-color: #6c757d;">
                       📋 ${i18n.admin?.copyLink || "Copy Link"}
                    </button>

                </div>
                <div style="margin-top:20px; font-size:0.85rem; color:#888; line-height: 1.4;">
                    <strong>Google Users:</strong> The link opens Chrome.<br>Click "Add" and it will appear in your app.
                </div>
            `,
            showConfirmButton: false, // Hide the default "OK" button
            showCloseButton: true,
            didOpen: () => {
                const copyBtn = document.getElementById('swal-copy-btn');
                copyBtn.addEventListener('click', () => {
                    navigator.clipboard.writeText(feedUrl);
                    // Visual Feedback
                    const originalText = copyBtn.textContent;
                    copyBtn.textContent = i18n.admin?.linkCopied || "Copied!";
                    copyBtn.style.backgroundColor = "#28a745"; // Green
                    
                    setTimeout(() => {
                         Swal.close(); 
                    }, 1500);
                });
            }
        });
    });
}

if (enableNotifBtn) {
    enableNotifBtn.addEventListener('click', async () => {
        if (!currentUser || !currentDoctorDocId) return;

        enableNotifBtn.disabled = true;
        notifStatus.textContent = "Requesting permission...";

        try {
            // 1. Request Permission
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                throw new Error('Permission denied');
            }

            // 2. Get Token
            const token = await messaging.getToken({ vapidKey: publicVapidKey });
            
            if (token) {
                // 3. Save Token to Doctor's Profile
                await db.collection('doctors').doc(currentDoctorDocId).update({
                    fcmToken: token
                });
                
                notifStatus.textContent = "✅ Notifications Active on this device!";
                notifStatus.style.color = "green";
                Swal.fire('Success', 'You will now receive instant alerts on this phone.', 'success');
            } else {
                notifStatus.textContent = "No registration token available.";
            }

        } catch (err) {
            console.error('An error occurred while retrieving token. ', err);
            notifStatus.textContent = "Error: " + err.message;
            notifStatus.style.color = "red";
        } finally {
            enableNotifBtn.disabled = false;
        }
    });
    
    // Optional: Listen for foreground messages
    messaging.onMessage((payload) => {
        console.log('Message received. ', payload);
        // If the doctor has the admin page open, show a Swal alert instead of a banner
        Swal.fire({
            title: payload.notification.title,
            text: payload.notification.body,
            icon: 'info',
            toast: true,
            position: 'top-end',
            showConfirmButton: false,
            timer: 5000
        });
    });
}

if (saveNotifPrefsBtn) {
    saveNotifPrefsBtn.addEventListener('click', async () => {
        if (!currentDoctorDocId) return;
        
        saveNotifPrefsBtn.disabled = true;
        saveNotifPrefsBtn.textContent = "Saving...";

        const settings = {
            newAppt: chkNewAppt.checked,
            cancelAppt: chkCancelAppt.checked,
            whatsappReplies: chkReplyAppt.checked, // <-- NEW
            reminderEnabled: chkReminderAppt.checked,
            reminderMinutes: parseInt(selRemindTime.value)
        };

        try {
            await db.collection('doctors').doc(currentDoctorDocId).update({
                notificationSettings: settings
            });
            Swal.fire('Saved', 'Notification preferences updated.', 'success');
        } catch (e) {
            console.error(e);
            Swal.fire('Error', 'Could not save settings.', 'error');
        } finally {
            saveNotifPrefsBtn.disabled = false;
            saveNotifPrefsBtn.textContent = i18n.admin?.savePreferencesBtn || "Save Preferences";
        }
    });
}

if (saveProfileBtn) {
    saveProfileBtn.addEventListener('click', async () => {
        if (!currentDoctorDocId) return;
        
        saveProfileBtn.disabled = true;
        saveProfileBtn.textContent = "Guardando...";

        try {
            await db.collection('doctors').doc(currentDoctorDocId).update({
				contactEmail: document.getElementById('input-email').value,
				contactWhatsapp: document.getElementById('input-whatsapp').value, // <-- NEW
				paymentMethods: document.getElementById('input-payment').value,
				extraInfo: document.getElementById('input-extrainfo').value
			});
            Swal.fire('Guardado', 'La información del Asistente Virtual ha sido actualizada.', 'success');
        } catch (e) {
            console.error(e);
            Swal.fire('Error', 'No se pudo guardar la información.', 'error');
        } finally {
            saveProfileBtn.disabled = false;
            saveProfileBtn.textContent = "Guardar Información del Bot";
        }
    });
}

// Start
initializeAdmin();