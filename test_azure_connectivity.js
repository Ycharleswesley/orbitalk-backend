const sdk = require("microsoft-cognitiveservices-speech-sdk");
require('dotenv').config();

const speechConfig = sdk.SpeechConfig.fromSubscription(process.env.SPEECH_KEY, process.env.SPEECH_REGION);
speechConfig.speechRecognitionLanguage = "en-US";

console.log(`Testing connection to Region: ${process.env.SPEECH_REGION}`);
console.log(`Key length: ${process.env.SPEECH_KEY ? process.env.SPEECH_KEY.length : 'MISSING'}`);

const recognizer = new sdk.SpeechRecognizer(speechConfig);

recognizer.canceled = (s, e) => {
    console.error(`CANCELED: Reason=${e.reason}`);
    if (e.reason === sdk.CancellationReason.Error) {
        console.error(`CANCELED: ErrorCode=${e.errorCode}`);
        console.error(`CANCELED: ErrorDetails=${e.errorDetails}`);
        console.error("Possible causes: Wrong Region, Invalid Key, or Firewall blocking WebSockets.");
    }
    recognizer.close();
};

recognizer.sessionStarted = (s, e) => {
    console.log("Session started successfully! Connection is GOOD.");
    recognizer.close();
};

recognizer.sessionStopped = (s, e) => {
    console.log("Session stopped.");
};

console.log("Attempting to start session...");
recognizer.startContinuousRecognitionAsync();

// Stop after 5 seconds
setTimeout(() => {
    console.log("Test timeout.");
    recognizer.close();
}, 5000);
