const sdk = require('microsoft-cognitiveservices-speech-sdk');
require('dotenv').config();

function recognizeSpeech(sourceLang, onRecognized, onRecognizing) {
    if (!process.env.AZURE_SPEECH_KEY || !process.env.AZURE_SPEECH_REGION) {
        console.error('AZURE_SPEECH_KEY or AZURE_SPEECH_REGION not set!');
        return { pushStream: null, close: () => { } };
    }

    const speechConfig = sdk.SpeechConfig.fromSubscription(
        process.env.AZURE_SPEECH_KEY,
        process.env.AZURE_SPEECH_REGION
    );

    speechConfig.speechRecognitionLanguage = sourceLang;

    // Create a PushAudioInputStream to push audio data from WebSocket
    const pushStream = sdk.AudioInputStream.createPushStream();

    // Create AudioConfig from the push stream
    const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);

    // Create the SpeechRecognizer
    const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

    console.log(`(AzureSpeech) Initializing recognition for: ${sourceLang}`);

    recognizer.recognizing = (s, e) => {
        if (e.result.text) {
            console.log(`(AzureSpeech) Recognizing: ${e.result.text}`);
            if (onRecognizing) onRecognizing(e.result.text);
        }
    };

    recognizer.recognized = (s, e) => {
        if (e.result.reason === sdk.ResultReason.RecognizedSpeech) {
            console.log(`(AzureSpeech) Recognized: ${e.result.text}`);
            if (onRecognized) onRecognized(e.result.text);
        } else if (e.result.reason === sdk.ResultReason.NoMatch) {
            console.log('(AzureSpeech) NOMATCH: Speech could not be recognized.');
        }
    };

    recognizer.canceled = (s, e) => {
        console.log(`(AzureSpeech) CANCELED: Reason=${e.reason}`);
        if (e.reason === sdk.CancellationReason.Error) {
            console.log(`(AzureSpeech) ErrorDetails=${e.errorDetails}`);
        }
        recognizer.stopContinuousRecognitionAsync();
    };

    recognizer.sessionStopped = (s, e) => {
        console.log('(AzureSpeech) Session stopped.');
        recognizer.stopContinuousRecognitionAsync();
    };

    // Start recognition
    recognizer.startContinuousRecognitionAsync();

    // Create a wrapper to match the interface expected by server.js
    return {
        // server.js calls pushStream.write(buffer)
        pushStream: {
            write: (buffer) => {
                try {
                    pushStream.write(buffer);
                } catch (err) {
                    console.error('(AzureSpeech) Error writing to push stream:', err);
                }
            },
            close: () => {
                try {
                    pushStream.close();
                } catch (err) {
                    console.error('(AzureSpeech) Error closing push stream:', err);
                }
            },
            destroy: () => {
                try {
                    pushStream.close();
                } catch (err) { }
            }
        },
        close: () => {
            console.log('(AzureSpeech) Closing recognizer.');
            try {
                recognizer.stopContinuousRecognitionAsync(() => {
                    recognizer.close();
                    pushStream.close();
                });
            } catch (e) {
                console.error('(AzureSpeech) Error closing:', e);
            }
        }
    };
}

module.exports = { recognizeSpeech };
