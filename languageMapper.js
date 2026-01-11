// Language code mapper for Azure Speech Service
// Maps short language codes to Azure locale codes

const languageMap = {
    // English
    'en': 'en-US',

    // Hindi
    'hi': 'hi-IN',

    // Marathi
    'mr': 'mr-IN',

    // Bengali
    'bn': 'bn-IN',

    // Tamil
    'ta': 'ta-IN',

    // Telugu
    'te': 'te-IN',

    // Malayalam
    'ml': 'ml-IN',

    // Kannada
    'kn': 'kn-IN',

    // Punjabi
    'pa': 'pa-IN',

    // Gujarati
    'gu': 'gu-IN',

    // Urdu
    'ur': 'ur-IN',
};

// Google Cloud TTS Voice names
const voiceMap = {
    'en-US': 'en-US-Standard-C',     // Female, Standard (Safer than Neural2)
    'hi-IN': 'hi-IN-Neural2-B',     // Male, Neural (or A/C/D)
    'mr-IN': 'mr-IN-Standard-A',
    'bn-IN': 'bn-IN-Standard-A',
    'ta-IN': 'ta-IN-Standard-A',
    'te-IN': 'te-IN-Standard-A',
    'ml-IN': 'ml-IN-Standard-A',
    'kn-IN': 'kn-IN-Standard-A',
    'pa-IN': 'pa-IN-Standard-A',
    'gu-IN': 'gu-IN-Standard-A',
    'ur-IN': 'ur-IN-Standard-A',
};

function mapLanguageCode(langCode) {
    if (!langCode) {
        return 'en-US'; // Default fallback
    }

    const normalized = langCode.toLowerCase().trim();

    // If already in correct format (xx-XX), return as-is
    if (/^[a-z]{2}-[A-Z]{2}$/.test(langCode)) {
        return langCode;
    }

    // Map from short code to full locale
    const mapped = languageMap[normalized];

    if (mapped) {
        return mapped;
    }

    // If not found, return default
    console.warn(`Unknown language code: ${langCode}, defaulting to en-US`);
    return 'en-US';
}

function getVoiceNameForLang(langCode) {
    const voice = voiceMap[langCode];
    if (voice) {
        return voice;
    }

    // Default to English voice if not found
    console.warn(`No voice found for ${langCode}, using en-US-Standard-C`);
    return 'en-US-Standard-C';
}

module.exports = { mapLanguageCode, getVoiceNameForLang };
