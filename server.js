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

// Simple in-memory session store
const sessions = new Map();

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

// ── Salesperson system prompt ─────────────────────────────────────────────────

function getSystemPrompt(session) {
  return `You are a friendly, professional sales representative for ${CONFIG.businessName} (${CONFIG.businessWebsite}). Your job is to:

1. Greet visitors warmly and ask how you can help them
2. Understand their needs — ask qualifying questions about what they're looking for
3. Explain services — ${CONFIG.businessName} helps businesses grow through digital marketing, lead generation, and sales automation
4. Capture their information — naturally collect their name, email, company, and what they need
5. Be helpful, not pushy — provide value first, sell second

KEY RULES:
- Keep responses concise (2-3 sentences max)
- Ask ONE question at a time
- If they want pricing/packages, say you'll connect them with the team
- If they share contact info, thank them and say someone will reach out
- Be conversational and human-sounding
- When you have enough info (name + email + need), wrap up warmly

Current conversation context:
- Visitor name: ${session.leadName || 'Not provided yet'}
- Visitor email: ${session.leadEmail || 'Not provided yet'}
- What they need: ${session.need || 'Not provided yet'}
- Company: ${session.company || 'Not provided yet'}

If the visitor has provided their name, email, and what they need, thank them warmly and let them know the ${CONFIG.businessName} team will be in touch shortly.`;
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
    company: '',
    need: '',
    createdAt: new Date().toISOString(),
    leadCaptured: false,
  };
  sessions.set(sessionId, session);
  res.json({
    sessionId,
    message: `Hi there! 👋 Welcome to ${CONFIG.businessName}. I'm your AI assistant. How can I help you today?`,
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
        company: '',
        need: '',
        createdAt: new Date().toISOString(),
        leadCaptured: false,
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
      const fallback = "I'm having trouble connecting right now. Can you try again in a moment?";
      session.messages.push({ role: 'assistant', content: fallback });
      return res.json({ message: fallback, sessionId: session.id });
    }

    session.messages.push({ role: 'assistant', content: result.content });

    // Extract lead info
    try {
      const extractResult = await chatCompletion([
        {
          role: 'system',
          content: 'Extract structured lead data from this conversation. Return JSON with keys: name, email, company, need. Only include fields that are clearly stated.',
        },
        ...session.messages,
      ], { jsonObject: true, max_tokens: 300 });

      if (extractResult.content) {
        const extracted = JSON.parse(extractResult.content);
        if (extracted.name) session.leadName = extracted.name;
        if (extracted.email) session.leadEmail = extracted.email;
        if (extracted.company) session.company = extracted.company;
        if (extracted.need) session.need = extracted.need;

        if (session.leadName && session.leadEmail && !session.leadCaptured) {
          session.leadCaptured = true;

          setImmediate(async () => {
            try {
              const crmResult = await saveLeadToCRM({
                title: session.leadName,
                email: session.leadEmail,
                company: session.company,
                note: `Source: Chatbot on ${CONFIG.businessWebsite}\nNeed: ${session.need || 'N/A'}\nCompany: ${session.company || 'N/A'}\n\nChat transcript:\n${session.messages.map(m => `${m.role}: ${m.content}`).join('\n')}`,
              });
              if (crmResult?.success) console.log('[CHATBOT] Lead saved to CRM:', crmResult.key);
            } catch (e) { console.error('[CHATBOT] CRM save error:', e.message); }

            try {
              const telegramText =
                `🔔 <b>New Lead from Chatbot!</b>\n\n` +
                `👤 <b>Name:</b> ${session.leadName}\n` +
                `📧 <b>Email:</b> ${session.leadEmail}\n` +
                `🏢 <b>Company:</b> ${session.company || 'N/A'}\n` +
                `💬 <b>Need:</b> ${session.need || 'N/A'}\n\n` +
                `📝 <b>Chat:</b>\n${session.messages.filter(m => m.role === 'user').map(m => `• ${m.content}`).join('\n')}`;
              await notifyTelegram(telegramText);
              console.log('[CHATBOT] Telegram notification sent');
            } catch (e) { console.error('[CHATBOT] Telegram error:', e.message); }
          });
        }
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
    company: session.company,
    need: session.need,
    leadCaptured: session.leadCaptured,
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
  console.log(`AdHello Chatbot running on 0.0.0.0:${PORT}`);
});
