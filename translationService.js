const { Translate } = require('@google-cloud/translate').v2;
require('dotenv').config();

// Initialize Google Translate Client
// We assume googleConfig.js has already run validation and creation of credentials file
const translate = new Translate({
    keyFilename: './google-credentials.json'
});

/**
 * Translates text from source language to target language using Google Translate.
 * @param {string} text - The text to translate.
 * @param {string} sourceLang - The source language code (e.g., 'en', 'te').
 * @param {string} targetLang - The target language code (e.g., 'es', 'en').
 * @returns {Promise<string|null>} - The translated text or null on failure.
 */
async function translateText(text, sourceLang, targetLang) {
    if (!text) return text;
    if (sourceLang === targetLang) return text;

    try {
        console.log(`(GoogleTranslate) Translating "${text}" from ${sourceLang} to ${targetLang}`);

        // Google Translate v2 usually auto-detects source, but we can specify it.
        // It returns [translation, metadata]
        const [translation] = await translate.translate(text, targetLang);

        console.log(`(GoogleTranslate) Result: "${translation}"`);
        return translation;

    } catch (error) {
        console.error('(GoogleTranslate) Error:', error.message);
        return null;
    }
}

module.exports = { translateText };
