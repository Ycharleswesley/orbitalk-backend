const speech = require('@google-cloud/speech');
const path = require('path');
require('dotenv').config();

// Explicitly point to the JSON key file (Standardizing with googleTtsService.js)
const keyFilename = path.join(__dirname, 'orbitalk-71684-052d52ec0144.json');

// Initialize Google Speech Client
const client = new speech.SpeechClient({
    keyFilename: keyFilename
});

function recognizeSpeech(sourceLang, onRecognized, onRecognizing) {
    console.log(`(GoogleSpeech) Initializing stream for language: ${sourceLang}`);

    const request = {
        config: {
            encoding: 'LINEAR16',
            sampleRateHertz: 16000,
            languageCode: sourceLang,
            enableAutomaticPunctuation: true,
            model: 'default', // 'latest_long' or 'command_and_search' might be better for some languages
        },
        interimResults: true, // Needed for 'Recognizing' events
    };

    // Create a streaming recognition stream
    const recognizeStream = client
        .streamingRecognize(request)
        .on('error', (error) => {
            console.error(`(GoogleSpeech) Stream Error: ${error}`);
            // Don't crash the server, just log
        })
        .on('data', (data) => {
            // Check if results exist
            if (data.results[0] && data.results[0].alternatives[0]) {
                const result = data.results[0];
                const transcript = result.alternatives[0].transcript;

                if (result.isFinal) {
                    console.log(`(GoogleSpeech) Recognized: ${transcript}`);
                    if (onRecognized) onRecognized(transcript);
                } else {
                    console.log(`(GoogleSpeech) Recognizing: ${transcript}`);
                    if (onRecognizing) onRecognizing(transcript);
                }
            }
        })
        .on('end', () => {
            console.log('(GoogleSpeech) Stream ended.');
        });

    // Provide the interface expected by server.js
    return {
        pushStream: recognizeStream, // Google stream is a Writable Stream, compatible with .write()
        close: () => {
            console.log('(GoogleSpeech) Closing stream.');
            recognizeStream.end();
            recognizeStream.destroy();
        }
    };
}

module.exports = { recognizeSpeech };
