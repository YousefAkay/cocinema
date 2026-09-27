import 'dotenv/config';

const API_KEY = process.env.OPENAI_API_KEY;
const BASE_URL = 'https://api.openai.com/v1/embeddings';

if (!API_KEY) {
  console.error('Missing OPENAI_API_KEY. Add it to your .env file.');
  process.exit(1);
}

export async function getEmbedding(text) {
  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: text,
      dimensions: 512
    })
  });

  if (!res.ok) {
    throw new Error(`OpenAI request failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  return data.data[0].embedding.map(n => Number(n.toFixed(4)));
}
