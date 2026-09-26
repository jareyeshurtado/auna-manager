const { setGlobalOptions } = require("firebase-functions/v2");
const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentCreated, onDocumentDeleted, onDocumentUpdated, onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");

admin.initializeApp();
const db = admin.firestore();

setGlobalOptions({ region: "us-central1", timeoutSeconds: 120 });

const TZ = "America/Mexico_City";
const IS_EMULATOR = process.env.FUNCTIONS_EMULATOR === "true";
const ADMIN_URL = "https://aunaconsultorios.online/admin.html";

// Appointment lifecycle. A missing status means "scheduled".
const INACTIVE_STATUSES = ["cancelled", "completed", "no-show"];
const isActiveAppt = (appt) => !INACTIVE_STATUSES.includes(appt.status);

// Fields the TV board is allowed to see. Everything else in doctors/{id} stays private.
const BOARD_FIELDS = ["displayName", "specialty", "officeNumber", "status", "displayCurrentAppointment", "callAgainTrigger", "hide"];

// ==================================================================
// HELPERS
// ==================================================================
function fmtDate(iso) {
    return new Date(iso).toLocaleDateString("es-MX", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
}

function fmtTime(iso) {
    return new Date(iso).toLocaleTimeString("es-MX", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
}

// appointments.doctorId holds the doctor's Auth UID; older code sometimes passed the doc id.
async function findDoctor(doctorId) {
    if (!doctorId) return null;
    const doc = await db.collection("doctors").doc(doctorId).get();
    if (doc.exists) return { ref: doc.ref, data: doc.data() };
    const q = await db.collection("doctors").where("authUID", "==", doctorId).limit(1).get();
    return q.empty ? null : { ref: q.docs[0].ref, data: q.docs[0].data() };
}

// Per-run memo so a cron touching 30 appointments doesn't read the same doctor 30 times.
function doctorCache() {
    const cache = new Map();
    return (doctorId) => {
        if (!cache.has(doctorId)) cache.set(doctorId, findDoctor(doctorId));
        return cache.get(doctorId);
    };
}

const DEAD_TOKEN_CODES = ["messaging/registration-token-not-registered", "messaging/invalid-registration-token"];

// Sends a push to every device the doctor enabled, and forgets devices that no longer exist.
async function notifyDoctor(doctor, title, body, data = {}) {
    if (!doctor) return;
    const tokens = [...new Set([...(doctor.data.fcmTokens || []), doctor.data.fcmToken].filter(Boolean))];
    if (tokens.length === 0) return;

    if (IS_EMULATOR) {
        logger.info(`[emulator] push to ${tokens.length} device(s): ${title} — ${body}`);
        return;
    }

    const stringData = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]));
    const response = await admin.messaging().sendEachForMulticast({
        tokens,
        notification: { title, body },
        data: stringData,
        android: { priority: "high", notification: { sound: "default", channelId: "default", defaultSound: true } },
        apns: { payload: { aps: { sound: "default" } } },
        webpush: { headers: { Urgency: "high" }, fcmOptions: { link: ADMIN_URL } }
    });

    const dead = [];
    response.responses.forEach((r, i) => {
        if (!r.success && DEAD_TOKEN_CODES.includes(r.error?.code)) dead.push(tokens[i]);
    });
    if (dead.length) {
        const update = { fcmTokens: FieldValue.arrayRemove(...dead) };
        if (dead.includes(doctor.data.fcmToken)) update.fcmToken = FieldValue.delete();
        await doctor.ref.update(update);
        logger.info(`Removed ${dead.length} dead push token(s)`);
    }
}

async function releaseSlotLocks(apptId) {
    const locks = await db.collection("slotLocks").where("apptId", "==", apptId).get();
    if (locks.empty) return;
    const batch = db.batch();
    locks.forEach((l) => batch.delete(l.ref));
    await batch.commit();
}

// ==================================================================
// 1. CALENDAR FEED (Google/Outlook/Apple subscription)
// Each doctor has a random secret token in calendarFeeds/{authUID}.
// ==================================================================
function icsEscape(text) {
    return String(text || "")
        .replace(/\\/g, "\\\\")
        .replace(/;/g, "\\;")
        .replace(/,/g, "\\,")
        .replace(/\r?\n/g, "\\n");
}

// RFC 5545: lines longer than 75 octets must be folded.
function icsFold(line) {
    const parts = [];
    let rest = line;
    while (rest.length > 74) {
        parts.push(rest.slice(0, 74));
        rest = " " + rest.slice(74);
    }
    parts.push(rest);
    return parts.join("\r\n");
}

function icsDate(value) {
    return new Date(value).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function sendIcs(res, lines) {
    res.set("Content-Type", "text/calendar; charset=utf-8");
    res.set("Content-Disposition", "attachment; filename=\"citas-auna.ics\"");
    res.set("Cache-Control", "private, max-age=300");
    res.send(lines.map(icsFold).join("\r\n"));
}

function icsHeader(name) {
    return [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//AUNA//Doctor Board//ES",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        `X-WR-CALNAME:${icsEscape(name)}`,
        `X-WR-TIMEZONE:${TZ}`
    ];
}

// Old links (?uid=...) and regenerated tokens get a single explanatory event instead of data.
function sendExpiredFeed(res) {
    const now = new Date();
    const day = now.toLocaleDateString("en-CA", { timeZone: TZ }).replace(/-/g, "");
    const lines = icsHeader("AUNA Citas (enlace caducado)");
    lines.push(
        "BEGIN:VEVENT",
        `UID:expired-${day}@auna-board.web.app`,
        `DTSTAMP:${icsDate(now)}`,
        `DTSTART;VALUE=DATE:${day}`,
        `SUMMARY:${icsEscape("Enlace de calendario AUNA caducado: genera uno nuevo en AUNA > Ajustes")}`,
        "END:VEVENT",
        "END:VCALENDAR"
    );
    sendIcs(res, lines);
}

exports.calendarFeed = onRequest(async (req, res) => {
    const token = String(req.query.token || "");
    if (!/^[a-f0-9]{32,128}$/.test(token)) {
        sendExpiredFeed(res);
        return;
    }

    try {
        const feed = await db.collection("calendarFeeds").where("token", "==", token).limit(1).get();
        if (feed.empty) {
            sendExpiredFeed(res);
            return;
        }
        const doctorUid = feed.docs[0].id;

        const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const snapshot = await db.collection("appointments")
            .where("doctorId", "==", doctorUid)
            .where("start", ">=", since.toISOString())
            .get();

        const lines = icsHeader("AUNA Citas");
        snapshot.forEach((doc) => {
            const data = doc.data();
            const cancelled = data.status === "cancelled";
            let summary = `Cita: ${data.patientName}`;
            if (data.status === "completed") summary = `[Completada] ${summary}`;
            if (cancelled) summary = `[Cancelada] ${summary}`;
            const stamp = data.updatedAt?.toDate?.() || data.createdAt?.toDate?.() || new Date();

            lines.push(
                "BEGIN:VEVENT",
                `UID:${doc.id}@auna-board.web.app`,
                `DTSTAMP:${icsDate(stamp)}`,
                `DTSTART:${icsDate(data.start)}`,
                `DTEND:${icsDate(data.end)}`,
                `SUMMARY:${icsEscape(summary)}`,
                `DESCRIPTION:${icsEscape(`Paciente: ${data.patientName}\nTel: ${data.patientPhone || "N/A"}`)}`,
                `STATUS:${cancelled ? "CANCELLED" : "CONFIRMED"}`,
                "END:VEVENT"
            );
        });
        lines.push("END:VCALENDAR");
        sendIcs(res, lines);
    } catch (error) {
        logger.error("Error generating calendar:", error);
        res.status(500).send("Internal Server Error");
    }
});

// ==================================================================
// 2. TV BOARD MIRROR
// The TV reads the public board/{doctorDocId} collection; doctors/{id} is private.
// ==================================================================
function boardDataFrom(doctor) {
    const out = {};
    BOARD_FIELDS.forEach((k) => { if (doctor[k] !== undefined) out[k] = doctor[k]; });
    return out;
}

function sameBoardData(a, b) {
    return BOARD_FIELDS.every((k) => JSON.stringify(a?.[k]) === JSON.stringify(b?.[k]));
}

exports.syncBoard = onDocumentWritten("doctors/{docId}", async (event) => {
    const doctorRef = db.collection("doctors").doc(event.params.docId);
    const boardRef = db.collection("board").doc(event.params.docId);

    // Triggers can arrive out of order ("start" then "finish" a second later). Reading the doctor
    // inside a transaction means the board always ends up matching the latest committed state.
    await db.runTransaction(async (t) => {
        const [doctorSnap, boardSnap] = await Promise.all([t.get(doctorRef), t.get(boardRef)]);
        if (!doctorSnap.exists) {
            if (boardSnap.exists) t.delete(boardRef);
            return;
        }
        const next = boardDataFrom(doctorSnap.data());
        if (boardSnap.exists && sameBoardData(boardSnap.data(), next)) return;
        t.set(boardRef, { ...next, updatedAt: FieldValue.serverTimestamp() });
    });
});

// Safety net (and first-time backfill): reconcile the whole board every 10 minutes.
exports.reconcileBoard = onSchedule({ schedule: "every 10 minutes", timeZone: TZ }, async () => {
    const [doctors, board] = await Promise.all([db.collection("doctors").get(), db.collection("board").get()]);
    const boardById = new Map(board.docs.map((d) => [d.id, d.data()]));
    const batch = db.batch();
    let writes = 0;

    doctors.forEach((doc) => {
        const next = boardDataFrom(doc.data());
        if (!sameBoardData(boardById.get(doc.id), next)) {
            batch.set(db.collection("board").doc(doc.id), { ...next, updatedAt: FieldValue.serverTimestamp() });
            writes++;
        }
        boardById.delete(doc.id);
    });
    boardById.forEach((_, id) => { batch.delete(db.collection("board").doc(id)); writes++; });

    if (writes) {
        await batch.commit();
        logger.info(`Board reconciled: ${writes} change(s)`);
    }
});

// ==================================================================
// 3. APPOINTMENT NOTIFICATIONS (push to the doctor's devices)
// ==================================================================
exports.sendAppointmentNotification = onDocumentCreated("appointments/{apptId}", async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;
    const data = snapshot.data();

    try {
        const doctor = await findDoctor(data.doctorId);
        if (!doctor) return;
        const prefs = doctor.data.notificationSettings || {};
        if (prefs.newAppt === false) return;

        const byReception = data.createdByRole === "staff" ? " (agendada por recepción)" : "";
        await notifyDoctor(doctor,
            "📅 Nueva Cita Agendada",
            `Paciente: ${data.patientName}\nCuándo: ${fmtDate(data.start)} a las ${fmtTime(data.start)}${byReception}`,
            { appointmentId: event.params.apptId });
    } catch (error) {
        logger.error("Error sending new-appointment notification:", error);
    }
});

// Cancelled from the app (by reception or the doctor): free the slot and tell the doctor.
exports.onAppointmentUpdated = onDocumentUpdated("appointments/{apptId}", async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();
    if (before.status === "cancelled" || after.status !== "cancelled") return;

    try {
        await releaseSlotLocks(event.params.apptId);
        if (new Date(after.start).getTime() < Date.now()) return;

        const doctor = await findDoctor(after.doctorId);
        if (!doctor) return;
        if (after.cancelledBy && after.cancelledBy === doctor.data.authUID) return; // they did it themselves
        const prefs = doctor.data.notificationSettings || {};
        if (prefs.cancelAppt === false) return;

        await notifyDoctor(doctor, "❌ Cita Cancelada",
            `${after.patientName} — cita del ${fmtDate(after.start)} a las ${fmtTime(after.start)}.${after.cancelReason ? " Motivo: " + after.cancelReason : ""}`,
            { appointmentId: event.params.apptId });
    } catch (error) {
        logger.error("Error handling appointment cancellation:", error);
    }
});

exports.sendCancellationNotification = onDocumentDeleted("appointments/{apptId}", async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;
    const data = snapshot.data();

    try {
        await releaseSlotLocks(event.params.apptId);
        // Already-cancelled appointments were notified when they were cancelled.
        if (!isActiveAppt(data) || new Date(data.start).getTime() < Date.now()) return;

        const doctor = await findDoctor(data.doctorId);
        if (!doctor) return;
        const prefs = doctor.data.notificationSettings || {};
        if (prefs.cancelAppt === false) return;

        await notifyDoctor(doctor, "❌ Cita Eliminada",
            `${data.patientName} — cita del ${fmtDate(data.start)} a las ${fmtTime(data.start)}.`);
    } catch (e) {
        logger.error("Error handling appointment deletion:", e);
    }
});

// ==================================================================
// 4. DOCTOR REMINDERS (every 5 minutes)
// ==================================================================
exports.sendAppointmentReminders = onSchedule({ schedule: "*/5 * * * *", timeZone: TZ }, async () => {
    const now = new Date();
    const lookAhead = new Date(now.getTime() + 150 * 60000); // max reminder is 2h
    const getDoctor = doctorCache();

    try {
        const query = await db.collection("appointments")
            .where("start", ">=", now.toISOString())
            .where("start", "<=", lookAhead.toISOString())
            .get();

        await Promise.all(query.docs.map(async (apptDoc) => {
            const appt = apptDoc.data();
            if (appt.reminderSent === true || !isActiveAppt(appt)) return;

            const doctor = await getDoctor(appt.doctorId);
            if (!doctor) return;
            const prefs = doctor.data.notificationSettings || {};
            if (!prefs.reminderEnabled || !prefs.reminderMinutes) return;

            const diffMinutes = (new Date(appt.start).getTime() - now.getTime()) / 60000;
            // "<= target" (not a 5-minute window) so a skipped or late cron run still sends it.
            if (diffMinutes > prefs.reminderMinutes) return;

            await apptDoc.ref.update({ reminderSent: true });
            await notifyDoctor(doctor, "⏰ Recordatorio de Cita",
                `En ${Math.max(1, Math.round(diffMinutes))} min: ${appt.patientName} (${fmtTime(appt.start)})`,
                { appointmentId: apptDoc.id });
        }));
    } catch (error) {
        logger.error("Error in reminder cron:", error);
    }
});

// ==================================================================
// 5. NIGHTLY MAINTENANCE (03:00 Mexico City): past slot locks are no longer useful.
// ==================================================================
exports.dailyMaintenance = onSchedule({ schedule: "0 3 * * *", timeZone: TZ }, async () => {
    const cutoff = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    let deleted = 0;
    for (;;) {
        const snap = await db.collection("slotLocks").where("start", "<", cutoff).limit(400).get();
        if (snap.empty) break;
        const batch = db.batch();
        snap.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        deleted += snap.size;
    }
    logger.info(`Maintenance: deleted ${deleted} old slot lock(s).`);
});
