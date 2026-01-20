const textToSpeech = require('@google-cloud/text-to-speech');
const fs = require('fs');
const util = require('util');

// Initialize Google TTS Client
// We assume googleConfig.js has already run validation and creation of credentials file
const client = new textToSpeech.TextToSpeechClient({
    keyFilename: './google-credentials.json'
});

/**
 * Synthesizes speech from text using Google Cloud Text-to-Speech.
 * @param {string} text - The text to synthesize.
 * @param {string} languageCode - The language code (e.g., 'en-US').
 * @param {string} voiceName - The specific voice name (e.g., 'en-US-Neural2-F').
 * @returns {Promise<Buffer>} - The audio buffer (MP3).
 */
async function synthesizeSpeech(text, languageCode, voiceName) {
    if (!text) return null;

    const request = {
        input: { text: text },
        voice: {
            languageCode: languageCode,
            name: voiceName, // e.g. 'en-US-Neural2-J'
        },
        audioConfig: {
            audioEncoding: 'LINEAR16', // Output format (Raw PCM for SoundStream)
            sampleRateHertz: 16000,   // Match frontend sample rate
            effectsProfileId: ['telephony-class-application'],
        },
    };

    try {
        const [response] = await client.synthesizeSpeech(request);
        // Google LINEAR16 returns a WAV file (with 44-byte header).
        // Flutter sound_stream expects RAW PCM. We must strip the header.
        if (response.audioContent && response.audioContent.length > 44) {
            return response.audioContent.slice(44);
        }
        return response.audioContent;
    } catch (error) {
        console.error('(GoogleTTS) Synthesis Error:', error);
        throw error;
    }
}

module.exports = { synthesizeSpeech };
