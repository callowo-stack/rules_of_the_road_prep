const express = require('express');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.get('/api/search', async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: 'query is required' });

  const apiKey = process.env.GOOGLE_API_KEY;
  const cseId = process.env.GOOGLE_CSE_ID;
  if (!apiKey || !cseId) {
    return res.status(500).json({ error: 'Google API credentials not configured' });
  }

  const searchQuery = `site:x.com ${query}`;
  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', apiKey);
  url.searchParams.set('cx', cseId);
  url.searchParams.set('q', searchQuery);
  url.searchParams.set('num', '10');
  url.searchParams.set('dateRestrict', 'd7');

  try {
    const response = await fetch(url.toString());
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(502).json({ error: err.error?.message || 'Google search failed' });
    }
    const data = await response.json();
    const items = (data.items || []).filter(item =>
      /x\.com\/\w+\/status\/\d+/.test(item.link)
    );
    const posts = items.map(item => ({
      title: item.title || '',
      snippet: item.snippet || '',
      link: item.link,
      author: extractAuthor(item.link),
    }));
    res.json({ posts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/draft', async (req, res) => {
  const { snippet, author } = req.body;
  if (!snippet) return res.status(400).json({ error: 'snippet is required' });

  const prompt = `You are helping draft a reply to an X (Twitter) post.

Post by @${author || 'unknown'}:
"${snippet}"

Respond with valid JSON only (no markdown, no extra text) in this exact shape:
{
  "reply": "<a genuine, engaging reply in exactly 10 words>",
  "imagePrompt": "<a vivid, specific image generation prompt that would complement the reply>"
}`;

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = message.content[0].text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(502).json({ error: 'Unexpected response from Claude' });
    const parsed = JSON.parse(jsonMatch[0]);
    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function extractAuthor(link) {
  const match = link.match(/x\.com\/([^/]+)\/status\//);
  return match ? match[1] : 'unknown';
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`X Engagement Helper → http://localhost:${PORT}`));
