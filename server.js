const WebSocket = require('ws');
const speechService = require('./speechService');
const translationService = require('./translationService');
const { mapLanguageCode, getVoiceNameForLang } = require('./languageMapper');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

// Initialize Google Credentials for Render
try {
    require('./googleConfig').setupGoogleCredentials();
} catch (err) {
    console.error('Failed to setup Google Credentials:', err);
}

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

// Store client state
const clients = new Map();
// Store rooms
const rooms = new Map();

// ============================================================================
// HALF-DUPLEX AUDIO CONTROL
// ============================================================================
// Purpose: Prevent echo/feedback loops by gating mic audio while TTS plays.
// 
// Problem: When TTS audio plays on the client's speaker, the microphone picks
//          it up and streams it back to STT, causing infinite loops:
//          TTS → Speaker → Microphone → STT → Translation → TTS → ...
//
// Solution: Implement "half-duplex" mode - only one direction at a time:
//          1. Track when each client is receiving TTS audio (isSpeaking flag)
//          2. Gate (ignore) incoming mic audio while TTS is expected to play
//          3. Resume STT after estimated playback duration completes
//
// WAV Duration Calculation:
//          16kHz sample rate × 16-bit depth × mono = 32000 bytes/second
//          Duration (ms) = (audioBytes / 32000) × 1000
// ============================================================================

const BYTES_PER_SECOND = 32000; // 16kHz * 16-bit * mono
const WAV_HEADER_SIZE = 44;     // Standard WAV header size

// Calculate playback duration from WAV audio buffer
function calculatePlaybackDurationMs(audioBuffer) {
    // Subtract WAV header to get pure PCM data size
    const pcmBytes = audioBuffer.byteLength - WAV_HEADER_SIZE;
    const durationMs = (pcmBytes / BYTES_PER_SECOND) * 1000;
    // Add small buffer for safety (network latency, playback start delay)
    return durationMs + 200;
}

console.log(`WebSocket server started on port ${PORT}`);

wss.on('connection', (ws, req) => {
    const remoteIp = req.socket.remoteAddress;
    console.log(`New client connected from IP: ${remoteIp}`);
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
        // HALF-DUPLEX: Track when this client is receiving TTS playback
        isSpeaking: false,
        speakingTimeout: null
    });

    ws.on('message', async (message, isBinary) => {
        const clientData = clients.get(ws);

        if (!isBinary) {
            try {
                const msg = JSON.parse(message.toString());
                if (msg.type === 'config') {
                    handleConfigMessage(ws, clientData, msg);
                } else if (msg.type === 'chat') {
                    handleChatMessage(ws, clientData, msg.text);
                }
            } catch (e) {
                console.error('Error parsing JSON message:', e);
            }
        } else {
            // HALF-DUPLEX REMOVED: Allow Full Duplex (Simultaneous Talk & Listen)
            // if (clientData.isSpeaking) { return; }

            if (clientData.speechService) {
                try {
                    // Update timestamp for Silence Injector
                    clientData.lastAudioTime = Date.now();

                    // Debug: Check for silence (all zeros)
                    // Sample first 100 bytes for efficiency
                    let isSilence = true;
                    for (let i = 0; i < Math.min(message.length, 100); i++) {
                        if (message[i] !== 0) {
                            isSilence = false;
                            break;
                        }
                    }

                    if (isSilence) {
                        // console.log(`[${clientData.id}] Rx PCM: ${message.length} bytes (SILENCE detected)`);
                    } else {
                        // console.log(`[${clientData.id}] Rx PCM: ${message.length} bytes`);
                    }

                    // Write to speech service
                    try {
                        if (clientData.speechService) {
                            clientData.speechService.write(message);
                        }
                    } catch (e) {
                        console.log(`[${clientData.id}] Stream write error:`, e.message);
                        // Optional: trigger restart manually if somehow the error callback didn't fire
                        // But for now, let's rely on speechService.js emitting 'error'
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

    // Map language codes to Azure-compatible formats
    // For Speech Recognition: use full code (te-IN)
    // For Translation API: use base code only (te)
    const sourceLangFull = mapLanguageCode(config.sourceLang || 'en');
    const targetLangFull = mapLanguageCode(config.targetLang || 'es');

    // Extract base language code for translation (te-IN → te)
    const sourceLangBase = sourceLangFull.split('-')[0];
    const targetLangBase = targetLangFull.split('-')[0];

    console.log(`Mapped languages: ${sourceLangFull} -> ${sourceLangBase}, ${targetLangFull} -> ${targetLangBase}`);

    // Store configuration
    clientData.config = {
        sourceLang: sourceLangFull,      // Full code for speech recognition (te-IN)
        targetLang: targetLangFull,      // Full code for speech recognition (en-US)
        sourceLangBase: sourceLangBase,  // Base code for translation (te)
        targetLangBase: targetLangBase,  // Base code for translation (en)
        voiceName: getVoiceNameForLang(targetLangFull) // Full code for voice selection
    };

    const roomId = config.roomId || 'default-room';
    clientData.roomId = roomId;

    if (!rooms.has(roomId)) {
        rooms.set(roomId, new Set());
    }
    rooms.get(roomId).add(ws);
    const roomSize = rooms.get(roomId).size;
    console.log(`Client ${clientData.id} joined room ${roomId} (Total Users: ${roomSize})`);

    // Notify room of new user count (Small delay to ensure connection stability)
    setTimeout(() => broadcastRoomUpdate(roomId), 500);

    // Start Speech Service with Auto-Restart
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

    if (clientData.silenceInterval) clearInterval(clientData.silenceInterval);

    // Stop Speech Service
    if (clientData.speechService) {
        try { clientData.speechService.close(); } catch (e) { }
    }

    clients.delete(ws);

    // Remove client from room
    if (clientData.roomId && rooms.has(clientData.roomId)) {
        const room = rooms.get(clientData.roomId);
        room.delete(ws);
        if (room.size === 0) {
            rooms.delete(clientData.roomId);
            console.log(`Room ${clientData.roomId} is now empty and removed.`);
        } else {
            broadcastRoomUpdate(clientData.roomId);
        }
    }
}

function startSpeechService(ws, clientData) {
    if (clientData.speechService) {
        try { clientData.speechService.close(); } catch (e) { }
    }

    console.log(`[${clientData.id}] Starting Google Speech Service...`);
    clientData.speechService = speechService.recognizeSpeech(
        clientData.config.sourceLang,
        (text) => handleRecognizedText(ws, text),
        (text) => {
            // console.log(`[${clientData.id}] Recognizing: ${text}`);
            if (clientData) {
                clientData.lastInterimTime = Date.now();
                clientData.hasPendingInterim = true;
            }
        },
        (error) => {
            // Ignore intentional closes or normal endings (handled by Force Finalize logic)
            if (error.message === 'Stream ended normally') {
                // Check if we should restart (e.g. client still connected)
                if (ws.readyState === WebSocket.OPEN && !clientData.intentionalClose) {
                    setTimeout(() => startSpeechService(ws, clientData), 1000);
                }
                return;
            }

            console.log(`[${clientData.id}] Speech Error: ${error.message}. Restarting...`);
            if (clientData.silenceInterval) clearInterval(clientData.silenceInterval);

            // Check if socket is still open before restarting
            if (ws.readyState === WebSocket.OPEN) {
                // Add small delay to prevent rapid loops
                setTimeout(() => startSpeechService(ws, clientData), 1000);
            }
        }
    );

    // Reset intentionalClose flag
    clientData.intentionalClose = false;

    // KEEPALIVE: Inject silence if no audio received for 2 seconds
    // This prevents Google STT from timing out due to "Long duration elapsed without audio"
    if (clientData.silenceInterval) clearInterval(clientData.silenceInterval);

    clientData.lastAudioTime = Date.now();
    clientData.lastInterimTime = Date.now();
    clientData.hasPendingInterim = false;

    clientData.silenceInterval = setInterval(() => {
        if (!clientData.speechService) return;

        const now = Date.now();
        const silenceDuration = now - clientData.lastAudioTime;
        const interimStableDuration = now - clientData.lastInterimTime;

        // 1. FORCE FINALIZE (Re-connect) on 2s Silence if we have pending partial text
        if (clientData.hasPendingInterim && interimStableDuration > 2000) {
            console.log(`[${clientData.id}] Force Finalizing (2s Silence)...`);

            if (clientData.speechService && typeof clientData.speechService.end === 'function') {
                // Mark as intentional so error handler doesn't log it as a crash
                clientData.intentionalClose = true;
                clientData.speechService.end();
            }

            // Restart immediately (seamlessly)
            startSpeechService(ws, clientData);

            clientData.hasPendingInterim = false;
            return;
        }

        // 2. KEEPALIVE: Inject silence if no audio for 2s
        if (silenceDuration > 2000) {
            try {
                // 3200 bytes = 100ms of silence
                const silence = Buffer.alloc(3200, 0);
                clientData.speechService.write(silence);
                // console.log(`[${clientData.id}] Injected SILENCE to keep stream alive`);
            } catch (e) {
                // Ignore write errors, stream might be closed
            }
        }
    }, 1000);
}


async function handleRecognizedText(ws, text) {
    if (!text) return;
    const clientData = clients.get(ws);
    if (!clientData || !clientData.roomId) return;

    // Reset pending flag as we got a final result
    clientData.hasPendingInterim = false;

    console.log(`[${clientData.id}] Recognized: ${text}`);

    try {
        // 1. Translate Code (Uses Google)
        const translatedText = await translationService.translateText(
            text,
            clientData.config.sourceLangBase,
            clientData.config.targetLangBase
        );
        console.log(`[${clientData.id}] Translated: ${translatedText}`);

        if (!translatedText) return;

        // 2. IMMEDIATE TEXT BROADCAST (Parallel Optimization)
        // Send text to everyone (including Speaker) RIGHT NOW.
        // Don't wait for Audio/TTS.
        const textMessage = JSON.stringify({
            type: 'transcript',
            original: text,
            translated: translatedText,
            isLocal: false, // Will be overridden by client logic if needed, or handled below
            timestamp: new Date().toISOString()
        });

        // Send to Speaker (Local)
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'transcript',
                original: text,
                translated: translatedText,
                isLocal: true,
                timestamp: new Date().toISOString()
            }));
        }

        // Send to Room (Others)
        const room = rooms.get(clientData.roomId);
        if (room) {
            room.forEach(client => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    // Mark as remote for others
                    client.send(JSON.stringify({
                        type: 'transcript',
                        original: text,
                        translated: translatedText,
                        isLocal: false,
                        timestamp: new Date().toISOString()
                    }));
                }
            });
        }

        // 3. GENERATE AUDIO (Smart Chunking / Simulated Streaming)
        // Split text into sentences to send audio asap
        const sentences = translatedText.match(/[^.?!]+[.?!]+[\]'"”’)}]*|.+/g) || [translatedText];
        const { synthesizeSpeech } = require('./googleTtsService');

        console.log(`[${clientData.id}] Processing ${sentences.length} chunks for: "${translatedText}"`);

        // Process sentences sequentially to maintain order, but send ASAP
        for (const sentence of sentences) {
            if (!sentence.trim()) continue;

            // console.log(`[${clientData.id}] Generating chunk: "${sentence.substring(0, 20)}..."`);

            const audioBuffer = await synthesizeSpeech(
                sentence.trim(),
                clientData.config.targetLang,
                clientData.config.voiceName
            );

            if (audioBuffer && audioBuffer.length > 0) {
                // 4. BROADCAST AUDIO CHUNK
                if (room) {
                    // Echo for single-user testing
                    if (room.size === 1 && ws.readyState === WebSocket.OPEN) {
                        ws.send(audioBuffer);
                    }

                    room.forEach(client => {
                        if (client !== ws && client.readyState === WebSocket.OPEN) {
                            // Send Audio Chunk
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
        // Translate the text
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

        // Broadcast to room
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

function cleanupClient(ws) {
    const clientData = clients.get(ws);
    if (clientData) {
        // HALF-DUPLEX: Clear any pending speaking timeout
        if (clientData.speakingTimeout) {
            clearTimeout(clientData.speakingTimeout);
            clientData.speakingTimeout = null;
        }

        if (clientData.silenceInterval) {
            clearInterval(clientData.silenceInterval);
            clientData.silenceInterval = null;
        }

        if (clientData.speechService) {
            clientData.speechService.close();
        }

        if (clientData.roomId && rooms.has(clientData.roomId)) {
            const room = rooms.get(clientData.roomId);
            room.delete(ws);
            if (room.size === 0) {
                rooms.delete(clientData.roomId);
            }
        }

        clients.delete(ws);
    }
}
