const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config();

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
});

async function translateText(text, sourceLang, targetLang, conversationHistory = []) {
    if (!process.env.ANTHROPIC_API_KEY) {
        console.error('ANTHROPIC_API_KEY is missing. Falling back to default behavior.');
        return null;
    }

    try {
        const systemPrompt = `You are a professional real-time translator for the OrbiTalk app. 
Translate the student's text from ${sourceLang} to ${targetLang}.
Guidelines:
- Maintain the original tone and emotion.
- Provide ONLY the translated text. No explanations or extra words.
- If the text is a greeting, keep it natural.
- Handle colloquialisms appropriately for ${targetLang}.`;

        const messages = conversationHistory.slice(-5).map(msg => ({
            role: msg.role === 'me' ? 'user' : 'assistant',
            content: msg.text
        }));

        messages.push({
            role: 'user',
            content: `Translate this: ${text}`
        });

        const response = await anthropic.messages.create({
            model: 'claude-3-5-sonnet-20240620',
            max_tokens: 1024,
            system: systemPrompt,
            messages: messages,
        });

        return response.content[0].text;
    } catch (error) {
        console.error('Claude Translation Error:', error);
        return null;
    }
}

module.exports = {
    translateText
};
