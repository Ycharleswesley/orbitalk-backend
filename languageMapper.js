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

// Azure Neural Voice names
const voiceMap = {
    'en-US': 'en-US-JennyNeural',
    'hi-IN': 'hi-IN-SwaraNeural',
    'mr-IN': 'mr-IN-AarohiNeural',
    'bn-IN': 'bn-IN-TanishaaNeural',
    'ta-IN': 'ta-IN-PallaviNeural',
    'te-IN': 'te-IN-ShrutiNeural',
    'ml-IN': 'ml-IN-SobhanaNeural',
    'kn-IN': 'kn-IN-SapnaNeural',
    'pa-IN': 'pa-IN-OjasNeural',
    'gu-IN': 'gu-IN-DhwaniNeural',
    'ur-IN': 'ur-IN-GulNeural',
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
