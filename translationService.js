const axios = require('axios');
require('dotenv').config();

// Azure Translator Endpoint
// Global: https://api.cognitive.microsofttranslator.com
// Regional: https://<region>.api.cognitive.microsofttranslator.com (But standard global endpoint usually works with region header)
const endpoint = "https://api.cognitive.microsofttranslator.com";

/**
 * Translates text from source language to target language using Azure Translator.
 * @param {string} text - The text to translate.
 * @param {string} sourceLang - The source language code (e.g., 'en', 'te').
 * @param {string} targetLang - The target language code (e.g., 'es', 'en').
 * @returns {Promise<string|null>} - The translated text or null on failure.
 */
async function translateText(text, sourceLang, targetLang) {
    if (!text) return text;
    if (sourceLang === targetLang) return text;

    if (!process.env.AZURE_TRANSLATOR_KEY || !process.env.AZURE_TRANSLATOR_REGION) {
        console.error('AZURE_TRANSLATOR_KEY or AZURE_TRANSLATOR_REGION not set!');
        return null;
    }

    try {
        console.log(`(AzureTranslate) Translating "${text}" from ${sourceLang} to ${targetLang}`);

        const response = await axios({
            baseURL: endpoint,
            url: '/translate',
            method: 'post',
            headers: {
                'Ocp-Apim-Subscription-Key': process.env.AZURE_TRANSLATOR_KEY,
                'Ocp-Apim-Subscription-Region': process.env.AZURE_TRANSLATOR_REGION,
                'Content-type': 'application/json',
                'X-ClientTraceId': require('uuid').v4().toString()
            },
            params: {
                'api-version': '3.0',
                'from': sourceLang,
                'to': targetLang
            },
            data: [{
                'text': text
            }],
            responseType: 'json'
        });

        if (response.data && response.data[0] && response.data[0].translations) {
            const translation = response.data[0].translations[0].text;
            console.log(`(AzureTranslate) Result: "${translation}"`);
            return translation;
        } else {
            console.error('(AzureTranslate) Unexpected response structure:', JSON.stringify(response.data));
            return null;
        }

    } catch (error) {
        console.error('(AzureTranslate) Error:', error.message);
        if (error.response) {
            console.error('Response data:', JSON.stringify(error.response.data));
        }
        return null;
    }
}

module.exports = { translateText };
