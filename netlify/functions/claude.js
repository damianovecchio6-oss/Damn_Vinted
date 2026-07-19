const https = require('https');

const GROQ_KEY = process.env.GROQ_KEY;

function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

// Chiama Groq con retry su errori transitori (429 rate limit, 5xx server error)
async function callGroqWithRetry(payload, maxRetries) {
  maxRetries = maxRetries || 2;
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.groq.com',
        path: '/openai/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_KEY}`,
          'Content-Length': Buffer.byteLength(payload)
        }
      };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });

    const retriable = result.status === 429 || result.status >= 500;
    if (!retriable || attempt === maxRetries) return result;

    lastErr = result;
    await sleep(500 * Math.pow(2, attempt));
  }
  return lastErr;
}

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: cors, body: '' };
  }

  if (!GROQ_KEY) {
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'GROQ_KEY non configurata su Netlify (Site settings > Environment variables)' })
    };
  }

  try {
    const { type, prompt, imageBase64, imageMime, creative } = JSON.parse(event.body);

    let messages;
    if (type === 'image') {
      const mime = (imageMime === 'image/png') ? 'image/png' : 'image/jpeg';
      messages = [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mime};base64,${imageBase64}` } }
        ]
      }];
    } else {
      messages = [{ role: 'user', content: prompt }];
    }

    const model = type === 'image' ? 'qwen/qwen3.6-27b' : 'openai/gpt-oss-120b';
    const reasoningEffort = type === 'image' ? 'none' : 'low';
    const temperature = creative ? 0.9 : 0.2;

    const payload = JSON.stringify({
      model,
      messages,
      max_tokens: 1536,
      reasoning_effort: reasoningEffort,
      temperature
    });

    const result = await callGroqWithRetry(payload, 2);

    if (result.status === 429) {
      throw new Error('Troppe richieste in questo momento, riprova tra qualche secondo.');
    }
    if (result.status >= 500) {
      throw new Error('Il servizio AI non risponde al momento, riprova tra poco.');
    }

    const data = JSON.parse(result.body);
    if (data.error) throw new Error(data.error.message);

    let text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('Risposta vuota: ' + JSON.stringify(data));

    text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    if (text.includes('<think>')) {
      text = text.split('<think>')[0].trim();
    }
    if (!text) throw new Error('Il modello non ha completato la risposta in tempo, riprova.');

    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    };

  } catch (e) {
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: e.message })
    };
  }
};
