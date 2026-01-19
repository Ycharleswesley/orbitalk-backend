const fs = require('fs');
require('dotenv').config();

function setupGoogleCredentials() {
    const credentialsPath = './google-credentials.json';

    // If the file already exists (local dev), do nothing
    if (fs.existsSync(credentialsPath)) {
        console.log('(GoogleConfig) Credentials file found locally.');
        return;
    }

    // On Render, we expect the JSON content in the GOOGLE_CREDENTIALS_JSON env var
    const credentialsContent = process.env.GOOGLE_CREDENTIALS_JSON;

    if (!credentialsContent) {
        console.warn('(GoogleConfig) WARNING: GOOGLE_CREDENTIALS_JSON environment variable is missing!');
        return;
    }

    try {
        // Just write the string directly to the file
        // (Render env vars handles newlines correctly mostly, but we ensure it's a string)
        fs.writeFileSync(credentialsPath, credentialsContent.toString());
        console.log('(GoogleConfig) Successfully created google-credentials.json from environment variable.');
    } catch (error) {
        console.error('(GoogleConfig) Failed to create credentials file:', error);
    }
}

module.exports = { setupGoogleCredentials };
