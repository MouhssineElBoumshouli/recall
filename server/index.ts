import { createServer } from 'node:http';
import { config } from 'dotenv';
import { GoogleGenAI, Modality } from '@google/genai';

config();

const port = Number(process.env.TOKEN_SERVER_PORT || 8_787);
const apiKey = process.env.GEMINI_API_KEY;
const model = 'gemini-3.5-transcribe-live';

if (!apiKey) {
  console.error('GEMINI_API_KEY is required to start the token server.');
  process.exitCode = 1;
} else {
  const ai = new GoogleGenAI({ apiKey });

  const server = createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }

    if (request.method === 'GET' && request.url === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    if (request.method === 'POST' && request.url === '/token') {
      try {
        const expireTime = new Date(Date.now() + 30 * 60 * 1_000).toISOString();
        const newSessionExpireTime = new Date(Date.now() + 15 * 60 * 1_000).toISOString();
        const token = await ai.authTokens.create({
          config: {
            uses: 1,
            expireTime,
            newSessionExpireTime,
            liveConnectConstraints: {
              model,
              config: {
                responseModalities: [Modality.TEXT],
                inputAudioTranscription: { languageCodes: [] },
              },
            },
            lockAdditionalFields: ['responseModalities', 'inputAudioTranscription'],
          },
        });

        if (!token.name) {
          throw new Error('Gemini returned an empty ephemeral token');
        }

        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ token: token.name, expiresAt: token.expireTime }));
      } catch (error) {
        console.error(
          'Unable to create Gemini ephemeral token:',
          error instanceof Error ? error.message : 'unknown error',
        );
        response.writeHead(502, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'Unable to create an ephemeral Gemini token.' }));
      }
      return;
    }

    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'Not found' }));
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`Recall token server listening on http://0.0.0.0:${port}`);
  });
}
