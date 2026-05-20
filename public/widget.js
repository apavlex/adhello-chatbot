// AdHello Chatbot Widget v1.0
// Embed this on your website: <script src="CHATBOT_URL/widget.js"></script>
(function() {
  'use strict';

  var WIDGET_URL = window.ADHELLO_CHATBOT_URL || '';
  var BUSINESS_NAME = window.ADHELLO_BUSINESS_NAME || 'AdHello';

  if (!WIDGET_URL) {
    console.error('[AdHello Chatbot] Set window.ADHELLO_CHATBOT_URL before loading widget.js');
    return;
  }

  var sessionId = null;
  var isOpen = false;
  var isTyping = false;

  // ── Styles ──────────────────────────────────────────────────────────────────
  var css = [
    '.adhello-chat * { box-sizing: border-box; margin: 0; padding: 0; }',
    '.adhello-chat-btn { position: fixed; bottom: 24px; right: 24px; z-index: 10000; width: 60px; height: 60px; border-radius: 50%; border: none; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; font-size: 24px; cursor: pointer; box-shadow: 0 4px 20px rgba(99, 102, 241, 0.4); transition: transform 0.2s, box-shadow 0.2s; display: flex; align-items: center; justify-content: center; }',
    '.adhello-chat-btn:hover { transform: scale(1.08); box-shadow: 0 6px 28px rgba(99, 102, 241, 0.5); }',
    '.adhello-chat-btn .close-icon { display: none; font-size: 20px; }',
    '.adhello-chat-btn.open .open-icon { display: none; }',
    '.adhello-chat-btn.open .close-icon { display: inline; }',
    '.adhello-chat-window { position: fixed; bottom: 96px; right: 24px; z-index: 10000; width: 380px; height: 520px; max-height: 70vh; background: #fff; border-radius: 16px; box-shadow: 0 8px 40px rgba(0,0,0,0.15); display: none; flex-direction: column; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; animation: adhello-slide-up 0.3s ease; }',
    '.adhello-chat-window.open { display: flex; }',
    '.adhello-chat-header { background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; padding: 16px 20px; display: flex; align-items: center; gap: 10px; flex-shrink: 0; }',
    '.adhello-chat-header .avatar { width: 36px; height: 36px; border-radius: 50%; background: rgba(255,255,255,0.2); display: flex; align-items: center; justify-content: center; font-size: 18px; }',
    '.adhello-chat-header .info .name { font-weight: 600; font-size: 15px; }',
    '.adhello-chat-header .info .status { font-size: 12px; opacity: 0.8; }',
    '.adhello-chat-messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; background: #f9fafb; }',
    '.adhello-msg { max-width: 80%; padding: 10px 14px; border-radius: 14px; font-size: 14px; line-height: 1.5; word-wrap: break-word; }',
    '.adhello-msg.bot { background: white; color: #1f2937; align-self: flex-start; border-bottom-left-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }',
    '.adhello-msg.user { background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; align-self: flex-end; border-bottom-right-radius: 4px; }',
    '.adhello-msg.typing { background: white; padding: 12px 16px; align-self: flex-start; display: flex; gap: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }',
    '.adhello-msg.typing span { width: 7px; height: 7px; border-radius: 50%; background: #9ca3af; animation: adhello-typing 1.2s infinite; }',
    '.adhello-msg.typing span:nth-child(2) { animation-delay: 0.2s; }',
    '.adhello-msg.typing span:nth-child(3) { animation-delay: 0.4s; }',
    '.adhello-chat-input { padding: 12px 16px; border-top: 1px solid #e5e7eb; display: flex; gap: 8px; background: white; flex-shrink: 0; }',
    '.adhello-chat-input input { flex: 1; border: 1px solid #e5e7eb; border-radius: 20px; padding: 10px 16px; font-size: 14px; outline: none; color: #1f2937; }',
    '.adhello-chat-input input:focus { border-color: #6366f1; }',
    '.adhello-chat-input button { width: 40px; height: 40px; border-radius: 50%; border: none; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center; transition: opacity 0.2s; flex-shrink: 0; }',
    '.adhello-chat-input button:hover { opacity: 0.85; }',
    '.adhello-chat-input button:disabled { opacity: 0.5; cursor: not-allowed; }',
    '@keyframes adhello-slide-up { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }',
    '@keyframes adhello-typing { 0%, 60%, 100% { transform: translateY(0); } 30% { transform: translateY(-6px); } }',
  ].join('\n');

  var styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ── DOM ──────────────────────────────────────────────────────────────────────
  var btn = document.createElement('button');
  btn.className = 'adhello-chat-btn';
  btn.innerHTML = '<span class="open-icon">💬</span><span class="close-icon">✕</span>';
  btn.setAttribute('aria-label', 'Open chat');
  document.body.appendChild(btn);

  var win = document.createElement('div');
  win.className = 'adhello-chat-window';
  win.innerHTML =
    '<div class="adhello-chat-header">' +
      '<div class="avatar">🤖</div>' +
      '<div class="info">' +
        '<div class="name">' + BUSINESS_NAME + ' Assistant</div>' +
        '<div class="status">Online • Typically replies instantly</div>' +
      '</div>' +
    '</div>' +
    '<div class="adhello-chat-messages" id="adhello-msgs"></div>' +
    '<div class="adhello-chat-input">' +
      '<input type="text" id="adhello-input" placeholder="Type a message..." autocomplete="off" />' +
      '<button id="adhello-send" aria-label="Send">➤</button>' +
    '</div>';
  document.body.appendChild(win);

  var msgsEl = document.getElementById('adhello-msgs');
  var inputEl = document.getElementById('adhello-input');
  var sendEl = document.getElementById('adhello-send');

  // ── Functions ────────────────────────────────────────────────────────────────
  function addMessage(role, text) {
    var msg = document.createElement('div');
    msg.className = 'adhello-msg ' + role;
    msg.textContent = text;
    msgsEl.appendChild(msg);
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  function showTyping() {
    if (isTyping) return;
    isTyping = true;
    var t = document.createElement('div');
    t.className = 'adhello-msg typing';
    t.id = 'adhello-typing';
    t.innerHTML = '<span></span><span></span><span></span>';
    msgsEl.appendChild(t);
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  function hideTyping() {
    isTyping = false;
    var t = document.getElementById('adhello-typing');
    if (t) t.remove();
  }

  function apiPost(path, body, cb) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', WIDGET_URL + path, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onreadystatechange = function() {
      if (xhr.readyState === 4) {
        var data;
        try { data = JSON.parse(xhr.responseText); } catch(e) { data = {}; }
        cb(xhr.status, data);
      }
    };
    xhr.send(JSON.stringify(body));
  }

  function initSession() {
    apiPost('/api/session', {}, function(status, data) {
      if (data.sessionId) {
        sessionId = data.sessionId;
        addMessage('bot', data.message);
      } else {
        addMessage('bot', 'Hi! Welcome to ' + BUSINESS_NAME + '. How can I help you today?');
      }
    });
  }

  function sendMessage() {
    var text = inputEl.value.trim();
    if (!text || !sessionId) return;
    inputEl.value = '';
    sendEl.disabled = true;
    addMessage('user', text);
    showTyping();

    apiPost('/api/chat', { sessionId: sessionId, message: text }, function(status, data) {
      hideTyping();
      if (data.message) {
        addMessage('bot', data.message);
      } else {
        addMessage('bot', 'Sorry, I\'m having trouble responding. Please try again!');
      }
      sendEl.disabled = false;
    });
  }

  // ── Events ──────────────────────────────────────────────────────────────────
  btn.addEventListener('click', function() {
    isOpen = !isOpen;
    btn.classList.toggle('open', isOpen);
    win.classList.toggle('open', isOpen);
    if (isOpen && !sessionId) initSession();
    if (isOpen) setTimeout(function() { inputEl.focus(); }, 300);
  });

  sendEl.addEventListener('click', sendMessage);
  inputEl.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') sendMessage();
  });

  console.log('[AdHello Chatbot] Widget loaded. Click the chat button to start.');
})();
