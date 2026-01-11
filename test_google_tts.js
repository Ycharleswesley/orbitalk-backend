const { synthesizeSpeech } = require('./googleTtsService');
const fs = require('fs');
const path = require('path');

async function testGoogleTTS() {
    console.log('Testing Google Cloud TTS...');

    try {
        const text = "నువ్వు ఎలా ఉన్నావు?";
        const lang = 'te-IN';

        console.log(`Synthesizing: "${text}" in ${lang}`);

        const audioBuffer = await synthesizeSpeech(text, lang);

        const outputPath = path.join(__dirname, 'test_output.wav');
        fs.writeFileSync(outputPath, audioBuffer);

        console.log(`Success! Audio saved to: ${outputPath}`);
        console.log(`Audio size: ${audioBuffer.length} bytes`);

    } catch (error) {
        console.error('Test Failed:', error);
    }
}

testGoogleTTS();
