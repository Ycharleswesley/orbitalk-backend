const WebSocket = require('ws');
const speechService = require('./speechService');
const translationService = require('./translationService');
const { mapLanguageCode, getVoiceNameForLang } = require('./languageMapper');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

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
                }
            } catch (e) {
                console.error('Error parsing JSON message:', e);
            }
        } else {
            // HALF-DUPLEX: Gate incoming audio if this client is currently hearing TTS
            // This prevents the microphone from picking up TTS audio and creating echo
            if (clientData.isSpeaking) {
                // Silently drop audio - client is hearing TTS playback
                // console.log(`[${clientData.id}] Gating audio - TTS playing`);
                return;
            }

            if (clientData.speechService && clientData.speechService.pushStream) {
                try {
                    // Debug: Check for silence (all zeros)
                    const firstBytes = message.slice(0, 5);
                    const isSilence = message.every(byte => byte === 0);

                    // Debug: Log incoming audio to verify stream
                    if (clientData.isSpeaking) {
                        console.log(`[${clientData.id}] Audio GATED (TTS playing)`);
                    } else {
                        console.log(`[${clientData.id}] Rx PCM: ${message.length} bytes`);
                    }

                    // Auto-Restart Logic
                    if (!clientData.speechService || !clientData.speechService.pushStream || clientData.speechService.pushStream.destroyed) {
                        console.log(`[${clientData.id}] Speech stream dead/destroyed. RESTARTING...`);
                        if (clientData.speechService) {
                            try { clientData.speechService.close(); } catch (e) { }
                        }
                        if (clientData.config) {
                            clientData.speechService = speechService.recognizeSpeech(
                                clientData.config.sourceLang,
                                (text) => handleRecognizedText(ws, text),
                                (text) => console.log(`[${clientData.id}] Recognizing: ${text}`)
                            );
                        }
                    }

                    try {
                        if (clientData.speechService && clientData.speechService.pushStream && !clientData.speechService.pushStream.destroyed) {
                            clientData.speechService.pushStream.write(message);
                        }
                    } catch (e) {
                        console.log(`[${clientData.id}] Stream write error:`, e.message);
                    }
                } catch (e) {
                    console.error('Error writing to push stream:', e);
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

    if (clientData.speechService) {
        clientData.speechService.close();
    }

    clientData.speechService = speechService.recognizeSpeech(
        clientData.config.sourceLang,
        (text) => handleRecognizedText(ws, text),
        (text) => console.log(`[${clientData.id}] Recognizing: ${text}`)
    );
}

async function handleRecognizedText(ws, text) {
    if (!text) return;
    const clientData = clients.get(ws);
    if (!clientData || !clientData.roomId) return;

    console.log(`[${clientData.id}] Recognized: ${text}`);

    try {
        // Use BASE language codes for translation API
        const translatedText = await translationService.translateText(
            text,
            clientData.config.sourceLangBase,  // Use "te" not "te-IN"
            clientData.config.targetLangBase   // Use "en" not "en-US"
        );
        console.log(`[${clientData.id}] Translated: ${translatedText}`);

        if (!translatedText) return;

        // Send transcript to the speaking user (original text + their own translation)
        if (ws.readyState === WebSocket.OPEN) {
            const transcriptData = JSON.stringify({
                type: 'transcript',
                original: text,
                translated: translatedText,
                isLocal: true,
                timestamp: new Date().toISOString()
            });
            ws.send(transcriptData);
            console.log(`[${clientData.id}] Sent transcript to speaker`);
        }

        const { synthesizeSpeech } = require('./azureTtsService');

        // ... (inside handleRecognizedText) ...

        const audioBuffer = await synthesizeSpeech(
            translatedText,
            clientData.config.targetLang,  // Use full code for TTS (en-US)
            clientData.config.voiceName
        );
        console.log(`[${clientData.id}] Synthesized WAV audio (Google TTS) size: ${audioBuffer.byteLength}`);

        // Broadcast audio and transcript to OTHER users in the room
        const room = rooms.get(clientData.roomId);
        if (room) {
            // Calculate how long the TTS audio will play
            const playbackDurationMs = calculatePlaybackDurationMs(audioBuffer);
            // Verify room state
            console.log(`[${clientData.id}] TTS generated successfully. Size: ${audioBuffer.byteLength} bytes. Duration: ${playbackDurationMs.toFixed(0)}ms. Room Size: ${room.size}`);

            // DEBUG: Echo back to speaker if they are alone (for testing)
            if (room.size === 1) {
                console.log(`[${clientData.id}] TEST MODE: Echoing TTS back to speaker because room is empty.`);
                ws.send(audioBuffer);
            }

            room.forEach(client => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    const recipientData = clients.get(client);

                    // HALF-DUPLEX: Set speaking flag for recipient
                    // This will gate their microphone audio during TTS playback
                    if (recipientData) {
                        // Clear any existing timeout
                        if (recipientData.speakingTimeout) {
                            clearTimeout(recipientData.speakingTimeout);
                        }

                        // Gate mic audio for this recipient
                        recipientData.isSpeaking = true;
                        console.log(`[${recipientData.id}] HALF-DUPLEX: Gating mic for ${playbackDurationMs.toFixed(0)}ms`);

                        // Resume mic after playback completes
                        recipientData.speakingTimeout = setTimeout(() => {
                            recipientData.isSpeaking = false;
                            recipientData.speakingTimeout = null;
                            console.log(`[${recipientData.id}] HALF-DUPLEX: Mic resumed`);
                        }, playbackDurationMs);
                    }

                    // Send audio
                    client.send(audioBuffer);

                    // Send transcript text
                    const transcriptData = JSON.stringify({
                        type: 'transcript',
                        original: text,
                        translated: translatedText,
                        isLocal: false,
                        timestamp: new Date().toISOString()
                    });
                    client.send(transcriptData);
                }
            });
            console.log(`[${clientData.id}] Broadcast to ${room.size - 1} other users`);
        }

    } catch (error) {
        console.error('Error in processing pipeline:', error);
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
