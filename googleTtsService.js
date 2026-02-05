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
    const buildRequest = (useVoiceName) => ({
        input: { text: text },
        voice: {
            languageCode: languageCode,
            ...(useVoiceName && voiceName ? { name: voiceName } : {}),
        },
        audioConfig: {
            audioEncoding: 'LINEAR16', // Output format (Raw PCM for SoundStream)
            sampleRateHertz: 16000,   // Match frontend sample rate
            effectsProfileId: ['telephony-class-application'],
        },
    });

    try {
        if (voiceName) {
            console.log(`(GoogleTTS) Using voice: ${voiceName} (${languageCode})`);
        } else {
            console.log(`(GoogleTTS) Using default voice for ${languageCode}`);
        }
        const [response] = await client.synthesizeSpeech(buildRequest(true));
        // Google LINEAR16 returns a WAV file (with 44-byte header).
        // Flutter sound_stream expects RAW PCM. We must strip the header.
        if (response.audioContent && response.audioContent.length > 44) {
            return response.audioContent.slice(44);
        }
        return response.audioContent;
    } catch (error) {
        const message = error?.message || '';
        const isInvalidVoice =
            voiceName &&
            (error?.code === 3 ||
                message.includes('INVALID_ARGUMENT') ||
                message.includes('does not exist') ||
                message.includes('Voice'));

        if (isInvalidVoice) {
            console.warn(`(GoogleTTS) Voice "${voiceName}" invalid. Retrying with default voice for ${languageCode}.`);
            try {
                console.log(`(GoogleTTS) Using default voice for ${languageCode}`);
                const [response] = await client.synthesizeSpeech(buildRequest(false));
                if (response.audioContent && response.audioContent.length > 44) {
                    return response.audioContent.slice(44);
                }
                return response.audioContent;
            } catch (retryError) {
                console.error('(GoogleTTS) Retry failed:', retryError);
                throw retryError;
            }
        }

        console.error('(GoogleTTS) Synthesis Error:', error);
        throw error;
    }
}

/**
 * Streams synthesized speech from text using Google Cloud Text-to-Speech.
 * @param {string} text - The text to synthesize.
 * @param {string} languageCode - The language code.
 * @param {string} voiceName - The specific voice name.
 * @returns {object} - The writable stream to pipe text into (actually we write a config and input).
 */
function streamSpeech(text, languageCode, voiceName) {
    // Note: Google's streamingSynthesize is actually a bidirectional stream, 
    // but for simple TTS we just write the config + input once and read the output.

    const stream = client.streamingSynthesize();

    // 1. Send Config
    stream.write({
        streamingConfig: {
            audioConfig: {
                audioEncoding: 'LINEAR16',
                sampleRateHertz: 16000,
                effectsProfileId: ['telephony-class-application'],
            },
            voice: {
                languageCode: languageCode,
                name: voiceName,
            },
        },
    });

    // 2. Send Text Input
    stream.write({
        input: { text: text },
    });

    // 3. Close write end so Google knows we are done sending text
    stream.end();

    return stream;
}

module.exports = { synthesizeSpeech, streamSpeech };
