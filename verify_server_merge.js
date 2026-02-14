const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, 'server.js');

try {
    const content = fs.readFileSync(serverPath, 'utf8');

    // Check for syntax errors by attempting to parse (basic check)
    // Note: This won't catch everything but will catch major syntax errors
    // Since we can't 'require' it without dependencies running (like firebase admin creds),
    // we'll do static analysis.

    // 1. Check if Claude is removed
    if (content.includes("require('./claudeService')") && !content.includes("// const claudeService")) {
        console.error("FAIL: claudeService seems to be present.");
        process.exit(1);
    }

    // 2. Check for startSpeechService presence
    if (!content.includes("function startSpeechService(ws, clientData)")) {
        console.error("FAIL: startSpeechService missing.");
        process.exit(1);
    }

    // 3. Check for handleRecognizedText presence
    if (!content.includes("async function handleRecognizedText(ws, text)")) {
        console.error("FAIL: handleRecognizedText missing.");
        process.exit(1);
    }

    // 4. Check for notify-call endpoint
    if (!content.includes("/notify-call")) {
        console.error("FAIL: /notify-call endpoint missing (Ringtone feature lost!).");
        process.exit(1);
    }

    // 5. Check for "Force Finalizing (1.0s Silence" string (specific to robust version)
    if (!content.includes("Force Finalizing (1.0s Silence")) {
        console.error("FAIL: Working logic (1.0s Silence Rule) seems missing.");
        process.exit(1);
    }

    // 6. CRITICAL: Check for checkRoomReady signaling
    if (!content.includes("checkRoomReady(clientData.roomId);")) {
        console.error("FAIL: checkRoomReady() missing. Calls will not connect!");
        process.exit(1);
    }

    console.log("SUCCESS: Server file passed static verification.");
} catch (e) {
    console.error("FAIL: Error reading or checking file:", e);
    process.exit(1);
}
