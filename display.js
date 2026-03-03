// STEP 1: Paste your Firebase config object here
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
const db = firebase.firestore();

// STEP 3: Get references
const boardContainer = document.getElementById('board-container');
const mainTitleElement = document.getElementById('main-title-h1');
const footerMessageElement = document.getElementById('footer-message');
const clockElement = document.getElementById('clock-display');

// --- PROMO SYSTEM VARIABLES ---
let promoTimer = null;
let currentPromoIndex = 0;
let promoPlaylist = []; 
const PROMO_FOLDER_PATH = 'promos/'; 

// --- PAGINATION VARIABLES (NEW) ---
let allDoctorsList = []; // Stores ALL doctors from DB
let currentPageIndex = 0;
let pageRotationTimer = null;
let pageDurationMs = 15000; // Default 15 seconds (overridden by settings)
const DOCTORS_PER_PAGE = 7; // 4x2 grid = 8 slots. 7 Doctors + 1 Promo.

// --- Global variables ---
let useCardView = true; 
let i18n = {}; 
let allTexts = {}; 
let previousDoctorStates = {}; 
const alertSound = new Audio('beep.mp3'); 

/**
 * Fetches all text strings from the JSON file.
 */
async function fetchTexts() {
    try {
        const response = await fetch('texts.json');
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        allTexts = await response.json();
    } catch (error) {
        console.error("Error fetching texts.json:", error);
        allTexts = {
            EN: { global: { mainTitle: "Doctor Appointments" } },
            ES: { global: { mainTitle: "Citas Médicas" } }
        };
    }
}

/**
 * Initialize Display
 */
async function initializeDisplay() {
    await fetchTexts();
    
    // 1. Load Promos FIRST
    await loadPromoPlaylist();

    let lang = "EN"; 
    try {
        const docRef = db.collection("settings").doc("displayConfig");
        const docSnap = await docRef.get();
        if (docSnap.exists) {
            const settings = docSnap.data();
            useCardView = settings.card_view === true;
            lang = settings.language || "EN";
            
            // FETCH PAGE DURATION (NEW)
            if (settings.cardDisplayTime) {
                // Settings is usually in seconds (e.g., 30), convert to ms
                pageDurationMs = settings.cardDisplayTime * 1000;
                console.log(`Page rotation set to: ${pageDurationMs}ms`);
            }
        }
    } catch (error) { console.error("Error fetching settings:", error); }

    i18n = allTexts[lang.toUpperCase()] || allTexts.EN;
    applyStaticTexts();
    startClock(); 
    
    // Start listening (this triggers the first render)
    listenForDoctorUpdates();
}

function applyStaticTexts() {
    if (mainTitleElement && i18n.global) mainTitleElement.textContent = i18n.global.mainTitle || "Doctor Appointments";
    if (footerMessageElement && i18n.global) footerMessageElement.textContent = i18n.global.footerMessage || "";
    document.title = i18n.global?.mainTitle || "Doctor Status Board";
}

async function loadPromoPlaylist() {
    try {
        const response = await fetch(`${PROMO_FOLDER_PATH}playlist.json`);
        if (response.ok) {
            const files = await response.json();
            promoPlaylist = files.map(filename => ({
                type: filename.endsWith('.mp4') ? 'video' : 'image',
                url: `${PROMO_FOLDER_PATH}${filename}`
            }));
            console.log("Promos loaded:", promoPlaylist);
        } else {
            console.warn("Could not load playlist.json");
        }
    } catch (e) {
        console.error("Error loading promos:", e);
    }
}

function startClock() {
    const clockEl = document.getElementById('clock-display');
    function update() {
        if (!clockEl) return;
        const now = new Date();
        const timeString = now.toLocaleTimeString("en-US", {
            timeZone: "America/Mexico_City",
            hour: "2-digit", minute: "2-digit", hour12: true
        });
        clockEl.textContent = timeString; 
    }
    update(); 
    setInterval(update, 1000); 
}

function applyLayoutClass() {
    boardContainer.classList.remove('card-layout', 'row-layout');
    boardContainer.classList.add(useCardView ? 'card-layout' : 'row-layout');
}

// --- MAIN LOGIC ---

function listenForDoctorUpdates() {
    boardContainer.innerHTML = `<p class="loading-message">${i18n.global?.loading || 'Loading...'}</p>`;

    db.collection('doctors').onSnapshot(snapshot => {
        applyLayoutClass();
        
        // 1. Store ALL doctors in a global list (don't render yet)
        allDoctorsList = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.hide !== true) allDoctorsList.push({ id: doc.id, ...data });
        });

        // 2. Sort the full list
        allDoctorsList.sort((a, b) => {
            const numA = parseInt(a.officeNumber) || 9999;
            const numB = parseInt(b.officeNumber) || 9999;
            return numA - numB; 
        });

        // 3. Render the CURRENT page immediately (so we don't wait for timer)
        renderCurrentPage();

        // 4. Start (or Restart) the Page Rotation Timer
        startPageRotation();

    }, error => console.error("Error fetching data:", error));
}

function startPageRotation() {
    if (pageRotationTimer) clearInterval(pageRotationTimer);
    
    // Only rotate if we have more doctors than fit on one page
    if (allDoctorsList.length > DOCTORS_PER_PAGE) {
        pageRotationTimer = setInterval(() => {
            // Go to next page
            currentPageIndex++;
            
            // Calculate if we went past the end
            const totalPages = Math.ceil(allDoctorsList.length / DOCTORS_PER_PAGE);
            if (currentPageIndex >= totalPages) {
                currentPageIndex = 0; // Loop back to start
            }
            
            renderCurrentPage();
            
        }, pageDurationMs);
    }
}

function renderCurrentPage() {
    boardContainer.innerHTML = ''; 

    // Calculate Slice
    const start = currentPageIndex * DOCTORS_PER_PAGE;
    const end = start + DOCTORS_PER_PAGE;
    
    // Get just the 7 doctors for this page
    const pageDoctors = allDoctorsList.slice(start, end);

    const itemsHtmlArray = [];
    let shouldPlaySound = false;

    pageDoctors.forEach(doctor => {
        const doctorId = doctor.id;
        const rawStatus = doctor.status || '';
        const lowerCaseStatus = rawStatus.toLowerCase();
        let statusClass = 'status-available';

        if (lowerCaseStatus === 'available') statusClass = 'status-available';
        else if (lowerCaseStatus === 'in consultation') statusClass = 'status-in-consultation';
        else if (lowerCaseStatus === 'consultation delayed') statusClass = 'status-consultation-delayed';
        else if (lowerCaseStatus === 'not available') statusClass = 'status-not-available';

        let displayStatus = rawStatus || i18n.global?.noStatus;
        if (lowerCaseStatus === 'available') displayStatus = i18n.global?.statusAvailable || "Available";
        else if (lowerCaseStatus === 'in consultation') displayStatus = i18n.global?.statusInConsultation || "In Consultation";
        else if (lowerCaseStatus === 'consultation delayed') displayStatus = i18n.global?.statusDelayed || "Delayed";
        else if (lowerCaseStatus === 'not available') displayStatus = i18n.global?.statusNotAvailable || "Not Available";

        let displayCurrent = doctor.displayCurrentAppointment || '---';
        let flashClass = '';
        const currentCallTrigger = doctor.callAgainTrigger || 0;

        if (previousDoctorStates[doctorId]) {
            const prev = previousDoctorStates[doctorId];
            if (lowerCaseStatus === 'in consultation') {
                if (prev.status !== 'in consultation' || prev.current !== displayCurrent || prev.lastTrigger !== currentCallTrigger) { 
                    flashClass = 'card-flash';
                    shouldPlaySound = true;
                }
            }
        }
        previousDoctorStates[doctorId] = { status: lowerCaseStatus, current: displayCurrent, lastTrigger: currentCallTrigger };

        let itemHtml = '';
        if (useCardView) {
            itemHtml = `
                <div class="doctor-card ${statusClass} ${flashClass}" data-id="${doctorId}">
                    <h2>${doctor.displayName || i18n.global?.unnamedDoctor}</h2>
                    <p class="specialty">${doctor.specialty || i18n.global?.noSpecialty}</p>
                    <p class="status ${statusClass}">${displayStatus}</p>
                    <div class="appointment-info">
                        <strong>${i18n.global?.officeLabel}</strong> ${doctor.officeNumber || i18n.global?.notApplicable}
                    </div>
                    <div class="appointment-info">
                        <strong>${i18n.global?.currentLabel}</strong> ${displayCurrent}
                    </div>
                </div>`;
        }
        itemsHtmlArray.push(itemHtml);
    });

    // --- ALWAYS RENDER PROMO CARD (Last item) ---
    if (useCardView) {
        const promoCardHtml = `
            <div class="doctor-card promo-card">
                <img id="promo-img-element" class="promo-content" src="" alt="Info">
                <video id="promo-video-element" class="promo-content" muted playsinline></video>
            </div>`;
        itemsHtmlArray.push(promoCardHtml);
    }

    boardContainer.innerHTML = itemsHtmlArray.join('');

    if (shouldPlaySound) alertSound.play().catch(e => console.log("Audio blocked:", e));
    
    // Ensure rotation is running
    if (promoPlaylist.length > 0) startPromoRotation();
}

function startPromoRotation() {
    if (promoTimer) clearInterval(promoTimer);

    // We must re-select elements because the HTML was just wiped and replaced
    const imgEl = document.getElementById('promo-img-element');
    const vidEl = document.getElementById('promo-video-element');
    
    if (!imgEl || !vidEl || promoPlaylist.length === 0) return;

    function showCurrentPromo() {
        const promo = promoPlaylist[currentPromoIndex];
        
        imgEl.classList.remove('active');
        vidEl.classList.remove('active');
        vidEl.pause();

        if (promo.type === 'video') {
            vidEl.src = promo.url;
            vidEl.classList.add('active');
            vidEl.play().catch(e => console.log("Video autoplay blocked:", e));
        } else {
            imgEl.src = promo.url;
            imgEl.classList.add('active');
        }
        currentPromoIndex = (currentPromoIndex + 1) % promoPlaylist.length;
    }

    showCurrentPromo();
    promoTimer = setInterval(showCurrentPromo, 30000); 
}

initializeDisplay();