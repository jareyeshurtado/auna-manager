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

// Layout: "classic" is the design tuned on the clinic TV (default everywhere).
// "auto" (index.html?layout=auto) measures the screen and fits every text to it.
const params = new URLSearchParams(location.search);
const IS_FIRE_TV = /\bAFT\w*|Silk\//.test(navigator.userAgent);
const LAYOUT = params.get('layout') === 'auto' ? 'auto' : 'classic';
document.body.classList.add(`layout-${LAYOUT}`);

// TVs crop a few % of the picture at the edges ("overscan"). Keep the board inside a safe area:
// 3% on the Fire TV by default; override with index.html?margin=0 … ?margin=10 (percent).
const SAFE_MARGIN = (() => {
    const requested = parseFloat(params.get('margin'));
    if (!Number.isNaN(requested)) return Math.min(Math.max(requested, 0), 10) / 100;
    return IS_FIRE_TV ? 0.03 : 0;
})();

// Android's automatic text resizing would change sizes behind our back in the auto layout.
if (LAYOUT === 'auto') document.documentElement.classList.add('layout-auto-root');

// Some TV browsers draw ALL text smaller or bigger than the page asks for (a "text zoom"
// setting): the clinic's Fire TV draws it at about half size. Measure it once — the same words
// drawn by the page vs. drawn on a canvas, which ignores text zoom — so the auto layout can
// compensate and texts come out at the intended size on every screen.
const TEXT_SCALE = (() => {
    // Manual override, e.g. index.html?layout=auto&textscale=0.5 (only if detection ever fails).
    const forced = parseFloat(params.get('textscale'));
    if (forced > 0.2 && forced < 5) return forced;
    try {
        const sample = 'Consultorio MMMM 1234';
        const span = document.createElement('span');
        span.textContent = sample;
        span.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap;font:400 100px Arial, sans-serif;';
        document.body.appendChild(span);
        const domWidth = span.getBoundingClientRect().width;
        span.remove();
        const ctx = document.createElement('canvas').getContext('2d');
        ctx.font = '400 100px Arial, sans-serif';
        const ratio = domWidth / ctx.measureText(sample).width;
        return ratio > 0.2 && ratio < 5 && Math.abs(ratio - 1) > 0.03 ? ratio : 1;
    } catch (e) {
        return 1;
    }
})();

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
    document.fonts?.ready.then(fitStage);
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

// Auto layout: the name is always exactly two lines — the last surname goes on the second one
// ("Dr. Andres Arguello" / "Bernal"); short names get an empty second line. Every card therefore
// has the same shape without relying on font-relative heights (some TV browsers scale those wrong).
function nameHtml(name) {
    if (LAYOUT !== 'auto') return escapeHtml(name);
    const words = String(name).trim().split(/\s+/);
    const second = words.length >= 3 ? words.pop() : '';
    const line = (text) => `<span class="name-line">${text ? escapeHtml(text) : '&nbsp;'}</span>`;
    return line(words.join(' ')) + line(second);
}

function cardInnerHtml(doctor) {
    const lower = (doctor.status || '').toLowerCase();
    const statusClass = STATUS_CLASSES[lower] || 'status-available';
    const name = `<h2>${nameHtml(doctor.displayName || t('unnamedDoctor'))}</h2>`;
    const specialty = `<p class="specialty">${escapeHtml(doctor.specialty || t('noSpecialty'))}</p>`;
    const status = `<p class="status ${statusClass}">${escapeHtml(statusText(lower, doctor.status))}</p>`;
    const info = `
        <div class="appointment-info">
            <strong>${escapeHtml(t('officeLabel'))}</strong> ${escapeHtml(doctor.officeNumber || t('notApplicable'))}
        </div>
        <div class="appointment-info">
            <strong>${escapeHtml(t('currentLabel'))}</strong> ${escapeHtml(doctor.displayCurrentAppointment || '---')}
        </div>`;
    // Auto layout: three blocks (name + specialty | status pill | consultorio + actual) with equal
    // space between them, so the pill sits in the middle of every card.
    if (LAYOUT === 'auto') {
        return `<div class="card-head">${name}${specialty}</div>${status}<div class="card-info">${info}</div>`;
    }
    return `${name}${specialty}${status}${info}`;
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
        if (changed) guardCard(card);

        if (flashIds.has(doctor.id)) {
            card.classList.remove('card-flash');
            void card.offsetWidth; // restart the animation
            card.classList.add('card-flash');
            setTimeout(() => card.classList.remove('card-flash'), FLASH_MS);
        }
    });

    // New doctors, names or specialties may need different shared text sizes.
    if (LAYOUT === 'auto' && contentSignature() !== lastFitSignature) fitEverything();
}

// =================================================================
// --- AUTOMATIC SIZING (layout "auto") ---
// 1. The board is drawn on a stage exactly 1080 px tall and as wide as the screen's shape
//    requires, then scaled to the real screen (inside the TV's safe area).
// 2. Every text uses a comfortable TARGET size (taken from the classic design as seen on the
//    clinic TV), never bigger. It only gets smaller when a text wouldn't fit — and then the
//    same size is used on every card, so all cards always look alike, also across pages.
// =================================================================
const STAGE_HEIGHT = 1080;
const STAGE_MIN_WIDTH = 1400;   // narrower screens (e.g. 4:3) get a slightly smaller board
const STAGE_MAX_WIDTH = 2600;   // ultra-wide screens get side margins

// Target (= largest) and smallest font sizes, in px on the 1080-px stage. Targets match the
// classic board on the clinic TV: key information ≈ 3% of the screen height.
const CARD_FIELDS = {
    name: { selector: 'h2', variable: '--fit-name', max: 34, min: 20 },
    specialty: { selector: '.specialty', variable: '--fit-specialty', max: 24, min: 16 },
    status: { selector: '.status', variable: '--fit-status', max: 32, min: 20 },
    info: { selector: '.appointment-info', variable: '--fit-info', max: 30, min: 20 }
};
// Texts outside the cards: [selector, target, smallest]
const SINGLE_FITS = [
    ['#main-title-h1', 46, 24],
    ['#footer-message', 40, 22]
];
const CLOCK_TARGET = 62;

let lastFitSignature = '';

function fitStage() {
    if (LAYOUT !== 'auto') return;
    if (innerWidth < 200 || innerHeight < 150) return; // background/screensaver: keep the last good layout
    const stage = document.getElementById('stage');
    const availableWidth = innerWidth * (1 - 2 * SAFE_MARGIN);
    const availableHeight = innerHeight * (1 - 2 * SAFE_MARGIN);
    let scale = availableHeight / STAGE_HEIGHT;
    let width = availableWidth / scale;
    if (width < STAGE_MIN_WIDTH) {
        width = STAGE_MIN_WIDTH;
        scale = availableWidth / STAGE_MIN_WIDTH;
    }
    width = Math.min(width, STAGE_MAX_WIDTH);
    const offsetX = (innerWidth - width * scale) / 2;
    const offsetY = (innerHeight - STAGE_HEIGHT * scale) / 2;
    stage.style.width = `${width}px`;
    stage.style.height = `${STAGE_HEIGHT}px`;
    stage.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
    fitEverything();
}

function fits(el, size) {
    // Letters may poke a few px outside tight line boxes; that isn't real overflow.
    const slack = Math.ceil(size * TEXT_SCALE * 0.15);
    return el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + slack;
}

// Binary search for the biggest font size (between min and max) at which el fits its box.
function largestFit(el, max, min) {
    let lo = min;
    let hi = max;
    let best = min;
    while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        el.style.fontSize = `${mid}px`;
        if (fits(el, mid)) {
            best = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return best;
}

// While the TV browser is in the background (e.g. Fire TV screensaver) the window can report
// tiny or zero sizes; measuring then would shrink everything to the minimum. Skip it — the
// visibility listener and the 5-minute timer below measure again once the board is back.
function canMeasure() {
    const promo = boardContainer.querySelector('.promo-card');
    return innerWidth > 200 && innerHeight > 150 && promo && promo.offsetWidth > 50 && promo.offsetHeight > 50;
}

function contentSignature() {
    return [innerWidth, innerHeight, I18N.lang,
        ...allDoctorsList.map((d) => `${d.displayName}|${d.specialty}|${d.officeNumber}`)].join('~');
}

// A hidden card with exactly the size of a real card (the promo card always has it).
function probeCard() {
    let probe = boardContainer.querySelector('.fit-probe');
    if (!probe) {
        probe = document.createElement('div');
        probe.className = 'doctor-card status-available fit-probe';
        probe.setAttribute('aria-hidden', 'true');
        boardContainer.appendChild(probe);
    }
    const promo = boardContainer.querySelector('.promo-card');
    probe.style.width = `${promo.offsetWidth}px`;
    probe.style.height = `${promo.offsetHeight}px`;
    return probe;
}

function fitUniformSizes() {
    if (LAYOUT !== 'auto') return;
    if (!canMeasure()) return;   // retried on visibility change, resize and every 5 minutes

    const probe = probeCard();
    const doctors = allDoctorsList.length ? allDoctorsList : [{}];
    const samples = {
        name: doctors.map((d) => nameHtml(d.displayName || t('unnamedDoctor'))),
        specialty: doctors.map((d) => escapeHtml(d.specialty || t('noSpecialty'))),
        status: Object.values(STATUS_KEYS).map((key) => escapeHtml(t(key))),
        // Worst cases, so the size doesn't jump when a patient is called.
        info: [
            `<strong>${escapeHtml(t('officeLabel'))}</strong> 00`,
            `<strong>${escapeHtml(t('currentLabel'))}</strong> MMM (12:00 PM)`,
            ...doctors.map((d) => `<strong>${escapeHtml(t('officeLabel'))}</strong> ${escapeHtml(d.officeNumber || t('notApplicable'))}`)
        ]
    };

    probe.innerHTML = cardInnerHtml(doctors[0]);
    const root = document.documentElement;
    Object.entries(CARD_FIELDS).forEach(([field, rule]) => {
        const el = probe.querySelector(rule.selector);
        // Sizes are given as they should LOOK; divide by the browser's text scale to get the
        // CSS size that produces them.
        const min = cssSize(rule.min);
        let size = cssSize(rule.max);
        for (const html of samples[field]) {
            el.innerHTML = html;
            size = Math.min(size, largestFit(el, size, min));
        }
        root.style.setProperty(rule.variable, `${size}px`);
    });

    lastFitSignature = contentSignature();
    boardContainer.querySelectorAll('.doctor-card[data-id]').forEach(guardCard);
}

// Safety net for a value longer than the worst case (e.g. a very long "Actual"): only that
// element shrinks; everything else keeps the shared size.
function guardCard(card) {
    if (LAYOUT !== 'auto') return;
    const root = getComputedStyle(document.documentElement);
    Object.values(CARD_FIELDS).forEach((rule) => {
        // The shared CSS size (not the computed one, which may already include the text zoom).
        const shared = parseFloat(root.getPropertyValue(rule.variable)) || cssSize(rule.max);
        card.querySelectorAll(rule.selector).forEach((el) => {
            el.style.fontSize = '';
            if (!fits(el, shared)) el.style.fontSize = `${largestFit(el, shared, cssSize(rule.min))}px`;
        });
    });
}

// A size meant to be SEEN, converted to the CSS size that shows it at that size here.
function cssSize(visibleSize) {
    return Math.round(visibleSize / TEXT_SCALE);
}

function fitSingles() {
    SINGLE_FITS.forEach(([selector, max, min]) => {
        const el = document.querySelector(selector);
        if (el) el.style.fontSize = `${largestFit(el, cssSize(max), cssSize(min))}px`;
    });
    // The clock is measured with its widest possible text so it never changes size.
    const clock = document.getElementById('clock-display');
    const shown = clock.textContent;
    clock.textContent = new Date(2020, 0, 1, 12, 58).toLocaleTimeString(t('clockLocale'), { hour: '2-digit', minute: '2-digit', hour12: true });
    clock.style.fontSize = `${largestFit(clock, cssSize(CLOCK_TARGET), cssSize(30))}px`;
    clock.textContent = shown;
}

function fitEverything() {
    if (LAYOUT !== 'auto' || !canMeasure()) return;
    fitSingles();
    fitUniformSizes();
}

let resizeTimer = null;
addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(fitStage, 150);
});
// Coming back from the screensaver / another app: measure again.
document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(fitStage, 300); });
// Safety net: re-measure every 5 minutes (cheap, and fixes any missed event).
setInterval(fitStage, 5 * 60 * 1000);

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
            `layout: ${LAYOUT}${IS_FIRE_TV ? ' (Fire TV detected)' : ''}   margin: ${Math.round(SAFE_MARGIN * 100)}%`,
            `text scale: ${TEXT_SCALE.toFixed(2)} (1.00 = the browser draws text at the requested size)`,
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
