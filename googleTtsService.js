const textToSpeech = require('@google-cloud/text-to-speech');
const fs = require('fs');
const util = require('util');
const path = require('path');
require('dotenv').config();

// Initialize the client
// We explicitly point to the JSON key file to ensure it's found
const keyFilename = path.join(__dirname, 'orbitalk-71684-052d52ec0144.json');

const client = new textToSpeech.TextToSpeechClient({
    keyFilename: keyFilename
});

/**
 * Synthesize speech from text using Google Cloud TTS
 * @param {string} text - The text to speak
 * @param {string} languageCode - e.g., 'en-US', 'hi-IN'
 * @param {string} voiceName - Optional specific voice name
 * @returns {Promise<Buffer>} - Audio buffer (WAV format)
 */
async function synthesizeSpeech(text, languageCode = 'en-US', voiceName = null) {
    try {
        const request = {
            input: { text: text },
            // Select the language and SSML voice gender (optional)
            voice: {
                languageCode: languageCode,
                // device_profile options: wearable-class-device, handset-class-device, headphone-class-device, small-bluetooth-speaker-class-device, medium-bluetooth-speaker-class-device, large-home-entertainment-class-device, large-automotive-class-device, telephony-class-application
                name: voiceName
            },
            // select the type of audio encoding
            audioConfig: {
                audioEncoding: 'LINEAR16', // WAV format (16-bit PCM)
                sampleRateHertz: 16000     // Match local playback 16k rate
            },
        };

        // Performs the text-to-speech request
        const [response] = await client.synthesizeSpeech(request);
        return response.audioContent;

    } catch (error) {
        console.error('Google Cloud TTS Error:', error);
        throw error;
    }
}

module.exports = { synthesizeSpeech };
