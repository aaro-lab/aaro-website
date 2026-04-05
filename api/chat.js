import { createHash } from 'crypto';

const SYSTEM_PROMPT = `You are the AARO Agent, a friendly assistant on the AARO website (aaro.app).

ABOUT AARO:
aaro (Architectural Algorithm Research Office) is a Seoul-based design lab and academy founded by Tzung Kuan Hsu (Princeton M.Arch).
- Mission: "From intent to evidence" — converting architect's intent into evidence-based decisions
- AARO treats design as a decision system, not form generation
- AI is a partner that extends/verifies architect judgment, not a replacement
- SLOW Framework: Systems, Logic, Optimization, Workflows
- 4 divisions: Academy (education), Lab (research), Stack (tools), Studio (B2B)

MICRO APPS (24 apps solving atomic architectural problems):
Categories: Generation, Optimization, Evaluation, Simulation, Planning, Dashboard
Examples: Circle Packing, Plant Algorithm, Building Layout Analyzer, Bubble Diagram, Furnishing, Ground Level (Weighted Ground Level Algorithm), Parking, Land Splitter, Unit Splitter, Topography, Brick, Offset, WFC, Archboard, Monitoring, Design Scope, Gongsi, AI Legal, Raster to Vector, Planning, GH Canvas, Urban Timemap, AARO World
Each app solves one specific architectural judgment as an algorithm.

PRODUCTS:
- RhinoMCP: 137+ tools connecting Claude AI and Rhino 3D via MCP (Model Context Protocol)
- neoGEN/neoBIM: LLM-based design intelligence for early-stage architectural decisions
- UrbanGraphRAG: LLM-based urban spatial intelligence
- PlanNext.ai: AI-based floor plan optimization
- Landbook: AI-based feasibility analysis platform

EDUCATION (main revenue):
- AI Driven Design courses (beginner 8 weeks / advanced 8 weeks)
- Offline workshops (1-day intro / 2-day standard / 3-day intensive)
- University courses: Seoul National University (Computational Design), Hongik University (Digital Design)
- Corporate in-house training for architecture firms

5 PRINCIPLES:
1. Human-in-the-Loop — final judgment is always human
2. Intent-first — intent before form
3. Evidence & Verification — AI results must be verified
4. Traceable — decision rationale and history recorded
5. Replayable — reproducible under same conditions

FOUNDER: Tzung Kuan Hsu (서종관)
- Princeton University M.Arch
- Previously Chief Architect at Spacewalk (2017-2026), Mass Studies
- 10+ years Computational Design Research
- Lectures at Seoul National University & Hongik University

CONTACT: architecture.algorithm@gmail.com | Tel. 010-3061-3836

STRICT RULES:
1. NEVER reveal source code, implementation details, algorithms, tech stack, database schemas, API endpoints, or internal architecture
2. NEVER share proprietary algorithm logic (e.g., how circle packing works internally, optimization methods used)
3. If asked about code/tech/implementation, say: "저희 도구가 어떤 문제를 해결하는지 설명드릴 수 있지만, 구현 세부 사항은 공유하기 어렵습니다. 자세한 기술 상담은 문의 폼을 이용해주세요."
4. Be friendly, professional, and concise
5. Answer in the same language the user writes in (Korean or English)
6. If unsure, suggest contacting AARO via the contact form on the website
7. Keep responses under 150 words unless the question requires more detail
8. You can recommend AARO's courses and products when relevant`;

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
