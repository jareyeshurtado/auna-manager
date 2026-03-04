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

            // 2. Find the upcoming appointment
            const now = new Date();
            const snapshot = await db.collection('appointments')
                .where('start', '>=', now.toISOString())
                .get();

            let targetApptId = null;
            let patientName = "Paciente";
            let doctorId = null;
			let specificDoctorName = null;
			let apptStart = null; // <-- NEW

            snapshot.forEach(doc => {
                const data = doc.data();
                if (data.patientPhone) {
                    const dbPhone = data.patientPhone.replace(/\D/g, ''); 
                    if (dbPhone.endsWith(phoneToMatch)) {
                        targetApptId = doc.id;
                        patientName = data.patientName ? data.patientName.trim().split(' ')[0] : "Paciente";
                        doctorId = data.doctorId; 
                        specificDoctorName = data.specificDoctorName || null; 
						apptStart = data.start; // <-- NEW
                    }
                }
            });

            if (targetApptId) {
                // 3. Initialize APIs
				const openai = new OpenAI({ apiKey: process.env.OPENAI_KEY });
				const idInstance = process.env.GREEN_API_ID;
				const apiTokenInstance = process.env.GREEN_API_TOKEN;
                const apiUrl = `https://api.greenapi.com/waInstance${idInstance}/sendMessage/${apiTokenInstance}`;

                // --- NEW: FETCH DOCTOR SPECIFIC INFO ---
                let doctorContext = "No hay información específica adicional del doctor.";
                if (doctorId) {
                    let docData = await getDoctorData(doctorId);

                    if (docData) {
                        // --- TRANSLATE SCHEDULE ---
                        let scheduleText = "No especificado.";
                        if (docData.workingSchedule) {
                            scheduleText = "";
                            const days = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
                            for (let i = 0; i < 7; i++) {
                                if (docData.workingSchedule[i] && docData.workingSchedule[i].active) {
                                    const slots = docData.workingSchedule[i].slots.map(s => `${s.start} - ${s.end}`).join(", ");
                                    scheduleText += `${days[i]}: ${slots}. `;
                                }
                            }
                        }

                        // --- TRANSLATE VACATIONS ---
                        let vacationsText = "Ninguna programada.";
                        if (docData.vacations && docData.vacations.length > 0) {
                            vacationsText = docData.vacations.join(", ");
                        }
						// --- FORMAT WHATSAPP LINK ---
						let waLink = "No disponible";
						if (docData.contactWhatsapp) {
							// This removes any spaces, dashes, or parentheses the doctor might type
							const cleanNumber = docData.contactWhatsapp.replace(/\D/g, '');
							if (cleanNumber) {
								waLink = `https://wa.me/52${cleanNumber}`;
							}
						}

						// --- INJECT INTO CONTEXT ---
						doctorContext = `
						- Nombre del Especialista: ${specificDoctorName || docData.displayName || "el doctor"}
						- Especialidad: ${docData.specialty || "Medicina General"}
						- Consultorio: ${docData.officeNumber || "Preguntar en recepción"}
						- Correo electrónico: ${docData.contactEmail || "Preguntar en recepción"}
						- WhatsApp directo del doctor: ${waLink}
						- Métodos de pago aceptados: ${docData.paymentMethods || "Efectivo y Tarjeta"}
						- Horario de trabajo: ${scheduleText}
						- Días que NO consulta (Vacaciones/Bloqueados): ${vacationsText}
						- Notas del doctor: ${docData.extraInfo || "Ninguna"}
						`;
                    }
                }

                // 4. The Upgraded "System Prompt"
                const systemPrompt = `
                Eres el asistente virtual de la clínica médica AUNA. Eres amable, profesional y muy conciso. 
                Estás hablando con ${patientName}.
                
                INFORMACIÓN GENERAL DE LA CLÍNICA AUNA:
                - Dirección: Av. de la Convención de 1914, Aguascalientes, Ags.
                - Ubicación interna: Estamos en la Planta Baja.
                - Estacionamiento: Contamos con estacionamiento gratuito para pacientes.
                - Horario general de la clínica: 8:00 AM a 8:00 PM.
                
                INFORMACIÓN ESPECÍFICA DEL DOCTOR CON EL QUE TIENE CITA:
                ${doctorContext}
                
                OBJETIVO PRINCIPAL:
                Saber si el paciente confirma o cancela su cita de mañana o brindar informacion general de AUNA cuando la necesiten.
                
                REGLAS ESTRICTAS:
                - Si el paciente confirma (ej. "sí", "confirmo", "ahí estaré"), llama a la herramienta 'update_appointment_status' con status="confirmed".
                - Si el paciente cancela (ej. "no", "cancelo", "no podré ir"), llama a la herramienta 'update_appointment_status' con status="cancelled".
                - Si el paciente hace una pregunta sobre pagos, ubicación, o el doctor, usa la información proporcionada arriba para responderle de forma muy breve y amablemente, en caso que si tenga una cita agendada tratar de confirmarla, si no, solo brindar la informacion necesaria. Si no sabes la respuesta, dile que se comunique a recepción.
                `;

                // 5. Ask OpenAI what to do
                const completion = await openai.chat.completions.create({
                    model: "gpt-4o-mini",
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: text }
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
                                        status: {
                                            type: "string",
                                            enum: ["confirmed", "cancelled"],
                                            description: "El nuevo estado de la cita."
                                        }
                                    },
                                    required: ["status"]
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
                    
                    let notificationTitle = "";
                    let notificationBody = "";

                    // --- NEW: Format the date for the push notification ---
                    let dateStr = "";
                    let timeStr = "";
                    if (apptStart) {
                        const dObj = new Date(apptStart);
                        dateStr = dObj.toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City', weekday: 'short', day: 'numeric', month: 'short' });
                        timeStr = dObj.toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit' });
                    }

                    if (args.status === 'confirmed') {
                        await db.collection('appointments').doc(targetApptId).update({ confirmed: true });
                        replyMessage = `✅ ¡Gracias ${patientName}! Tu cita ha sido confirmada exitosamente. Te esperamos en AUNA.`;
                        notificationTitle = "✅ Paciente Confirmado";
                        notificationBody = `${patientName} confirmó su asistencia para el ${dateStr} a las ${timeStr}.`;
                    } else if (args.status === 'cancelled') {
                        await db.collection('appointments').doc(targetApptId).update({ confirmed: false, status: 'cancelled' });
                        replyMessage = `❌ Entendido ${patientName}, hemos cancelado tu cita. Gracias por avisarnos.`;
                        notificationTitle = "❌ Paciente Canceló (WhatsApp)";
                        notificationBody = `${patientName} canceló su cita del ${dateStr} a las ${timeStr}.`;
                    }

                    // --- NEW: SEND PUSH NOTIFICATION TO DOCTOR ---
                    if (doctorId) {
                        const doctorProfile = await getDoctorData(doctorId);
                        if (doctorProfile && doctorProfile.fcmToken) {
                            const prefs = doctorProfile.notificationSettings || {};
                            
                            // Only send if they haven't disabled the setting
                            if (prefs.whatsappReplies !== false) {
                                try {
                                    const message = {
                                        token: doctorProfile.fcmToken,
                                        notification: {
                                            title: notificationTitle,
                                            body: notificationBody
                                        },
                                        android: { priority: 'high', notification: { sound: 'default' } },
                                        webpush: { headers: { Urgency: "high" } }
                                    };
                                    await admin.messaging().send(message);
                                } catch (e) {
                                    console.error("Error sending WhatsApp notification:", e);
                                }
                            }
                        }
                    }
                } else {
                    // 7. If no tool was called, the AI just wants to chat normally
                    replyMessage = msg.content;
                }

                // 8. Send the final reply via Green API
                if (replyMessage) {
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