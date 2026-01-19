const sdk = require('microsoft-cognitiveservices-speech-sdk');
require('dotenv').config();

function synthesizeSpeech(text, languageCode, voiceName) {
    if (!process.env.AZURE_SPEECH_KEY || !process.env.AZURE_SPEECH_REGION) {
        throw new Error('AZURE_SPEECH_KEY or AZURE_SPEECH_REGION not set!');
    }

    const speechConfig = sdk.SpeechConfig.fromSubscription(
        process.env.AZURE_SPEECH_KEY,
        process.env.AZURE_SPEECH_REGION
    );

    speechConfig.speechSynthesisLanguage = languageCode;
    speechConfig.speechSynthesisVoiceName = voiceName;

    // Set output format onto the config directly
    speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Riff16Khz16BitMonoPcm;

    const synthesizer = new sdk.SpeechSynthesizer(speechConfig);

    return new Promise((resolve, reject) => {
        synthesizer.speakTextAsync(
            text,
            (result) => {
                if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
                    console.log(`(AzureTTS) Synthesis finished for: ${text.substring(0, 20)}...`);
                    // result.audioData is an ArrayBuffer, convert to Node.js Buffer
                    const buffer = Buffer.from(result.audioData);
                    resolve(buffer);
                } else {
                    console.error('(AzureTTS) Synthesis canceled, ' + result.errorDetails);
                    reject(new Error(result.errorDetails));
                }
                synthesizer.close();
            },
            (err) => {
                console.error('(AzureTTS) Error:', err);
                synthesizer.close();
                reject(err);
            }
        );
    });
}

module.exports = { synthesizeSpeech };
