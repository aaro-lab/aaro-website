import { createHash } from 'crypto';

const SYSTEM_PROMPT = `You are the aaro agent, a concise assistant on the aaro website (aaro.app).

YOU MAY ONLY DISCUSS what is visible on aaro.app, the founder's LinkedIn and Instagram, and general architectural topics. Do NOT mention internal products (neoGEN, neoBIM, UrbanGraphRAG, PlanNext.ai, Landbook) — these are NOT on the website.

WHAT'S ON THE WEBSITE:
- aaro = Architecture Algorithm Research Office, Seoul
- Mission: "From intent to evidence"
- 24 Micro Apps: small algorithms solving atomic architectural problems (Circle Packing, Plant, Bubble Diagram, Brick, Ground Level, Parking, Land Splitter, Unit Splitter, Topography, Furnishing, Offset, WFC, Archboard, Monitoring, Design Scope, Gongsi, AI Legal, Raster→Vector, Planning, GH Canvas, Urban Timemap, AARO World, Building Layout Analyzer)
- World Agent: connects all micro apps
- RhinoMCP: connects AI and Rhino 3D
- Education: AI Driven Design courses, workshops
- Contact: architecture.algorithm@gmail.com | 010-3061-3836 | 대표: 서종관

FOUNDER LINKS:
- LinkedIn: https://www.linkedin.com/in/tzung-kuan-hsu/
- Instagram: https://www.instagram.com/tzung_kuan_hsu/

RULES:
1. Keep answers SHORT — max 2-3 sentences unless asked for detail
2. NEVER reveal code, tech stack, algorithms, or implementation
3. NEVER mention neoGEN, neoBIM, UrbanGraphRAG, PlanNext.ai, Landbook
4. Answer in the user's language (Korean or English)
5. If unsure, direct to the contact form on the website
6. Be warm but brief`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { message, session_id, message_index, history } = req.body || {};
  if (!message || !session_id) {
    return res.status(400).json({ error: 'message and session_id are required' });
  }
  if (message.length > 1000) {
    return res.status(400).json({ error: 'Message too long (max 1000 chars)' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!openaiKey) {
    return res.status(500).json({ error: 'API not configured' });
  }

  // Rate limiting via Supabase
  if (supabaseUrl && supabaseKey) {
    try {
      const ip = (req.headers['x-forwarded-for'] || '127.0.0.1').split(',')[0].trim();
      var ipHash = createHash('sha256').update(ip + (process.env.RATE_LIMIT_SALT || 'aaro')).digest('hex');

      const countRes = await fetch(
        `${supabaseUrl}/rest/v1/chat_logs?select=id&ip_hash=eq.${ipHash}&created_at=gte.${new Date(Date.now() - 60000).toISOString()}`,
        { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
      );
      const recent = await countRes.json();
      if (Array.isArray(recent) && recent.length >= 10) {
        return res.status(429).json({ error: '잠시 후 다시 시도해주세요. (1분에 최대 10개 메시지)' });
      }
    } catch (e) {
      // Rate limit check failed, continue anyway
    }
  }

  // Build messages for OpenAI
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
  if (Array.isArray(history)) {
    const trimmed = history.slice(-20); // last 10 turns
    for (const h of trimmed) {
      if (h.role === 'user' || h.role === 'assistant') {
        messages.push({ role: h.role, content: h.content });
      }
    }
  }
  messages.push({ role: 'user', content: message });

  // Call OpenAI API (GPT-4.1-mini)
  let reply = '';
  try {
    const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        max_tokens: 512,
        messages
      })
    });

    if (!gptRes.ok) {
      const errBody = await gptRes.text();
      console.error('OpenAI API error:', gptRes.status, errBody);
      return res.status(502).json({ error: 'AI 응답 오류가 발생했습니다.' });
    }

    const gptData = await gptRes.json();
    reply = gptData.choices?.[0]?.message?.content || '죄송합니다, 응답을 생성하지 못했습니다.';
  } catch (e) {
    console.error('OpenAI API call failed:', e);
    return res.status(502).json({ error: 'AI 서비스에 연결할 수 없습니다.' });
  }

  // Log to Supabase (non-blocking)
  if (supabaseUrl && supabaseKey) {
    fetch(`${supabaseUrl}/rest/v1/chat_logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        session_id,
        user_message: message,
        agent_response: reply,
        message_index: message_index || 0,
        ip_hash: typeof ipHash !== 'undefined' ? ipHash : null,
        user_agent: req.headers['user-agent'] || null,
        locale: req.headers['accept-language']?.split(',')[0] || null
      })
    }).catch(e => console.error('Supabase log failed:', e));
  }

  return res.status(200).json({ reply, session_id });
}
