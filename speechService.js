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
 * @param {Function} onError - Callback for stream errors (optional).
 * @returns {Object} - An object containing the writable stream and a close function.
 */
function recognizeSpeech(languageCode, onTextRecognized, onInterimText, onError) {
    const request = {
        config: {
            encoding: 'LINEAR16',
            sampleRateHertz: 16000,
            languageCode: languageCode,
            enableAutomaticPunctuation: true,
            // model: 'latest_long', // Optional: try 'command_and_search' or 'latest_long' if standard fails
            useEnhanced: true,
        },
        interimResults: true, // Get partial results
        singleUtterance: false, // Ensure stream stays open
    };

    // Create the recognition stream
    let recognizeStream;
    try {
        recognizeStream = client
            .streamingRecognize(request)
            .on('error', (error) => {
                console.error(`(GoogleSpeech) Error: ${error.message}`);
                if (onError) onError(error);
            })
            // Pass the 'end' event to the error handler to trigger restart in server.js
            .on('end', () => {
                if (onError) onError(new Error('Stream ended normally'));
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

        return recognizeStream;
    } catch (e) {
        console.error('(GoogleSpeech) Init Error:', e);
        if (onError) onError(e);
        return { write: () => { }, close: () => { } };
    }

    // Create a Transform stream to accept incoming audio chunks
    // This allows us to pipe or write to it directly
    const pushStream = new Transform({
        transform(chunk, encoding, callback) {
            if (recognizeStream && !recognizeStream.destroyed) {
                recognizeStream.write(chunk);
            }
            callback();
        }
    });

    // CRITICAL: Handle errors on the input stream to prevent process crash
    pushStream.on('error', (err) => {
        console.error('(GoogleSpeech) PushStream Error:', err);
        // Delegate to main error handler if available, otherwise just log
        if (onError) onError(err);
    });

    return {
        write: (buffer) => {
            // Write to the wrapper stream which writes to Google stream
            if (pushStream && !pushStream.destroyed) {
                pushStream.write(buffer);
            }
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
