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

// On localhost the board reads the Firebase Emulator Suite (see tools/test-local.bat).
const IS_LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
if (IS_LOCAL) firebaseConfig.projectId = 'demo-auna';

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
if (IS_LOCAL) db.useEmulator('127.0.0.1', 8080);

// =================================================================
// --- CONSTANTS & STATE ---
// =================================================================
const TZ = "America/Mexico_City";
const DOCTORS_PER_PAGE = 7;          // 4x2 grid = 8 slots: 7 doctors + 1 promo
const PROMO_IMAGE_MS = 30000;
const FLASH_MS = 4000;
const NIGHTLY_RELOAD_HOUR = 3;       // 03:00 Mexico City: clears any slow memory growth
const PROMO_FOLDER_PATH = 'promos/';

// Layout: "auto" measures the screen and fits everything to it; "classic" is the original
// layout tuned on the clinic TV. The Fire TV keeps "classic" until "auto" is checked on it.
// Force either one with index.html?layout=auto or ?layout=classic.
const params = new URLSearchParams(location.search);
const IS_FIRE_TV = /\bAFT\w*|Silk\//.test(navigator.userAgent);
const LAYOUT = params.get('layout') === 'classic' || params.get('layout') === 'auto'
    ? params.get('layout')
    : (IS_FIRE_TV ? 'classic' : 'auto');
document.body.classList.add(`layout-${LAYOUT}`);

const t = (key, vars) => I18N.t(key, vars);
const boardContainer = document.getElementById('board-container');
const connectionStatus = document.getElementById('connection-status');
const alertSound = new Audio('beep.mp3');

let settings = {};
let pageDurationMs = 15000;

let allDoctorsList = [];
let currentPageIndex = 0;
let pageTimer = null;
let previousDoctorStates = null;     // null until the first snapshot (no calls on startup)

let promoPlaylist = [];
let promoIndex = 0;
let promoTimer = null;

let boardUnsub = null;
let fallbackUnsub = null;
let retryDelayMs = 5000;

// =================================================================
// --- HELPERS ---
// =================================================================
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Shown only after 10 s without the server, so startup and brief blips don't flash it.
let offlineTimer = null;
function setOffline(offline) {
    if (!connectionStatus) return;
    if (!offline) {
        clearTimeout(offlineTimer);
        offlineTimer = null;
        connectionStatus.classList.remove('visible');
        return;
    }
    if (offlineTimer) return;
    offlineTimer = setTimeout(() => {
        connectionStatus.textContent = t('offline');
        connectionStatus.classList.add('visible');
    }, 10000);
}

// =================================================================
// --- STARTUP ---
// =================================================================
async function loadPromoPlaylist() {
    try {
        const response = await fetch(`${PROMO_FOLDER_PATH}playlist.json`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const files = await response.json();
        promoPlaylist = files.map((filename) => ({
            type: /\.(mp4|webm)$/i.test(filename) ? 'video' : 'image',
            url: `${PROMO_FOLDER_PATH}${filename}`
        }));
    } catch (e) {
        console.error("Error loading promos:", e);
    }
}

// Resolves with the first settings snapshot; later changes reload the page so everything
// (language, timing) is applied consistently.
function watchSettings() {
    return new Promise((resolve) => {
        let first = true;
        db.collection("settings").doc("displayConfig").onSnapshot((snap) => {
            const next = snap.exists ? snap.data() : {};
            if (first) {
                first = false;
                settings = next;
                resolve();
                return;
            }
            const keys = ['language', 'cardDisplayTime', 'card_view'];
            if (keys.some((k) => JSON.stringify(next[k]) !== JSON.stringify(settings[k]))) safeReload();
        }, (error) => {
            console.error("Error fetching settings:", error);
            if (first) { first = false; resolve(); }
        });
    });
}

async function initializeDisplay() {
    await Promise.all([loadPromoPlaylist(), watchSettings()]);
    await I18N.load(settings.language || 'ES');
    if (settings.cardDisplayTime) pageDurationMs = settings.cardDisplayTime * 1000;

    I18N.apply();
    document.title = t('mainTitle');
    boardContainer.classList.add('card-layout');

    startClock();
    fitStage();
    document.fonts?.ready.then(fitAllText);
    listenForBoard();
    scheduleNightlyReload();
}

function startClock() {
    const clockEl = document.getElementById('clock-display');
    const update = () => {
        clockEl.textContent = new Date().toLocaleTimeString(t('clockLocale'), {
            timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: true
        });
    };
    update();
    setInterval(update, 1000);
}

// =================================================================
// --- LIVE DATA ---
// =================================================================
function listenForBoard() {
    if (boardUnsub) boardUnsub();
    boardUnsub = db.collection('board').onSnapshot({ includeMetadataChanges: true }, (snapshot) => {
        retryDelayMs = 5000;
        setOffline(snapshot.metadata.fromCache);

        // Transition safety: until the board collection is filled by the server, read the
        // doctors collection directly (only works while it is still publicly readable).
        if (snapshot.empty) {
            if (!snapshot.metadata.fromCache) startDoctorsFallback();
            return;
        }
        stopDoctorsFallback();
        handleDoctors(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, (error) => {
        // A failed listener never recovers on its own: show it, then re-subscribe.
        console.error("Board listener error:", error);
        setOffline(true);
        boardUnsub = null;
        setTimeout(listenForBoard, retryDelayMs);
        retryDelayMs = Math.min(retryDelayMs * 2, 60000);
    });
}

function startDoctorsFallback() {
    if (fallbackUnsub) return;
    fallbackUnsub = db.collection('doctors').onSnapshot((snapshot) => {
        handleDoctors(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, (error) => {
        console.warn("Doctors fallback unavailable:", error.code || error);
        fallbackUnsub = null;
    });
}

function stopDoctorsFallback() {
    if (fallbackUnsub) { fallbackUnsub(); fallbackUnsub = null; }
}

function handleDoctors(doctors) {
    const list = doctors
        .filter((d) => d.hide !== true)
        .sort((a, b) => (parseInt(a.officeNumber) || 9999) - (parseInt(b.officeNumber) || 9999));

    // Detect "calls" across ALL doctors, not only the page on screen, so nobody's call is missed.
    const called = [];
    const nextStates = {};
    list.forEach((doctor) => {
        const state = {
            status: (doctor.status || '').toLowerCase(),
            current: doctor.displayCurrentAppointment || '---',
            trigger: doctor.callAgainTrigger || 0
        };
        const prev = previousDoctorStates?.[doctor.id];
        if (prev && state.status === 'in consultation' &&
            (prev.status !== 'in consultation' || prev.current !== state.current || prev.trigger !== state.trigger)) {
            called.push(doctor.id);
        }
        nextStates[doctor.id] = state;
    });
    previousDoctorStates = nextStates;
    allDoctorsList = list;

    const totalPages = Math.max(1, Math.ceil(list.length / DOCTORS_PER_PAGE));
    if (currentPageIndex >= totalPages) currentPageIndex = 0;

    if (called.length) {
        // Jump to the page of the called doctor and keep it on screen for a full rotation.
        const index = list.findIndex((d) => d.id === called[0]);
        currentPageIndex = Math.floor(index / DOCTORS_PER_PAGE);
        alertSound.currentTime = 0;
        alertSound.play().catch((e) => console.log("Audio blocked:", e));
        restartPageTimer();
    } else if (!pageTimer) {
        restartPageTimer();
    }

    renderCurrentPage(new Set(called));
}

// =================================================================
// --- PAGINATION ---
// =================================================================
function restartPageTimer() {
    clearInterval(pageTimer);
    pageTimer = setInterval(() => {
        const totalPages = Math.max(1, Math.ceil(allDoctorsList.length / DOCTORS_PER_PAGE));
        if (totalPages <= 1) return;
        currentPageIndex = (currentPageIndex + 1) % totalPages;
        renderCurrentPage(new Set());
    }, pageDurationMs);
}

// =================================================================
// --- RENDERING ---
// Cards are updated in place (keyed by doctor id), so the promo keeps playing and a card that
// is mid-flash isn't recreated when another doctor changes.
// =================================================================
const STATUS_CLASSES = {
    'available': 'status-available',
    'in consultation': 'status-in-consultation',
    'consultation delayed': 'status-consultation-delayed',
    'not available': 'status-not-available'
};

const STATUS_KEYS = {
    'available': 'statusAvailable',
    'in consultation': 'statusInConsultation',
    'consultation delayed': 'statusDelayed',
    'not available': 'statusNotAvailable'
};

function statusText(lowerStatus, rawStatus) {
    return STATUS_KEYS[lowerStatus] ? t(STATUS_KEYS[lowerStatus]) : (rawStatus || t('noStatus'));
}

function cardInnerHtml(doctor) {
    const lower = (doctor.status || '').toLowerCase();
    const statusClass = STATUS_CLASSES[lower] || 'status-available';
    return `
        <h2>${escapeHtml(doctor.displayName || t('unnamedDoctor'))}</h2>
        <p class="specialty">${escapeHtml(doctor.specialty || t('noSpecialty'))}</p>
        <p class="status ${statusClass}">${escapeHtml(statusText(lower, doctor.status))}</p>
        <div class="appointment-info">
            <strong>${escapeHtml(t('officeLabel'))}</strong> ${escapeHtml(doctor.officeNumber || t('notApplicable'))}
        </div>
        <div class="appointment-info">
            <strong>${escapeHtml(t('currentLabel'))}</strong> ${escapeHtml(doctor.displayCurrentAppointment || '---')}
        </div>`;
}

function ensurePromoCard() {
    let promo = boardContainer.querySelector('.promo-card');
    if (promo) return promo;
    boardContainer.innerHTML = '';
    promo = document.createElement('div');
    promo.className = 'doctor-card promo-card';
    promo.innerHTML = `
        <img id="promo-img-element" class="promo-content" alt="">
        <video id="promo-video-element" class="promo-content" muted playsinline></video>`;
    boardContainer.appendChild(promo);
    startPromoRotation();
    return promo;
}

function renderCurrentPage(flashIds) {
    const promo = ensurePromoCard();
    const start = currentPageIndex * DOCTORS_PER_PAGE;
    const pageDoctors = allDoctorsList.slice(start, start + DOCTORS_PER_PAGE);
    const wanted = new Set(pageDoctors.map((d) => d.id));

    boardContainer.querySelectorAll('.doctor-card[data-id]').forEach((card) => {
        if (!wanted.has(card.dataset.id)) card.remove();
    });

    pageDoctors.forEach((doctor) => {
        let card = boardContainer.querySelector(`.doctor-card[data-id="${CSS.escape(doctor.id)}"]`);
        if (!card) {
            card = document.createElement('div');
            card.dataset.id = doctor.id;
        }
        const lower = (doctor.status || '').toLowerCase();
        const statusClass = STATUS_CLASSES[lower] || 'status-available';
        const flashing = card.classList.contains('card-flash');
        card.className = `doctor-card ${statusClass}${flashing ? ' card-flash' : ''}`;

        const html = cardInnerHtml(doctor);
        const changed = card.dataset.html !== html;
        if (changed) {
            card.innerHTML = html;
            card.dataset.html = html;
        }
        boardContainer.insertBefore(card, promo); // keeps page order
        if (changed) fitCard(card);

        if (flashIds.has(doctor.id)) {
            card.classList.remove('card-flash');
            void card.offsetWidth; // restart the animation
            card.classList.add('card-flash');
            setTimeout(() => card.classList.remove('card-flash'), FLASH_MS);
        }
    });
}

// =================================================================
// --- AUTOMATIC SIZING (layout "auto") ---
// The board is drawn on a stage exactly 1080 px tall and as wide as the screen's shape
// requires, then scaled to the real screen. Inside, every text shrinks only as much as it
// needs to fit its box, so long names never overflow on any TV, monitor or laptop.
// =================================================================
const STAGE_HEIGHT = 1080;
const STAGE_MIN_WIDTH = 1400;   // narrower screens (e.g. 4:3) get a slightly smaller board
const STAGE_MAX_WIDTH = 2600;   // ultra-wide screens get side margins

// Largest/smallest font size (px on the stage) for each fitted text.
const FIT_RULES = [
    ['#main-title-h1', 58, 26],
    ['#footer-message', 64, 26],
    ['.doctor-card h2', 50, 24],
    ['.doctor-card .specialty', 30, 16],
    ['.doctor-card .status', 48, 22],
    ['.doctor-card .appointment-info', 44, 20]  // "Actual: JR (10:30)" is how patients are called
];

function fitStage() {
    if (LAYOUT !== 'auto') return;
    const stage = document.getElementById('stage');
    let scale = innerHeight / STAGE_HEIGHT;
    let width = innerWidth / scale;
    if (width < STAGE_MIN_WIDTH) {
        width = STAGE_MIN_WIDTH;
        scale = innerWidth / STAGE_MIN_WIDTH;
    }
    width = Math.min(width, STAGE_MAX_WIDTH);
    const offsetX = (innerWidth - width * scale) / 2;
    const offsetY = Math.max(0, (innerHeight - STAGE_HEIGHT * scale) / 2);
    stage.style.width = `${width}px`;
    stage.style.height = `${STAGE_HEIGHT}px`;
    stage.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
    fitAllText();
}

// Binary search for the biggest font size at which the text fits its box.
function fitText(el, max, min) {
    let lo = min;
    let hi = max;
    let best = min;
    while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        el.style.fontSize = `${mid}px`;
        // Letters may poke a few px outside tight line boxes; that isn't real overflow.
        const slack = Math.ceil(mid * 0.15);
        if (el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + slack) {
            best = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    el.style.fontSize = `${best}px`;
}

function fitCard(card) {
    if (LAYOUT !== 'auto') return;
    FIT_RULES.filter(([selector]) => selector.startsWith('.doctor-card')).forEach(([selector, max, min]) => {
        card.querySelectorAll(selector.replace('.doctor-card ', '')).forEach((el) => fitText(el, max, min));
    });
}

function fitAllText() {
    if (LAYOUT !== 'auto') return;
    FIT_RULES.forEach(([selector, max, min]) => {
        document.querySelectorAll(selector).forEach((el) => fitText(el, max, min));
    });
}

let resizeTimer = null;
addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(fitStage, 150);
});

// =================================================================
// --- PROMOS (independent of data updates) ---
// =================================================================
function startPromoRotation() {
    clearTimeout(promoTimer);
    if (promoPlaylist.length === 0) return;
    const imgEl = document.getElementById('promo-img-element');
    const vidEl = document.getElementById('promo-video-element');

    const showNext = () => {
        clearTimeout(promoTimer);
        const promo = promoPlaylist[promoIndex];
        promoIndex = (promoIndex + 1) % promoPlaylist.length;

        imgEl.classList.remove('active');
        vidEl.classList.remove('active');
        vidEl.pause();
        vidEl.onended = null;

        if (promo.type === 'video') {
            vidEl.src = promo.url;
            vidEl.classList.add('active');
            vidEl.onended = showNext;
            vidEl.play().catch((e) => {
                console.log("Video autoplay blocked:", e);
                promoTimer = setTimeout(showNext, PROMO_IMAGE_MS);
            });
        } else {
            imgEl.src = promo.url;
            imgEl.classList.add('active');
            promoTimer = setTimeout(showNext, PROMO_IMAGE_MS);
        }
    };
    showNext();
}

// =================================================================
// --- NIGHTLY RELOAD ---
// Reloading only when the site is reachable, so the TV never ends on a browser error page.
// =================================================================
async function safeReload() {
    try {
        const res = await fetch(`index.html?check=${Date.now()}`, { method: 'HEAD', cache: 'no-store' });
        if (res.ok) { location.reload(); return; }
    } catch (e) { /* offline */ }
    setTimeout(safeReload, 5 * 60 * 1000);
}

function scheduleNightlyReload() {
    const now = new Date();
    const mxNow = new Date(now.toLocaleString('en-US', { timeZone: TZ }));
    const target = new Date(mxNow);
    target.setHours(NIGHTLY_RELOAD_HOUR, 0, 0, 0);
    if (target <= mxNow) target.setDate(target.getDate() + 1);
    const jitter = Math.random() * 5 * 60 * 1000;
    setTimeout(safeReload, target - mxNow + jitter);
}

// =================================================================
// --- DIAGNOSTICS ---
// Open index.html?debug=1 on the TV to see what the browser really reports.
// =================================================================
function showViewportDebug() {
    if (!params.has('debug')) return;

    // A font is installed if text rendered with it measures differently from the bare fallback.
    const ctx = document.createElement('canvas').getContext('2d');
    const fontAvailable = (name) => ['monospace', 'serif'].some((base) => {
        ctx.font = `72px ${base}`;
        const fallbackWidth = ctx.measureText('mmmmmmmmmmlli1WQ').width;
        ctx.font = `72px "${name}", ${base}`;
        return ctx.measureText('mmmmmmmmmmlli1WQ').width !== fallbackWidth;
    });

    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;top:0;left:0;z-index:9999;background:rgba(0,0,0,.85);color:#0f0;' +
        'font:20px/1.4 monospace;padding:12px;white-space:pre-wrap;max-width:60vw;';
    document.body.appendChild(box);

    const update = () => {
        const fonts = ['Helvetica Neue', 'Helvetica', 'Arial', 'Open Sans', 'Roboto']
            .map((f) => `${f}: ${fontAvailable(f) ? 'yes' : 'NO'}`).join(', ');
        box.textContent = [
            `layout: ${LAYOUT}${IS_FIRE_TV ? ' (Fire TV detected)' : ''}`,
            `viewport (CSS px): ${innerWidth} x ${innerHeight}`,
            `devicePixelRatio: ${devicePixelRatio}`,
            `screen: ${screen.width} x ${screen.height}`,
            `rendered pixels: ${Math.round(innerWidth * devicePixelRatio)} x ${Math.round(innerHeight * devicePixelRatio)}`,
            `1vh = ${(innerHeight / 100).toFixed(2)}px   1vw = ${(innerWidth / 100).toFixed(2)}px`,
            `fonts: ${fonts}`,
            `userAgent: ${navigator.userAgent}`
        ].join('\n');
    };
    update();
    addEventListener('resize', update);
    document.fonts?.ready.then(update);
}

showViewportDebug();
initializeDisplay();
