const { Translate } = require('@google-cloud/translate').v2;
const path = require('path');
require('dotenv').config();

// Explicitly point to the JSON key file (Standardizing with other services)
const keyFilename = path.join(__dirname, 'orbitalk-71684-052d52ec0144.json');

// Initialize Google Translate Client
const translate = new Translate({
    keyFilename: keyFilename
});

/**
 * Translates text from source language to target language.
 * @param {string} text - The text to translate.
 * @param {string} sourceLang - The source language code (e.g., 'en', 'bn').
 * @param {string} targetLang - The target language code (e.g., 'es', 'te').
 * @returns {Promise<string|null>} - The translated text or null on failure.
 */
async function translateText(text, sourceLang, targetLang) {
    try {
        console.log(`(GoogleTranslate) Translating "${text}" from ${sourceLang} to ${targetLang}`);

        // Google Translate API expects just the target language (it auto-detects source usually, but we can assume from/to are handled if needed, 
        // essentially v2 translate(text, target) is the standard call. 
        // However, we can pass options if we want to enforce source.)

        // Check if languages are same, return text
        if (sourceLang === targetLang) return text;

        const [translation] = await translate.translate(text, targetLang);

        console.log(`(GoogleTranslate) Result: "${translation}"`);
        return translation;
    } catch (error) {
        console.error('(GoogleTranslate) Error:', error.message);
        // If error is related to API not enabled, log it clearly
        if (error.code === 7 || error.message.includes('API has not been used')) {
            console.error('CRITICAL: You must enable "Cloud Translation API" in Google Console!');
        }
        throw error;
    }
}

module.exports = { translateText };
