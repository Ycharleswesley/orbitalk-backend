# UTELO Backend

Real-time voice translation WebSocket server using Google Cloud Speech & Translate APIs.

## Features

- **WebSocket Communication**: Real-time bidirectional audio streaming
- **Speech-to-Text (STT)**: Continuous speech recognition using Google Cloud Speech-to-Text
- **Translation**: Real-time text translation using Google Cloud Translation API
- **Text-to-Speech (TTS)**: Synthesized audio output using Google Cloud Text-to-Speech (Neural2/Wavenet)
- **Smart Chunking**: Optimized latency by processing audio in chunks
- **Room Management**: Multi-user room support for pairing callers
- **Half-Duplex Control**: Echo prevention during TTS playback

## Prerequisites

- Node.js v16 or higher
- Google Cloud Platform Account (Speech, Translate, TTS APIs enabled)
- Google Service Account Credentials JSON

## Installation

```bash
npm install
```

## Configuration

Create a `.env` file in this directory (or set environment variables):

```env
# Server Port
PORT=8080

# Google Credentials
# Option 1: Path to local JSON file
GOOGLE_APPLICATION_CREDENTIALS=./google-credentials.json

# Option 2: Render.com Secret File / Environment Variable
GOOGLE_CREDENTIALS_JSON={ ... entire json content ... }
```

> **Note**: The `config.js` file contains default configuration. Environment variables take precedence when set.

## Running

### Development
```bash
npm start
```

The server will start on `ws://localhost:8080` (or the PORT specified).

### Production
Deploy to a Node.js hosting service (Render.com, Heroku, AWS, etc.)

## API Reference

### WebSocket Connection

Connect to: `ws://localhost:8080` (local) or `wss://your-domain.com` (production)

### Message Protocol

#### 1. Configuration Message (JSON)
Send immediately after connecting:

```json
{
  "type": "config",
  "sourceLang": "en",
  "targetLang": "hi",
  "roomId": "room-123"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Must be `"config"` |
| `sourceLang` | string | Source language code (e.g., `"en"`, `"hi"`, `"te"`) |
| `targetLang` | string | Target language code |
| `roomId` | string | Room ID for pairing users |

#### 2. Audio Data (Binary)
Stream raw PCM audio data:
- Sample rate: 16kHz
- Bit depth: 16-bit
- Channels: Mono

#### 3. Transcript Response (JSON)
Received when speech is recognized:

```json
{
  "type": "transcript",
  "original": "Hello, how are you?",
  "translated": "नमस्ते, आप कैसे हैं?",
  "isLocal": false,
  "timestamp": "2025-12-17T08:30:00.000Z"
}
```

#### 4. Translated Audio (Binary)
Received as WAV audio data (16kHz, 16-bit, mono) with 44-byte header.

## Supported Languages

| Code | Language |
|------|----------|
| `en` | English |
| `hi` | Hindi |
| `te` | Telugu |
| `ta` | Tamil |
| `kn` | Kannada |
| `ml` | Malayalam |
| `mr` | Marathi |
| `bn` | Bengali |
| `gu` | Gujarati |
| `pa` | Punjabi |
| `ur` | Urdu |

## Project Structure

```
backend/
├── server.js              # Main WebSocket server
├── speechService.js       # Azure Speech SDK (STT/TTS)
├── translationService.js  # Azure Translator API
├── languageMapper.js      # Language code mapping
├── config.js              # Configuration
├── package.json           # Dependencies
├── .env.example           # Environment template
└── render.yaml            # Render.com deployment config
```

## Deployment to Render.com

1. Push this folder to a GitHub repository
2. Create a new Web Service on [Render.com](https://render.com)
3. Connect your repository
4. Configure:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. Add environment variables in Render dashboard
6. Deploy

Your WebSocket URL will be: `wss://orbitalk-backend.onrender.com`

## Troubleshooting

### Connection Refused
- Check if server is running
- Verify correct port in client

### No Translation Output
- Verify Azure API keys are valid
- Check Render/server logs for errors
- Ensure audio format is correct (16kHz, 16-bit, mono PCM)

### Echo/Feedback Loop
- The server implements half-duplex mode to prevent this
- Client should also mute mic during audio playback
