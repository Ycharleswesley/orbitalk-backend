// Language code mapper for Google Cloud Speech Service
// Maps short language codes to Google-compatible locale codes

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

// Google Cloud Voice names
const voiceMap = {
    'en-US': 'en-US-Neural2-J',      // English (US)
    'hi-IN': 'hi-IN-Neural2-A',      // Hindi
    'mr-IN': 'mr-IN-Wavenet-A',      // Marathi
    'bn-IN': 'bn-IN-Wavenet-A',      // Bengali
    'ta-IN': 'ta-IN-Wavenet-A',      // Tamil
    'te-IN': 'te-IN-Standard-A',     // Telugu (Wavenet might not be available in all tiers, Standard is safe)
    'ml-IN': 'ml-IN-Wavenet-A',      // Malayalam
    'kn-IN': 'kn-IN-Wavenet-A',      // Kannada
    'pa-IN': 'pa-IN-Wavenet-A',      // Punjabi
    'gu-IN': 'gu-IN-Wavenet-A',      // Gujarati
    'ur-IN': 'ur-IN-Wavenet-A',      // Urdu (India)
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
