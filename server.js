require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Config ────────────────────────────────────────────────────────────────────

const CONFIG = {
  businessName: process.env.BUSINESS_NAME || 'AdHello',
  businessWebsite: process.env.BUSINESS_WEBSITE || 'https://adhello.ai',
  businessPhone: process.env.BUSINESS_PHONE || '(360) 773-1505',
  crmApiUrl: process.env.CRM_API_URL || 'https://adhelloleadsos.onrender.com',
  crmApiKey: process.env.CRM_API_KEY || '',
  crmWorkspaceId: process.env.CRM_WORKSPACE_ID || 'default',
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
  kieApiKey: process.env.KIE_AI_API_KEY || process.env.KIE_API_KEY || '',
  kieModel: process.env.KIE_AI_MODEL || 'gpt-5-2',
  kieBaseUrl: (process.env.KIE_AI_BASE_URL || 'https://api.kie.ai').replace(/\/$/, ''),
  kiePath: (process.env.KIE_AI_CHAT_PATH || 'gpt-5-2/v1/chat/completions').replace(/^\//, ''),
};

// ── Middleware ──────────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Simple in-memory session store (use Redis in production)
const sessions = new Map();

// Clean up old sessions every 30 minutes
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000; // 1 hour
  for (const [id, s] of sessions) {
    if (new Date(s.createdAt).getTime() < cutoff) sessions.delete(id);
  }
}, 30 * 60 * 1000);

// ── LLM Client ────────────────────────────────────────────────────────────────

async function chatCompletion(messages, { jsonObject = false, max_tokens = 800, temperature = 0.5 } = {}) {
  if (!CONFIG.kieApiKey) {
    return { content: null, error: true, provider: 'none' };
  }

  const body = {
    messages,
    model: CONFIG.kieModel,
    temperature,
    max_tokens,
    stream: false,
  };
  if (jsonObject) body.response_format = { type: 'json_object' };

  const url = `${CONFIG.kieBaseUrl}/${CONFIG.kiePath}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CONFIG.kieApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  let data;
  try { data = JSON.parse(raw); } catch { return { content: null, error: true }; }

  if (!res.ok) {
    console.error('[LLM] Error:', res.status, raw.slice(0, 200));
    return { content: null, error: true };
  }

  const ch = data?.choices?.[0];
  let content = ch?.message?.content || ch?.text || null;
  if (!content && Array.isArray(ch?.message?.content)) {
    content = ch.message.content.map(p => p.text || '').join('');
  }
  return { content: content || null, error: !content };
}

// ── Telegram notification ─────────────────────────────────────────────────────

async function notifyTelegram(text) {
  if (!CONFIG.telegramBotToken || !CONFIG.telegramChatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${CONFIG.telegramBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CONFIG.telegramChatId,
        text,
        parse_mode: 'HTML',
        disable_web_preview: false,
      }),
    });
  } catch (e) {
    console.error('[Telegram] Notify failed:', e.message);
  }
}

// ── CRM: save lead ────────────────────────────────────────────────────────────

async function saveLeadToCRM(leadData) {
  if (!CONFIG.crmApiKey) return { success: false, error: 'CRM not configured' };
  try {
    const res = await fetch(`${CONFIG.crmApiUrl}/autonomous/leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CONFIG.crmApiKey,
        'x-workspace-id': CONFIG.crmWorkspaceId,
      },
      body: JSON.stringify({ ...leadData, source: 'chatbot' }),
    });
    return await res.json();
  } catch (e) {
    console.error('[CRM] Save failed:', e.message);
    return { success: false, error: e.message };
  }
}

// ── CRM: create follow-up task ────────────────────────────────────────────────

async function createFollowUpTask(leadData, session) {
  if (!CONFIG.crmApiKey) return { success: false, error: 'CRM not configured' };
  try {
    const taskNote = `🤖 Chatbot follow-up\n\nLead: ${session.leadName || 'Unknown'}\nEmail: ${session.leadEmail || 'N/A'}\nCompany: ${session.company || 'N/A'}\nNeed: ${session.need || 'N/A'}\nPhone: ${session.leadPhone || 'N/A'}\n\nChat summary:\n${session.messages.filter(m => m.role === 'user').slice(0, 5).map(m => `• ${m.content}`).join('\n')}`;

    const res = await fetch(`${CONFIG.crmApiUrl}/api/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CONFIG.crmApiKey,
        'x-workspace-id': CONFIG.crmWorkspaceId,
      },
      body: JSON.stringify({
        title: `Follow up: ${session.leadName || 'Chatbot lead'} (${session.leadEmail || 'no email'})`,
        note: taskNote,
        column: 'todo',
        priority: session.leadEmail ? 'high' : 'medium',
        leadKey: leadData?.key || null,
      }),
    });
    return await res.json();
  } catch (e) {
    console.error('[CRM] Task create failed:', e.message);
    return { success: false, error: e.message };
  }
}

// ── Agent System Prompt ───────────────────────────────────────────────────────

function getSystemPrompt(session) {
  const msgCount = session.messages.filter(m => m.role === 'user').length;
  const hasContact = session.leadName && session.leadEmail;
  const hasFullInfo = hasContact && session.need;

  return `You are the AdHello AI Sales Agent — a friendly, consultative sales representative for ${CONFIG.businessName} (${CONFIG.businessWebsite}). You help home service businesses get more calls and leads from Google.

## YOUR ROLE
You are NOT a generic chatbot. You are a skilled sales agent whose job is to:
1. Understand the visitor's business and challenges
2. Qualify them as a potential client
3. Book a free Google Visibility Audit call
4. Capture their information for follow-up

## ABOUT ADHELLO
AdHello helps home service businesses (plumbing, HVAC, landscaping, cleaning, roofing, electrical, etc.) get more calls from Google. Services:
- Google Business Profile optimization ($300-500/mo)
- Review generation & reputation management
- Google Ads management
- Lead follow-up automation
- AI-powered websites that convert visitors into callers

## CONVERSATION STAGE: ${msgCount === 0 ? 'OPENING' : hasFullInfo ? 'CLOSING' : hasContact ? 'QUALIFYING' : 'RAPPORT'}

### YOUR CONVERSATION FLOW:

**Stage 1 — RAPPORT (messages 1-2):**
- Greet warmly, ask their name
- Ask what type of home service business they run
- Keep it casual and friendly

**Stage 2 — DISCOVERY (messages 3-4):**
- Ask about their biggest challenge getting customers
- Common pain points: "not enough calls from Google", "competitors show up higher", "reviews are bad", "website doesn't bring leads"
- Show empathy, share a quick example of how we helped someone similar

**Stage 3 — VALUE (messages 5-6):**
- Briefly explain how AdHello solves their specific problem
- Mention the free Google Visibility Audit — "We'll show you exactly what's wrong and how to fix it"
- Social proof: "We help home service businesses get 2-3x more calls from Google"

**Stage 4 — CLOSING (messages 7+):**
- If you have their name + email: "Perfect! I'll have our team send you the audit. What's the best email?"
- If they're interested but hesitant: Offer to book a 15-min call
- If they give email: "Great! You'll receive your free audit within 24 hours. Is there a good number to reach you at?"

## RULES:
- Keep responses SHORT (2-3 sentences max, 1 for follow-ups)
- Ask ONE question at a time
- Be conversational, not robotic — use contractions, casual tone
- If they ask about pricing: "Our plans start at $97/mo, but let's do the free audit first so we can recommend the right fit"
- If they say they're not interested: "No worries! If you ever want to see how you rank on Google, just visit ${CONFIG.businessWebsite}/audit — it's free, no strings attached"
- If they ask to speak to a human: "Absolutely! You can call us at ${CONFIG.businessPhone} or I can have someone reach out. What's your email?"
- NEVER be pushy. Be helpful first.
- When you have name + email + need, wrap up warmly and say the team will be in touch

## CURRENT SESSION:
- Visitor name: ${session.leadName || 'Not provided yet'}
- Visitor email: ${session.leadEmail || 'Not provided yet'}
- Phone: ${session.leadPhone || 'Not provided yet'}
- Business type: ${session.businessType || 'Not provided yet'}
- Main challenge: ${session.need || 'Not provided yet'}
- Company: ${session.company || 'Not provided yet'}
- Messages so far: ${msgCount}
- Lead captured: ${session.leadCaptured ? 'YES' : 'NO'}

${hasFullInfo ? '⚠️ This lead has provided name + email + need. Your goal now is to wrap up warmly and let them know the team will reach out. Do NOT ask more qualifying questions.' : ''}`;
}

// ── Extract lead info from conversation ───────────────────────────────────────

async function extractLeadInfo(session) {
  try {
    const extractResult = await chatCompletion([
      {
        role: 'system',
        content: `Extract structured lead data from this conversation. Return JSON with keys: name, email, phone, company, businessType (e.g. "plumber", "HVAC", "landscaping"), need (their main challenge, e.g. "not enough calls from Google"). Only include fields that are clearly stated by the visitor.`,
      },
      ...session.messages,
    ], { jsonObject: true, max_tokens: 300 });

    if (extractResult.content) {
      return JSON.parse(extractResult.content);
    }
  } catch (_) { /* non-fatal */ }
  return {};
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'adhello-chatbot', llm: !!CONFIG.kieApiKey });
});

app.post('/api/session', (req, res) => {
  const sessionId = uuidv4();
  const session = {
    id: sessionId,
    messages: [],
    leadName: '',
    leadEmail: '',
    leadPhone: '',
    company: '',
    businessType: '',
    need: '',
    createdAt: new Date().toISOString(),
    leadCaptured: false,
    followUpCreated: false,
  };
  sessions.set(sessionId, session);
  res.json({
    sessionId,
    message: `Hey there! 👋 Welcome to ${CONFIG.businessName}. I'm your AI assistant — here to help home service businesses get more calls from Google. What's your name?`,
  });
});

app.post('/api/chat', async (req, res) => {
  try {
    const { sessionId, message } = req.body;
    if (!sessionId || !message) {
      return res.status(400).json({ error: 'sessionId and message are required.' });
    }

    let session = sessions.get(sessionId);
    if (!session) {
      session = {
        id: sessionId,
        messages: [],
        leadName: '',
        leadEmail: '',
        leadPhone: '',
        company: '',
        businessType: '',
        need: '',
        createdAt: new Date().toISOString(),
        leadCaptured: false,
        followUpCreated: false,
      };
      sessions.set(sessionId, session);
    }

    session.messages.push({ role: 'user', content: message });

    const llmMessages = [
      { role: 'system', content: getSystemPrompt(session) },
      ...session.messages.slice(-20),
    ];

    const result = await chatCompletion(llmMessages);

    if (result.error || !result.content) {
      const fallback = "I'm having a quick connection issue. Can you try again in a moment? Or call us at " + CONFIG.businessPhone + " — we'd love to help!";
      session.messages.push({ role: 'assistant', content: fallback });
      return res.json({ message: fallback, sessionId: session.id });
    }

    session.messages.push({ role: 'assistant', content: result.content });

    // Extract lead info
    try {
      const extracted = await extractLeadInfo(session);
      if (extracted.name) session.leadName = extracted.name;
      if (extracted.email) session.leadEmail = extracted.email;
      if (extracted.phone) session.leadPhone = extracted.phone;
      if (extracted.company) session.company = extracted.company;
      if (extracted.businessType) session.businessType = extracted.businessType;
      if (extracted.need) session.need = extracted.need;

      // Lead captured: has name + email and not yet saved
      if (session.leadName && session.leadEmail && !session.leadCaptured) {
        session.leadCaptured = true;

        setImmediate(async () => {
          // 1. Save to CRM
          try {
            const crmResult = await saveLeadToCRM({
              title: session.leadName,
              email: session.leadEmail,
              phone: session.leadPhone,
              company: session.company,
              note: `Source: Chatbot on ${CONFIG.businessWebsite}\nBusiness: ${session.businessType || 'N/A'}\nNeed: ${session.need || 'N/A'}\n\nChat transcript:\n${session.messages.map(m => `${m.role}: ${m.content}`).join('\n')}`,
            });
            if (crmResult?.success) {
              console.log('[CHATBOT] Lead saved to CRM:', crmResult.key);

              // 2. Create follow-up task
              try {
                await createFollowUpTask(crmResult, session);
                session.followUpCreated = true;
                console.log('[CHATBOT] Follow-up task created');
              } catch (e) { console.error('[CHATBOT] Follow-up task error:', e.message); }
            }
          } catch (e) { console.error('[CHATBOT] CRM save error:', e.message); }

          // 3. Telegram notification
          try {
            const telegramText =
              `🔔 <b>New Lead from Chatbot!</b>\n\n` +
              `👤 <b>Name:</b> ${session.leadName}\n` +
              `📧 <b>Email:</b> ${session.leadEmail}\n` +
              `📱 <b>Phone:</b> ${session.leadPhone || 'N/A'}\n` +
              `🏢 <b>Company:</b> ${session.company || 'N/A'}\n` +
              `🔧 <b>Business:</b> ${session.businessType || 'N/A'}\n` +
              `💬 <b>Need:</b> ${session.need || 'N/A'}\n\n` +
              `📝 <b>Chat:</b>\n${session.messages.filter(m => m.role === 'user').map(m => `• ${m.content}`).join('\n')}`;
            await notifyTelegram(telegramText);
            console.log('[CHATBOT] Telegram notification sent');
          } catch (e) { console.error('[CHATBOT] Telegram error:', e.message); }
        });
      }
    } catch (_) { /* non-fatal */ }

    res.json({ message: result.content, sessionId: session.id, leadCaptured: session.leadCaptured });
  } catch (err) {
    console.error('[CHAT] Error:', err);
    res.status(500).json({ error: 'Chat error. Please try again.' });
  }
});

app.get('/api/session/:sessionId', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  res.json({
    id: session.id,
    leadName: session.leadName,
    leadEmail: session.leadEmail,
    leadPhone: session.leadPhone,
    company: session.company,
    businessType: session.businessType,
    need: session.need,
    leadCaptured: session.leadCaptured,
    followUpCreated: session.followUpCreated,
    messageCount: session.messages.length,
    createdAt: session.createdAt,
  });
});

// ── Widget JS ──────────────────────────────────────────────────────────────────

app.get('/widget.js', (req, res) => {
  res.type('application/javascript');
  const fs = require('fs');
  let js = fs.readFileSync(path.join(__dirname, 'public', 'widget.js'), 'utf8');
  js = js.replace("window.ADHELLO_CHATBOT_URL || ''", `'${process.env.CHATBOT_PUBLIC_URL || ''}'`);
  res.send(js);
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
  console.log(`AdHello Chatbot Agent running on 0.0.0.0:${PORT}`);
  console.log(`LLM: ${CONFIG.kieApiKey ? 'configured' : 'NOT CONFIGURED'}`);
  console.log(`CRM: ${CONFIG.crmApiKey ? 'configured' : 'NOT CONFIGURED'}`);
  console.log(`Telegram: ${CONFIG.telegramBotToken && CONFIG.telegramChatId ? 'configured' : 'NOT CONFIGURED'}`);
});
