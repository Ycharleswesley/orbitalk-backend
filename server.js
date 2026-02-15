const WebSocket = require('ws');
const http = require('http'); // Added for /translate endpoint
// const speechService = require('./speechService'); // Lazy load instead to ensure credentials exist
const translationService = require('./translationService');
// const claudeService = require('./claudeService'); // REMOVED: User requested Google-only
const { mapLanguageCode, getVoiceNameForLang } = require('./languageMapper');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();
const { Buffer } = require('buffer');
let firebaseAdmin = null;

// GLOBAL ERROR HANDLERS
process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION:', err);
    // Keep process alive to prevent "Exited with status 1"
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('UNHANDLED REJECTION:', reason);
});

// Initialize Google Credentials
try {
    require('./googleConfig').setupGoogleCredentials();
} catch (err) {
    console.error('Failed to setup Google Credentials:', err);
}

// WARMUP: Require services immediately after credentials to instantiate clients
const googleTtsService = require('./googleTtsService');
const speechService = require('./speechService');

// Initialize Firebase Admin (for FCM push)
try {
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
        if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
            const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
            });
            firebaseAdmin = admin;
            console.log('Firebase Admin initialized via FIREBASE_SERVICE_ACCOUNT_JSON');
        } else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
            const serviceAccount = require(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
            });
            firebaseAdmin = admin;
            console.log('Firebase Admin initialized via FIREBASE_SERVICE_ACCOUNT_PATH');
        } else {
            console.log('Firebase Admin not initialized (missing FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH)');
        }
    } else {
        firebaseAdmin = admin;
    }
} catch (err) {
    console.error('Firebase Admin init error:', err);
}

const PORT = process.env.PORT || 8080;

// Create HTTP Server for REST API + WebSocket
const server = http.createServer(async (req, res) => {
    // Enable CORS for frontend accessibility
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.method === 'POST' && req.url === '/translate') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            try {
                const { text, targetLang, sourceLang } = JSON.parse(body);
                if (!text || !targetLang) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing text or targetLang' }));
                    return;
                }

                console.log(`(API) Translating: "${text}" -> ${targetLang}`);
                const translatedText = await translationService.translateText(text, sourceLang || 'auto', targetLang);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ translation: translatedText }));
            } catch (e) {
                console.error('(API) Translation Error:', e);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Translation Failed' }));
            }
        });
        return;
    }

    if (req.method === 'POST' && req.url === '/notify-call') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            try {
                const { token, callId, callerId, callerName, callerAvatar, callerColor, type } = JSON.parse(body);
                if (!token || !callId) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing token or callId' }));
                    return;
                }

                if (!firebaseAdmin) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Firebase Admin not initialized' }));
                    return;
                }

                const message = {
                    token: token,
                    data: {
                        type: String(type || 'call'),
                        callId: String(callId),
                        callerId: String(callerId || ''),
                        callerName: String(callerName || 'Caller'),
                        callerAvatar: String(callerAvatar || ''),
                        callerColor: String(callerColor || '0'),
                    },
                    android: {
                        priority: 'high',
                    },
                };

                const response = await firebaseAdmin.messaging().send(message);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, messageId: response }));
            } catch (e) {
                console.error('(API) Call Notify Error:', e);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Call notification failed' }));
            }
        });
        return;
    }

    // Default response
    res.writeHead(404);
    res.end();
});

// Attach WebSocket to HTTP Server
const wss = new WebSocket.Server({ server });

server.listen(PORT, () => {
    console.log(`Server started on port ${PORT} (HTTP + WebSocket)`);
});

// Store client state
const clients = new Map();
// Store rooms
const rooms = new Map();

// ============================================================================
// HALF-DUPLEX AUDIO CONTROL
// ============================================================================
const BYTES_PER_SECOND = 32000; // 16kHz * 16-bit * mono
const WAV_HEADER_SIZE = 44;     // Standard WAV header size
const DUPLICATE_TRANSCRIPT_WINDOW_MS = 12000;
const FORCE_FINAL_SILENCE_MS = 2000;
const FORCE_FINAL_SHORT_HOLD_MS = 1800;
const FORCE_FINAL_SHORT_WORDS_MAX = 3;
const FORCE_FINAL_SHORT_CHARS_MAX = 20;

function normalizeForDedup(text) {
    return (text || '')
        .toString()
        .normalize('NFC')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();
}

function hasTerminalPunctuation(text) {
    return /[.?!।]$/.test((text || '').trim());
}

function countWords(text) {
    const trimmed = (text || '').trim();
    if (!trimmed) return 0;
    return trimmed.split(/\s+/).filter(Boolean).length;
}

function shouldHoldForFullSentence(text) {
    const trimmed = (text || '').trim();
    if (!trimmed) return false;
    if (hasTerminalPunctuation(trimmed)) return false;

    const words = countWords(trimmed);
    if (words <= FORCE_FINAL_SHORT_WORDS_MAX) return true;
    if (trimmed.length <= FORCE_FINAL_SHORT_CHARS_MAX && words <= 4) return true;
    return false;
}

function appendCommittedText(clientData, text) {
    const next = (text || '').trim();
    if (!next) return;

    const current = (clientData.committedText || '').trim();
    if (!current) {
        clientData.committedText = next;
        return;
    }

    if (next.startsWith(current)) {
        clientData.committedText = next;
        return;
    }

    if (current.startsWith(next)) {
        return;
    }

    clientData.committedText = `${current} ${next}`.trim();
}

function collapseRepeatedPhrase(text) {
    const trimmed = (text || '').trim();
    if (!trimmed) return '';

    const tokens = trimmed.split(/\s+/).filter(Boolean);
    if (tokens.length < 4) return trimmed;

    // Collapse exact repeated blocks (e.g., "x y x y" -> "x y").
    for (let unit = 2; unit <= Math.floor(tokens.length / 2); unit++) {
        if (tokens.length % unit !== 0) continue;
        const repeatCount = tokens.length / unit;
        if (repeatCount < 2) continue;

        const firstBlock = tokens.slice(0, unit).join(' ');
        let allSame = true;
        for (let i = 1; i < repeatCount; i++) {
            const block = tokens.slice(i * unit, (i + 1) * unit).join(' ');
            if (block !== firstBlock) {
                allSame = false;
                break;
            }
        }
        if (allSame) {
            return firstBlock;
        }
    }

    return trimmed;
}

function isSessionActive(ws, clientData, generation) {
    if (!clientData || clientData.isClosed) return false;
    if (clients.get(ws) !== clientData) return false;
    if (ws.readyState !== WebSocket.OPEN) return false;
    if (generation !== undefined && clientData.streamGeneration !== generation) return false;
    return true;
}

console.log(`WebSocket server started on port ${PORT}`);

wss.on('connection', (ws, req) => {
    const remoteIp = req.socket.remoteAddress;
    console.log(`[STEP 1] New Client Connected from IP: ${remoteIp}`);
    const clientId = uuidv4();

    // Send Connection Acknowledgement
    ws.send(JSON.stringify({
        type: 'connection_ack',
        clientId: clientId
    }));

    clients.set(ws, {
        id: clientId,
        roomId: null,
        config: null,
        speechService: null,
        isSpeaking: false,
        speakingTimeout: null,
        isServiceReady: false,
        isClosed: false,
        streamGeneration: 0,
        lastProcessedText: '',
        lastProcessedAt: 0,
        pendingForceText: '',
        pendingForceSince: 0
    });

    ws.on('message', async (message, isBinary) => {
        const clientData = clients.get(ws);
        if (!clientData) return;

        if (!isBinary) {
            try {
                const msg = JSON.parse(message.toString());
                if (msg.type === 'config') {
                    console.log(`[STEP 2] Config Received for Room: ${msg.roomId} (Language: ${msg.sourceLang})`);
                    handleConfigMessage(ws, clientData, msg);
                } else if (msg.type === 'chat') {
                    handleChatMessage(ws, clientData, msg.text);
                }
            } catch (e) {
                console.error('Error parsing JSON message:', e);
            }
        } else {
            // Start/Restart Speech Service if not active
            if (!clientData.speechService) {
                if (clientData.config) {
                    startSpeechService(ws, clientData);
                }
            }

            if (clientData.speechService) {
                try {
                    clientData.lastAudioTime = Date.now();
                    // Write incoming mic PCM directly to active stream.
                    try {
                        if (clientData.speechService) {
                            clientData.speechService.write(message);
                        }
                    } catch (e) {
                        console.log(`[${clientData.id}] Stream write error:`, e.message);
                    }
                } catch (e) {
                    console.error('Error handling audio message:', e);
                }
            }
        }
    });

    ws.on('close', () => {
        console.log(`Client ${clientId} disconnected`);
        cleanupClient(ws);
    });

    ws.on('error', (error) => {
        console.error(`Client ${clientId} error:`, error);
        cleanupClient(ws);
    });
});

function handleConfigMessage(ws, clientData, config) {
    console.log(`Received config for client ${clientData.id}:`, config);

    const sourceLangFull = mapLanguageCode(config.sourceLang || 'en');
    const targetLangFull = mapLanguageCode(config.targetLang || 'es');
    const sourceLangBase = sourceLangFull.split('-')[0];
    const targetLangBase = targetLangFull.split('-')[0];

    console.log(`Mapped languages: ${sourceLangFull} (Base: ${sourceLangBase}) -> ${targetLangFull} (Base: ${targetLangBase})`);

    clientData.config = {
        sourceLang: sourceLangFull,
        targetLang: targetLangFull,
        sourceLangBase: sourceLangBase,
        targetLangBase: targetLangBase,
        voiceName: getVoiceNameForLang(targetLangFull)
    };
    console.log(`Voice selected for ${targetLangFull}: ${clientData.config.voiceName || 'DEFAULT'}`);

    const roomId = config.roomId || 'default-room';
    clientData.roomId = roomId;

    if (!rooms.has(roomId)) {
        rooms.set(roomId, new Set());
    }
    rooms.get(roomId).add(ws);
    const roomSize = rooms.get(roomId).size;
    console.log(`Client ${clientData.id} joined room ${roomId} (Total Users: ${roomSize})`);

    setTimeout(() => broadcastRoomUpdate(roomId), 500);
    startSpeechService(ws, clientData);
}

function broadcastRoomUpdate(roomId) {
    if (!rooms.has(roomId)) return;
    const room = rooms.get(roomId);
    const count = room.size;

    const updateMsg = JSON.stringify({
        type: 'room_update',
        userCount: count
    });

    room.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(updateMsg);
        }
    });
}

function cleanupClient(ws) {
    const clientData = clients.get(ws);
    if (!clientData) return;
    clientData.isClosed = true;
    clientData.streamGeneration = (clientData.streamGeneration || 0) + 1;
    clientData.isServiceReady = false;

    if (clientData.silenceInterval) clearInterval(clientData.silenceInterval);

    if (clientData.speechService) {
        try {
            // FIX: Use .close() for wrapper
            if (clientData.speechService.close) clientData.speechService.close();
            else if (clientData.speechService.destroy) clientData.speechService.destroy();
            else if (clientData.speechService.end) clientData.speechService.end();
        } catch (e) { }
    }

    clients.delete(ws);

    if (clientData.roomId && rooms.has(clientData.roomId)) {
        const room = rooms.get(clientData.roomId);
        room.delete(ws);
        if (room.size === 0) {
            rooms.delete(clientData.roomId);
            console.log(`Room ${clientData.roomId} is now empty and removed.`);
        } else {
            const callEndedMsg = JSON.stringify({
                type: 'call_ended',
                reason: 'peer_disconnected',
                timestamp: new Date().toISOString()
            });
            room.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(callEndedMsg);
                }
            });
            broadcastRoomUpdate(clientData.roomId);
        }
    }
}

function checkRoomReady(roomId) {
    if (!rooms.has(roomId)) return;
    const room = rooms.get(roomId);

    if (room.size !== 2) return;

    let allReady = true;
    room.forEach(client => {
        const data = clients.get(client);
        if (!data || !data.isServiceReady) {
            allReady = false;
        }
    });

    if (allReady && !room.hasBroadcastStart) {
        console.log(`[Room ${roomId}] Both clients Ready. Broadcasting CALL START.`);
        room.hasBroadcastStart = true;

        const startMsg = JSON.stringify({
            type: 'system',
            status: 'call_active',
            timestamp: new Date().toISOString()
        });

        room.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(startMsg);
            }
        });
    }
}

function startSpeechService(ws, clientData, isRestart = false) {
    // Cleanup existing service if any
    if (clientData.speechService) {
        try {
            if (clientData.speechService.close) clientData.speechService.close();
            else if (clientData.speechService.destroy) clientData.speechService.destroy();
            else if (clientData.speechService.end) clientData.speechService.end();
        } catch (e) { }
    }

    // console.log(`[${clientData.id}] Starting Google Speech Service...`); // REMOVED LOG as per user request

    clientData.isClosed = false;
    const streamGeneration = (clientData.streamGeneration || 0) + 1;
    clientData.streamGeneration = streamGeneration;

    // Create new service
    const newService = speechService.recognizeSpeech(
        clientData.config.sourceLang,
        (text) => {
            if (!isSessionActive(ws, clientData, streamGeneration)) return;
            // CRITICAL FIX: Handle "Natural Final"
            // 1. Deduplicate against committed text (what we already forced)
            // 2. Handle partial new content if Google finalized a longer sentence than we forced

            let textToProcess = text;

            if (clientData.committedText) {
                if (textToProcess.startsWith(clientData.committedText)) {
                    // Strip the part we already forced
                    textToProcess = textToProcess.substring(clientData.committedText.length).trim();
                } else if (textToProcess === clientData.committedText) {
                    textToProcess = ''; // Exact match, fully ignored
                }
            }

            // Always RESET committedText on Natural Final (Google clears buffer)
            clientData.committedText = '';
            // CRITICAL FIX: Clear stale interim text so it doesn't trigger Force Finalize again
            clientData.lastInterimText = null;
            clientData.hasPendingInterim = false;
            clientData.lastInterimTime = Date.now();
            clientData.pendingForceText = '';
            clientData.pendingForceSince = 0;

            const normalized = normalizeForDedup(textToProcess);
            const isRecentDuplicate = normalized &&
                normalized === clientData.lastProcessedText &&
                (Date.now() - clientData.lastProcessedAt) < DUPLICATE_TRANSCRIPT_WINDOW_MS;

            if (textToProcess && !isRecentDuplicate) {
                clientData.lastProcessedText = normalized;
                clientData.lastProcessedAt = Date.now();
                console.log(`[${clientData.id}] Processing Natural Final (Suffix): "${textToProcess}"`);
                handleRecognizedText(ws, textToProcess, streamGeneration);
            } else {
                console.log(`[${clientData.id}] Ignored Natural Final (Duplicate/Empty)`);
            }
        },
        (text) => {
            // Check stale - Interim is fine to ignore if we switched
            if (clientData && clientData.speechService === newService && isSessionActive(ws, clientData, streamGeneration)) {
                // REMOVED LOGGING as per user request
                // process.stdout.write(`\r[${clientData.id}] Hearing: ${text.substring(0, 50)}...`);

                const trimmed = (text || '').trim();
                if (trimmed) {
                    if (trimmed !== clientData.lastInterimText) {
                        clientData.lastInterimTime = Date.now();
                    }

                    // If a held chunk is being extended by new interim text, keep the longer form.
                    if (clientData.pendingForceText &&
                        trimmed.startsWith(clientData.pendingForceText) &&
                        trimmed.length > clientData.pendingForceText.length) {
                        clientData.pendingForceText = trimmed;
                    }

                    clientData.lastInterimText = trimmed; // STORE INTERIM TEXT FOR FORCE FINALIZE
                    clientData.hasPendingInterim = true;
                }

                // NEW: Broadcast "Speaking Start" event (Debounced)
                const now = Date.now();
                if (!clientData.lastSpeakingBroadcast || (now - clientData.lastSpeakingBroadcast > 2000)) {
                    clientData.lastSpeakingBroadcast = now;

                    const speakingMsg = JSON.stringify({
                        type: 'system',
                        status: 'speaking_start',
                        senderId: clientData.id,
                        timestamp: new Date().toISOString()
                    });

                    // Broadcast to ROOM (so the OTHER person hears/sees it)
                    const room = rooms.get(clientData.roomId);
                    if (room) {
                        room.forEach(client => {
                            if (client !== ws && client.readyState === WebSocket.OPEN) {
                                client.send(speakingMsg);
                            }
                        });
                    }
                }
            }
        },
        (error) => {
            // Check stale
            if (clientData.speechService !== newService) return;
            if (!isSessionActive(ws, clientData, streamGeneration)) return;

            if (error.message === 'Stream ended normally') {
                if (ws.readyState === WebSocket.OPEN && !clientData.intentionalClose) {
                    console.log(`[${clientData.id}] Stream ended normally. Restarting in 250ms...`);
                    setTimeout(() => startSpeechService(ws, clientData), 250); // FIX: Safe Fast Restart (250ms)
                }
                return;
            }

            if (error.message && /audio timeout/i.test(error.message)) {
                // console.log(`[${clientData.id}] Audio Timeout (Silence). Stream closed. Restarting...`);
                if (clientData.silenceInterval) clearInterval(clientData.silenceInterval);
                clientData.speechService = null;
                clientData.lastInterimText = null; // Clear stale
                clientData.hasPendingInterim = false;

                // Restart only if audio was flowing recently; otherwise wait for next mic packet.
                if (ws.readyState === WebSocket.OPEN) {
                    const recentAudio = clientData.lastAudioTime && (Date.now() - clientData.lastAudioTime < 1500);
                    if (recentAudio) {
                        setTimeout(() => startSpeechService(ws, clientData, true), 250);
                    }
                }
                return;
            }

            console.log(`[${clientData.id}] Speech Error: ${error.message}. Restarting in 250ms...`);
            if (clientData.silenceInterval) clearInterval(clientData.silenceInterval);
            clientData.lastInterimText = null; // Clear stale

            if (ws.readyState === WebSocket.OPEN) {
                setTimeout(() => startSpeechService(ws, clientData, true), 250);
            }
        }
    );

    clientData.speechService = newService;

    // CRITICAL: Signal that this user is ready, so "checkRoomReady" can trigger "Call Active"
    clientData.isServiceReady = true;

    try {
        if (clientData.speechService && !clientData.speechService.destroyed && !clientData.speechService.writableEnded && clientData.speechService.write) {
            // Prime the stream with a short silence packet.
            clientData.speechService.write(Buffer.alloc(320, 0));
        }
    } catch (e) { }

    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'system',
            status: 'ready',
            timestamp: new Date().toISOString()
        }));
    }

    // CRITICAL: Check room ready status
    checkRoomReady(clientData.roomId);

    clientData.intentionalClose = false;

    if (clientData.silenceInterval) clearInterval(clientData.silenceInterval);
    clientData.lastAudioTime = Date.now();
    clientData.lastInterimTime = Date.now();
    clientData.hasPendingInterim = false;
    clientData.pendingForceText = '';
    clientData.pendingForceSince = 0;

    // THE TWO SECOND RULE: Keepalive Loop
    clientData.silenceInterval = setInterval(() => {
        // Safe check
        if (!clientData.speechService || clientData.speechService !== newService) return;

        const now = Date.now();
        const silenceDuration = now - clientData.lastAudioTime;
        const interimStableDuration = now - clientData.lastInterimTime; // FIXED: Added missing declaration

        // 0. Flush a held short chunk once it has waited long enough.
        if (clientData.pendingForceText && silenceDuration >= FORCE_FINAL_SILENCE_MS) {
            const pendingAge = now - clientData.pendingForceSince;
            const pendingText = clientData.pendingForceText;
            const holdPending = shouldHoldForFullSentence(pendingText) && pendingAge < FORCE_FINAL_SHORT_HOLD_MS;

            if (!holdPending) {
                const normalizedPending = normalizeForDedup(pendingText);
                const isRecentPendingDuplicate = normalizedPending &&
                    normalizedPending === clientData.lastProcessedText &&
                    (Date.now() - clientData.lastProcessedAt) < DUPLICATE_TRANSCRIPT_WINDOW_MS;

                if (!isRecentPendingDuplicate) {
                    console.log(`[${clientData.id}] Emitting buffered sentence after hold: "${pendingText}"`);
                    handleRecognizedText(ws, pendingText, streamGeneration);
                    clientData.lastProcessedText = normalizedPending;
                    clientData.lastProcessedAt = Date.now();
                    appendCommittedText(clientData, pendingText);
                }

                clientData.pendingForceText = '';
                clientData.pendingForceSince = 0;
                clientData.lastInterimText = null;
                clientData.hasPendingInterim = false;
                return;
            }
        }

        // 1. Force Finalize on Silence (SMART MODE)
        // Rule: If 2.0s silence AND we have pending text, force it through.
        if (clientData.hasPendingInterim && interimStableDuration >= FORCE_FINAL_SILENCE_MS && silenceDuration >= FORCE_FINAL_SILENCE_MS) {
            if (clientData.lastInterimText) {

                let textToProcess = clientData.lastInterimText;

                // STRIP ACCUMULATED PREFIX (Fixes "Hello" -> "Hello How are you")
                if (clientData.committedText && textToProcess.startsWith(clientData.committedText)) {
                    textToProcess = textToProcess.substring(clientData.committedText.length).trim();
                }

                // If nothing new, ignore (Fixes "Hello" -> "Hello" loop)
                if (!textToProcess) {
                    clientData.lastInterimText = null;
                    clientData.hasPendingInterim = false;
                    return;
                }

                const normalized = normalizeForDedup(textToProcess);
                const isRecentDuplicate = normalized &&
                    normalized === clientData.lastProcessedText &&
                    (Date.now() - clientData.lastProcessedAt) < DUPLICATE_TRANSCRIPT_WINDOW_MS;
                if (isRecentDuplicate) {
                    clientData.lastInterimText = null;
                    clientData.hasPendingInterim = false;
                    return;
                }

                // Hold very short/no-punctuation chunks so full sentence can arrive first.
                if (shouldHoldForFullSentence(textToProcess)) {
                    // Only wait if this fragment has not been stable for long enough yet.
                    // Once the 2s silence rule is met, emit immediately to avoid extra latency.
                    if (interimStableDuration < FORCE_FINAL_SHORT_HOLD_MS) {
                        if (!clientData.pendingForceSince) {
                            clientData.pendingForceSince = Date.now();
                        }
                        if (!clientData.pendingForceText ||
                            textToProcess.length >= clientData.pendingForceText.length ||
                            textToProcess.startsWith(clientData.pendingForceText)) {
                            clientData.pendingForceText = textToProcess;
                        }

                        clientData.lastInterimText = null;
                        clientData.hasPendingInterim = false;
                        return;
                    }

                    clientData.pendingForceText = '';
                    clientData.pendingForceSince = 0;
                }

                clientData.pendingForceText = '';
                clientData.pendingForceSince = 0;

                console.log(`[${clientData.id}] Force Finalizing caused by 2.0s silence: "${textToProcess}"`);

                // 1. Force the translation immediately
                handleRecognizedText(ws, textToProcess, streamGeneration);
                clientData.lastProcessedText = normalized;
                clientData.lastProcessedAt = Date.now();

                // 2. Update Commited Text (Store the FULL interim string so we can strip it next time)
                appendCommittedText(clientData, clientData.lastInterimText);

                // 3. Clear state (but committedText remains)
                clientData.lastInterimText = null;
                clientData.hasPendingInterim = false;
                clientData.intentionalClose = true; // Mark as intentional to avoid error logs

                // 3. NO RESTART (Continuous Mode maintained as per user request)
                // We do NOT close the stream here. We just output what we have.
                console.log(`[${clientData.id}] Force Finalize Complete. Continuing stream...`);

                // Clear the manual silence interval but NOT the stream
                // (Actually we keep the interval running, just reset the text buffer)
                return;
            }
        }


        // 2. Inject Silence to Keep Connection Alive
        // Send silence after 1.5 seconds of no audio
        if (silenceDuration > 1500) {
            try {
                if (clientData.speechService && !clientData.speechService.destroyed && !clientData.speechService.writableEnded && clientData.speechService.write) {
                    const silence = Buffer.alloc(BYTES_PER_SECOND, 0); // 1 second PCM silence
                    clientData.speechService.write(silence);
                }
            } catch (e) { }
        }
    }, 1000);
}

async function handleRecognizedText(ws, text, generation) {
    if (!text) return;
    const clientData = clients.get(ws);
    if (!clientData || !clientData.roomId) return;
    if (!isSessionActive(ws, clientData, generation)) return;

    const collapsedText = collapseRepeatedPhrase(text);
    if (collapsedText !== text) {
        console.log(`[${clientData.id}] Collapsed repeated phrase: "${text}" -> "${collapsedText}"`);
    }
    const textToTranslate = collapsedText || text;

    clientData.hasPendingInterim = false;
    clientData.pendingForceText = '';
    clientData.pendingForceSince = 0;
    console.log(`\n[${clientData.id}] Recognized: ${textToTranslate}`);

    try {
        // GOOGLE ONLY TRANSLATION (Claude Removed)
        const translatedText = await translationService.translateText(
            textToTranslate,
            clientData.config.sourceLangBase,
            clientData.config.targetLangBase
        );
        if (!isSessionActive(ws, clientData, generation)) return;

        console.log(`[${clientData.id}] Translated: ${translatedText}`);
        if (!translatedText) return;

        const textMessage = JSON.stringify({
            type: 'transcript',
            original: text,
            translated: translatedText,
            isLocal: false,
            timestamp: new Date().toISOString()
        });

        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'transcript',
                original: textToTranslate,
                translated: translatedText,
                isLocal: true,
                timestamp: new Date().toISOString()
            }));
        }

        const room = rooms.get(clientData.roomId);
        if (room) {
            room.forEach(client => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({
                        type: 'transcript',
                        original: textToTranslate,
                        translated: translatedText,
                        isLocal: false,
                        timestamp: new Date().toISOString()
                    }));
                }
            });
        }

        const sentences = translatedText.match(/[^.?!]+[.?!]+[\]'"”’)}]*|.+/g) || [translatedText];
        const { synthesizeSpeech } = googleTtsService;

        console.log(`[${clientData.id}] Processing ${sentences.length} chunks for: "${translatedText}"`);

        for (const sentence of sentences) {
            if (!isSessionActive(ws, clientData, generation)) break;
            if (!sentence.trim()) continue;

            const audioBuffer = await synthesizeSpeech(
                sentence.trim(),
                clientData.config.targetLang,
                clientData.config.voiceName
            );
            if (!isSessionActive(ws, clientData, generation)) break;

            if (audioBuffer && audioBuffer.length > 0) {
                if (room) {
                    if (room.size === 1 && ws.readyState === WebSocket.OPEN) {
                        ws.send(audioBuffer);
                    }
                    room.forEach(client => {
                        if (client !== ws && client.readyState === WebSocket.OPEN) {
                            client.send(audioBuffer);
                        }
                    });
                }
            }
        }
        console.log(`[${clientData.id}] Finished broadcasting all audio chunks.`);

    } catch (error) {
        console.error('Error in processing pipeline:', error);
    }
}

async function handleChatMessage(ws, clientData, text) {
    if (!text) return;
    if (!clientData.roomId) return;

    console.log(`[${clientData.id}] Chat Message: ${text}`);

    try {
        const translatedText = await translationService.translateText(
            text,
            clientData.config.sourceLangBase,
            clientData.config.targetLangBase
        );
        console.log(`[${clientData.id}] Chat Translated: ${translatedText}`);

        const messageData = JSON.stringify({
            type: 'chat',
            senderId: clientData.id,
            original: text,
            translated: translatedText,
            timestamp: new Date().toISOString()
        });

        const room = rooms.get(clientData.roomId);
        if (room) {
            room.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(messageData);
                }
            });
        }
    } catch (error) {
        console.error('Error handling chat message:', error);
    }
}
