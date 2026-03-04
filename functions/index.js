const { setGlobalOptions } = require("firebase-functions/v2");
const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentCreated, onDocumentDeleted } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { OpenAI } = require("openai");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

// Set global options to reduce latency
setGlobalOptions({ region: "us-central1", timeoutSeconds: 540 });

async function getDoctorData(doctorId) {
    let doc = await db.collection('doctors').doc(doctorId).get();
    if (doc.exists) return doc.data();
    let q2 = await db.collection('doctors').where('authUID', '==', doctorId).limit(1).get();
    return q2.empty ? null : q2.docs[0].data();
}
// ==================================================================
// 1. CALENDAR FEED (For Google/Outlook/Apple Sync)
// ==================================================================
exports.calendarFeed = onRequest(async (req, res) => {
    const doctorUid = req.query.uid;

    if (!doctorUid) {
        res.status(400).send("Missing 'uid' parameter.");
        return;
    }

    try {
        const now = new Date();
        const pastDate = new Date();
        pastDate.setDate(now.getDate() - 7); 

        const snapshot = await db.collection("appointments")
            .where("doctorId", "==", doctorUid)
            .where("start", ">=", pastDate.toISOString())
            .get();

        let icsContent = [
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "PRODID:-//AUNA//Doctor Board//EN",
            "CALSCALE:GREGORIAN",
            "METHOD:PUBLISH",
            "X-WR-CALNAME:AUNA Citas",  
            "X-WR-TIMEZONE:America/Mexico_City"
        ];

        snapshot.forEach(doc => {
            const data = doc.data();
            const created = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
            const start = new Date(data.start).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
            const end = new Date(data.end).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

            let description = `Paciente: ${data.patientName}\\nTel: ${data.patientPhone || 'N/A'}`;
            let summary = `Cita: ${data.patientName}`;
            if (data.status === 'completed') summary = `[Completed] ${summary}`;
            
            icsContent.push("BEGIN:VEVENT");
            icsContent.push(`UID:${doc.id}@auna-board.web.app`);
            icsContent.push(`DTSTAMP:${created}`);
            icsContent.push(`DTSTART:${start}`);
            icsContent.push(`DTEND:${end}`);
            icsContent.push(`SUMMARY:${summary}`);
            icsContent.push(`DESCRIPTION:${description}`);
            icsContent.push("STATUS:CONFIRMED");
            icsContent.push("END:VEVENT");
        });

        icsContent.push("END:VCALENDAR");

        res.set("Content-Type", "text/calendar; charset=utf-8");
        res.set("Content-Disposition", "attachment; filename=\"citas-auna.ics\"");
        res.send(icsContent.join("\r\n"));

    } catch (error) {
        console.error("Error generating calendar:", error);
        res.status(500).send("Internal Server Error");
    }
});

// ==================================================================
// 2. NEW APPOINTMENT NOTIFICATION (Instant Push)
// ==================================================================
exports.sendAppointmentNotification = onDocumentCreated("appointments/{apptId}", async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;

    const data = snapshot.data();
    const doctorId = data.doctorId; // This is the Auth UID (e.g., Q4W...)
    
    if (!doctorId) return;

    try {
        let docData = await getDoctorData(doctorId);
        if (!docData) {
            console.log(`Doctor ID ${doctorId} not found.`);
            return;
        }
        
        let fcmToken = docData.fcmToken;
        let prefs = docData.notificationSettings || {};

        // CHECK PREFERENCE: New Appointment
        // Default to TRUE if setting is missing
        if (prefs.newAppt === false) {
            console.log(`Doctor ${doctorId} has disabled New Appointment alerts.`);
            return;
        }

        if (!fcmToken) {
            console.log(`No token found for Doctor ID: ${doctorId}.`);
            return;
        }

        // --- NEW: Clean Date Formatting ---
        const dateObj = new Date(data.start);
        const dateStr = dateObj.toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City', weekday: 'short', day: 'numeric', month: 'short' });
        const timeStr = dateObj.toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit' });

        // Create the Message
        const message = {
            token: fcmToken,
            notification: {
                title: '📅 Nueva Cita Agendada',
                body: `Paciente: ${data.patientName}\nCuándo: ${dateStr} a las ${timeStr}`
            },
            android: {
                priority: 'high',
                notification: { sound: 'default', channelId: 'default', priority: 'high', defaultSound: true }
            },
            apns: { payload: { aps: { sound: 'default', contentAvailable: true } } },
            webpush: { headers: { Urgency: "high" } },
            data: { appointmentId: event.params.apptId }
        };

        const response = await admin.messaging().send(message);
        console.log('Successfully sent message:', response);

    } catch (error) {
        console.error('Error sending notification:', error);
    }
});

// ==================================================================
// 3. CANCELLATION NOTIFICATION (Bonus Feature)
// ==================================================================
// ==================================================================
// 3. CANCELLATION NOTIFICATION (Updated with Smart Search)
// ==================================================================
exports.sendCancellationNotification = onDocumentDeleted("appointments/{apptId}", async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;
    const data = snapshot.data();
    
    // Don't send alert for past appointments
    if (new Date(data.start).getTime() < Date.now()) return;

    try {
        const doctorId = data.doctorId;
        let docData = await getDoctorData(doctorId);
        if (!docData) return;
        
        // CHECK PREFERENCE
        const prefs = docData.notificationSettings || {};
        if (prefs.cancelAppt === false) return; 

        // --- NEW: Clean Date Formatting ---
        const dateObj = new Date(data.start);
        const dateStr = dateObj.toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City', weekday: 'short', day: 'numeric', month: 'short' });
        const timeStr = dateObj.toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit' });

        if (docData.fcmToken) {
             const message = {
                token: docData.fcmToken,
                notification: {
                    title: '❌ Cita Cancelada',
                    body: `${data.patientName} canceló su cita del ${dateStr} a las ${timeStr}.`
                },
                android: { priority: 'high', notification: { sound: 'default' } },
                webpush: { headers: { Urgency: "high" } } 
            };
            await admin.messaging().send(message);
        }
    } catch(e) { console.error(e); }
});

// ==================================================================
// 4. THE CRON JOB (Reminders) - Runs every 5 minutes
// ==================================================================
exports.sendAppointmentReminders = onSchedule("*/5 * * * *", async (event) => {
    const now = new Date();
    // Look ahead 2.5 hours max
    const lookAhead = new Date(now.getTime() + (150 * 60000)); 

    try {
        // FIX: Removed the '!=' filter to stop Firestore from crashing
        const query = await db.collection('appointments')
            .where('start', '>=', now.toISOString())
            .where('start', '<=', lookAhead.toISOString())
            .get();

        if (query.empty) return;

        // 2. Loop through appointments
        const promises = query.docs.map(async (apptDoc) => {
            const appt = apptDoc.data();
            
            // FIX: Check reminderSent manually in JavaScript instead!
            if (appt.reminderSent === true) return; 

            const doctorId = appt.doctorId;

            // 3. Get Doctor Settings
            let docData = await getDoctorData(doctorId);
            if (!docData) return;
            
            const prefs = docData.notificationSettings || {};
            let fcmToken = docData.fcmToken;

            if (!prefs.reminderEnabled || !prefs.reminderMinutes || !fcmToken) return;

            const start = new Date(appt.start).getTime();
            const diffMinutes = (start - now.getTime()) / 60000;
            const targetMinutes = prefs.reminderMinutes;

            if (diffMinutes <= targetMinutes && diffMinutes > (targetMinutes - 5)) {
                
                // --- NEW: Add the exact time to the reminder ---
                const timeStr = new Date(appt.start).toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit' });

                const message = {
                    token: fcmToken,
                    notification: {
                        title: '⏰ Recordatorio de Cita',
                        body: `En ${Math.round(diffMinutes)} mins: ${appt.patientName} (${timeStr})`
                    },
                    android: { priority: 'high', notification: { sound: 'default' } },
                    webpush: { headers: { Urgency: "high" } } 
                };
                
                await admin.messaging().send(message);

                await db.collection('appointments').doc(apptDoc.id).update({
                    reminderSent: true
                });
                
                console.log(`Reminder sent to doctor ${doctorId} for appt ${apptDoc.id}`);
            }
        });

        await Promise.all(promises);

    } catch (error) {
        console.error("Error in reminder cron:", error);
    }
});
// ==================================================================
// 5. WHATSAPP CONFIRMATION CRON JOB (Anti-Ban & Sweeping Radar)
// Runs every 5 minutes. Sweeps from 2 to 26 hours ahead.
// ==================================================================
exports.sendWhatsappConfirmations = onSchedule("*/5 * * * *", async (event) => {
    const idInstance = process.env.GREEN_API_ID;
    const apiTokenInstance = process.env.GREEN_API_TOKEN;
    const apiUrl = `https://api.greenapi.com/waInstance${idInstance}/sendMessage/${apiTokenInstance}`;

    const now = new Date();
    
    // Sweeping Radar: Look up to 36 hours ahead to make sure we grab everything
    const endWindow = new Date(now.getTime() + (36 * 60 * 60 * 1000));

    try {
        const query = await db.collection('appointments')
            .where('start', '>=', now.toISOString())
            .where('start', '<=', endWindow.toISOString())
            .get();

        if (query.empty) return;

        for (const doc of query.docs) {
            const appt = doc.data();

            // 1. Skip if already sent or no phone number
            if (appt.whatsappConfirmationSent || !appt.patientPhone) continue;

            // 2. Calculate how many hours until the appointment
            const apptTimeMs = new Date(appt.start).getTime();
            const hoursUntilAppt = (apptTimeMs - now.getTime()) / (1000 * 60 * 60);

            // EDGE CASE A: Too close! (Less than 2 hours away). Don't spam them.
            if (hoursUntilAppt < 2) continue; 
            
            // EDGE CASE B: Too far! (More than 26 hours away). Wait until tomorrow.
            if (hoursUntilAppt > 26) continue;

            let cleanPhone = appt.patientPhone.replace(/\D/g, '');
            if (cleanPhone.length === 10) {
                cleanPhone = `521${cleanPhone}`; 
            }

            let doctorName = "el doctor"; 
            if (appt.specificDoctorName) {
                doctorName = appt.specificDoctorName;
            } else if (appt.doctorId) {
                let docData = await getDoctorData(appt.doctorId);
                if (docData && docData.displayName) {
                    doctorName = docData.displayName; 
                }
            }

            // --- SMART DATE TEXT (Hoy vs Mañana) ---
            const apptDateStr = new Date(appt.start).toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City' });
            const nowDateStr = new Date().toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City' });
            const isToday = (apptDateStr === nowDateStr);
            const dayText = isToday ? "hoy" : "mañana";

            const timeString = new Date(appt.start).toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City', hour: '2-digit', minute:'2-digit' });
            const firstName = appt.patientName ? appt.patientName.trim().split(' ')[0] : "Paciente";
            
            const messageVariations = [
                `Hola ${firstName}, te escribimos de AUNA para confirmar tu cita de ${dayText} a las ${timeString} con ${doctorName}. Por favor responde *SI* para confirmar o *NO* para cancelar.`,
                `Buen día ${firstName}, te recordamos que tienes un espacio reservado ${dayText} a las ${timeString} con ${doctorName} en AUNA. ¿Nos confirmas tu asistencia respondiendo *SI* o *NO*?`,
                `Estimado(a) ${firstName}, este es un mensaje automático de AUNA para confirmar tu cita médica de ${dayText} a las ${timeString} con ${doctorName}. Responde *SI* para confirmar tu lugar.`
            ];
            
            const randomMessage = messageVariations[Math.floor(Math.random() * messageVariations.length)];

            // Anti-Ban Delay
            const delayMs = Math.floor(Math.random() * (20000 - 8000 + 1) + 8000);
            await new Promise(resolve => setTimeout(resolve, delayMs));

            const payload = {
                chatId: `${cleanPhone}@c.us`,
                message: randomMessage
            };

            await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
			
			// --- NEW: SAVE AUTOMATED MESSAGE TO AI MEMORY ---
            try {
                // Extract the 10-digit base phone number to match the webhook's memory ID
                let basePhone = appt.patientPhone.replace(/\D/g, '');
                if (basePhone.length > 10) basePhone = basePhone.slice(-10);
                
                const chatLogRef = db.collection('whatsappLogs').doc(basePhone);
                const chatLogDoc = await chatLogRef.get();
                let chatHistory = [];
                
                if (chatLogDoc.exists) {
                    chatHistory = chatLogDoc.data().messages || [];
                }
                
                // Save the exact message the Cron Job just sent!
                chatHistory.push({ role: "assistant", content: randomMessage });
                if (chatHistory.length > 6) chatHistory = chatHistory.slice(-6);
                
                await chatLogRef.set({ messages: chatHistory });
            } catch (memErr) {
                console.error("Error saving cron message to memory:", memErr);
            }
            // ------------------------------------------------

            await db.collection('appointments').doc(doc.id).update({
                whatsappConfirmationSent: true
            });
            
            console.log(`WhatsApp sent to ${appt.patientName} for ${doctorName} after ${delayMs}ms delay.`);
        }

    } catch (error) {
        console.error("Error sending WhatsApp confirmations:", error);
    }
});

// ==================================================================
// 6. WHATSAPP AI WEBHOOK (OpenAI + Green API)
// ==================================================================

exports.whatsappWebhook = onRequest(async (req, res) => {
    // 1. Immediately acknowledge receipt to Green API
    res.status(200).send("OK");

    try {
        const body = req.body;

        if (body.typeWebhook === 'incomingMessageReceived' && body.messageData?.typeMessage === 'textMessage') {
            
            const senderId = body.senderData.sender; 
            const rawPhone = senderId.split('@')[0];
            const phoneToMatch = rawPhone.length > 10 ? rawPhone.slice(-10) : rawPhone;
            const text = body.messageData.textMessageData.textMessage.trim();
			
			// --- NEW: MEMORY SYSTEM (Chat History) ---
            const chatLogRef = db.collection('whatsappLogs').doc(phoneToMatch);
            const chatLogDoc = await chatLogRef.get();
            let chatHistory = [];
			
			// Load previous messages if they exist
            if (chatLogDoc.exists) {
                chatHistory = chatLogDoc.data().messages || [];
            }
			
			// Add the new patient message to the memory
            chatHistory.push({ role: "user", content: text });
			
			// Keep only the last 6 messages so it doesn't cost too many tokens!
            if (chatHistory.length > 6) chatHistory = chatHistory.slice(-6);

            // 2. Find ALL upcoming appointments for this phone number
            const now = new Date();
            const snapshot = await db.collection('appointments')
                .where('start', '>=', now.toISOString())
                .get();

            let matchingAppts = [];

            snapshot.forEach(doc => {
                const data = doc.data();
                // --- NEW: Ignore appointments that are already cancelled ---
                if (data.patientPhone && data.status !== 'cancelled') {
                    const dbPhone = data.patientPhone.replace(/\D/g, ''); 
                    if (dbPhone.endsWith(phoneToMatch)) {
                        matchingAppts.push({ id: doc.id, ...data });
                    }
                }
            });

            // Only proceed if we found at least one future appointment
            if (matchingAppts.length > 0) {
                
                // 3. Initialize APIs
                const openai = new OpenAI({ apiKey: process.env.OPENAI_KEY });
                const idInstance = process.env.GREEN_API_ID;
                const apiTokenInstance = process.env.GREEN_API_TOKEN;
                const apiUrl = `https://api.greenapi.com/waInstance${idInstance}/sendMessage/${apiTokenInstance}`;

                // --- NEW: BUILD MULTIPLE APPOINTMENT CONTEXT FOR AI ---
                const patientName = matchingAppts[0].patientName ? matchingAppts[0].patientName.trim().split(' ')[0] : "Paciente";
                let appointmentsDetails = [];

                for (let appt of matchingAppts) {
                    let doctorName = appt.specificDoctorName || "el doctor";
                    if (!appt.specificDoctorName && appt.doctorId) {
                        let docData = await getDoctorData(appt.doctorId);
                        if (docData && docData.displayName) {
                            doctorName = docData.displayName;
                        }
                    }
                    const dObj = new Date(appt.start);
                    const dateStr = dObj.toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City', weekday: 'short', day: 'numeric', month: 'short' });
                    const timeStr = dObj.toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit' });
                    
                    // We give the AI the exact ID and details of each appointment
                    appointmentsDetails.push(`- ID de cita: "${appt.id}" | Cuándo: ${dateStr} a las ${timeStr} | Especialista: ${doctorName}`);
                }
                const appointmentsContextList = appointmentsDetails.join('\n');

                // 4. The Upgraded "System Prompt"
                const systemPrompt = `
                Eres el asistente virtual de la clínica médica AUNA. Eres amable, profesional y muy conciso. 
                Estás hablando con ${patientName}.
                
                INFORMACIÓN GENERAL DE AUNA:
                - Dirección: Madero Sur 1345, Segundo Piso. Referencia: El edificio se encuentra sobre la calzada a un costado de Buonna Pizza.
                - Estacionamiento gratuito para pacientes. Horario: 7:00 AM a 10:00 PM.
                
                CITAS FUTURAS ENCONTRADAS PARA ESTE PACIENTE:
                ${appointmentsContextList}
                
                REGLAS ESTRICTAS:
                1. Lee el historial de la conversación. Si el asistente acaba de enviar un mensaje pidiendo confirmación, y el paciente responde afirmativamente de CUALQUIER forma (ej. "Sí", "Confirmo", "Claro", "Nos vemos mañana", "Ok"), asume que desea CONFIRMAR su cita y usa la herramienta 'update_appointment_status' con status="confirmed".
                2. Si el paciente responde negativamente (ej. "No", "Cancelo", "No podré ir"), usa la herramienta con status="cancelled".
                3. ¡IMPORTANTE! Si el paciente tiene MÚLTIPLES citas en la lista y confirma/cancela sin especificar, TIENES PROHIBIDO usar la herramienta. Debes preguntarle a cuál cita se refiere y enviarle la informacion de todas las citas que encuentres, para que pueda escoger la correcta.
                4. Si hace preguntas generales, usa la información de la clínica  del doctor que eligio para responderle.
                `;

                // 5. Ask OpenAI what to do (Notice the new Tool schema)
                const completion = await openai.chat.completions.create({
                    model: "gpt-4o-mini",
                    messages: [
                        { role: "system", content: systemPrompt },
                        ...chatHistory // <--- WE INJECT THE FULL MEMORY HERE!
                    ],
                    tools: [
                        {
                            type: "function",
                            function: {
                                name: "update_appointment_status",
                                description: "Actualiza el estado de la cita del paciente.",
                                parameters: {
                                    type: "object",
                                    properties: {
                                        appointment_id: {
                                            type: "string",
                                            description: "El 'ID de cita' exacto de la lista proporcionada."
                                        },
                                        status: {
                                            type: "string",
                                            enum: ["confirmed", "cancelled"],
                                            description: "El nuevo estado de la cita."
                                        }
                                    },
                                    required: ["appointment_id", "status"]
                                }
                            }
                        }
                    ],
                    tool_choice: "auto"
                });

                const msg = completion.choices[0].message;
                let replyMessage = "";

                // 6. Check if the AI decided to press the Database Update Button
                if (msg.tool_calls && msg.tool_calls.length > 0) {
                    const toolCall = msg.tool_calls[0];
                    const args = JSON.parse(toolCall.function.arguments);
                    
                    const targetApptId = args.appointment_id;
                    const targetAppt = matchingAppts.find(a => a.id === targetApptId);

                    if (targetAppt) {
                        let notificationTitle = "";
                        let notificationBody = "";

                        // Format the date for the push notification & reply
                        const dObj = new Date(targetAppt.start);
                        const dateStr = dObj.toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City', weekday: 'short', day: 'numeric', month: 'short' });
                        const timeStr = dObj.toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit' });

                        // --- NEW: Fetch doctor name for the detailed patient reply ---
                        let targetDoctorName = targetAppt.specificDoctorName || "el doctor";
                        if (!targetAppt.specificDoctorName && targetAppt.doctorId) {
                            let docData = await getDoctorData(targetAppt.doctorId);
                            if (docData && docData.displayName) {
                                targetDoctorName = docData.displayName;
                            }
                        }

                        if (args.status === 'confirmed') {
                            await db.collection('appointments').doc(targetApptId).update({ confirmed: true });
                            replyMessage = `✅ ¡Gracias ${patientName}! Tu cita del ${dateStr} a las ${timeStr} con ${targetDoctorName} ha sido confirmada exitosamente. Te esperamos en AUNA.`;
                            
                            notificationTitle = "✅ Paciente Confirmado";
                            notificationBody = `${patientName} confirmó su asistencia para el ${dateStr} a las ${timeStr}.`;
                        } else if (args.status === 'cancelled') {
                            await db.collection('appointments').doc(targetApptId).update({ confirmed: false, status: 'cancelled' });
                            replyMessage = `❌ Entendido ${patientName}, hemos cancelado tu cita del ${dateStr} a las ${timeStr} con ${targetDoctorName}. Gracias por avisarnos.`;
                            
                            notificationTitle = "❌ Paciente Canceló (WhatsApp)";
                            notificationBody = `${patientName} canceló su cita del ${dateStr} a las ${timeStr}.`;
                        }

                        // --- SEND PUSH NOTIFICATION TO DOCTOR ---
                        if (targetAppt.doctorId) {
                            const doctorProfile = await getDoctorData(targetAppt.doctorId);
                            if (doctorProfile && doctorProfile.fcmToken) {
                                const prefs = doctorProfile.notificationSettings || {};
                                if (prefs.whatsappReplies !== false) {
                                    try {
                                        const message = {
                                            token: doctorProfile.fcmToken,
                                            notification: { title: notificationTitle, body: notificationBody },
                                            android: { priority: 'high', notification: { sound: 'default' } },
                                            webpush: { headers: { Urgency: "high" } }
                                        };
                                        await admin.messaging().send(message);
                                    } catch (e) { console.error("Error sending notification:", e); }
                                }
                            }
                        }
                    } else {
                        // Failsafe in case the AI hallucinates a wrong ID
                        replyMessage = `Lo siento ${patientName}, no pude encontrar esa cita específica en nuestro sistema para modificarla.`;
                    }
                } else {
                    // 7. If no tool was called, the AI just wants to chat normally
                    replyMessage = msg.content;
                }

                // 8. Save the AI's reply to memory and send via Green API
                if (replyMessage) {
                    
                    // Save assistant reply to memory
                    chatHistory.push({ role: "assistant", content: replyMessage });
                    await chatLogRef.set({ messages: chatHistory });

                    await fetch(apiUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chatId: senderId,
                            message: replyMessage
                        })
                    });
                }
            }
        }
    } catch (error) {
        console.error("AI Webhook Error:", error);
    }
});