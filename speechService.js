const speech = require('@google-cloud/speech');
const { Transform } = require('stream');

// Initialize Google Speech Client
const client = new speech.SpeechClient({
    keyFilename: './google-credentials.json' // Generated at runtime by googleConfig.js
});

/**
 * Recognizes speech from an audio stream using Google Cloud Speech-to-Text.
 * @param {string} languageCode - The language code (e.g., 'en-US').
 * @param {Function} onTextRecognized - Callback when final text is recognized.
 * @param {Function} onInterimText - Callback for interim results (optional).
 * @returns {Object} - An object containing the writable stream and a close function.
 */
function recognizeSpeech(languageCode, onTextRecognized, onInterimText) {
    const request = {
        config: {
            encoding: 'LINEAR16',
            sampleRateHertz: 16000,
            languageCode: languageCode,
            enableAutomaticPunctuation: true,
        },
        interimResults: true, // Get partial results
    };

    // Create the recognition stream
    const recognizeStream = client
        .streamingRecognize(request)
        .on('error', (error) => {
            console.error(`(GoogleSpeech) Error: ${error.message}`);
        })
        .on('data', (data) => {
            if (data.results[0] && data.results[0].alternatives[0]) {
                const result = data.results[0];
                const transcript = result.alternatives[0].transcript;

                if (result.isFinal) {
                    onTextRecognized(transcript);
                } else {
                    if (onInterimText) {
                        onInterimText(transcript);
                    }
                }
            }
        });

    // Create a Transform stream to accept incoming audio chunks
    // This allows us to pipe or write to it directly
    const pushStream = new Transform({
        transform(chunk, encoding, callback) {
            recognizeStream.write(chunk);
            callback();
        }
    });

    return {
        write: (buffer) => {
            // Write to the wrapper stream which writes to Google stream
            pushStream.write(buffer);
        },
        close: () => {
            console.log('(GoogleSpeech) Closing recognition stream');
            try {
                if (pushStream) pushStream.end();
                if (recognizeStream) recognizeStream.end();
            } catch (e) {
                console.error('(GoogleSpeech) Error closing streams:', e);
            }
        }
    };
}

module.exports = { recognizeSpeech };
