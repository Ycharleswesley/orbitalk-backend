const claudeService = require('./claudeService');
require('dotenv').config();

async function test() {
    console.log('--- Claude AI Integration Test ---');

    if (!process.env.ANTHROPIC_API_KEY) {
        console.error('ERROR: ANTHROPIC_API_KEY is not set in .env file.');
        return;
    }

    const text = 'Hello, how are you today?';
    const sourceLang = 'English';
    const targetLang = 'Hindi';

    console.log(`Testing translation: "${text}" from ${sourceLang} to ${targetLang}...`);

    const result = await claudeService.translateText(text, sourceLang, targetLang);

    if (result) {
        console.log('SUCCESS!');
        console.log('Translated Text:', result);
    } else {
        console.log('FAILED: No result from Claude Service.');
    }
}

test();
