# AdHello Chatbot

AI-powered sales chatbot for AdHello.ai. Embeddable widget that:
- Chats with website visitors as an AI salesperson
- Captures lead info (name, email, company, needs)
- Saves leads to the AdHello CRM automatically
- Sends Telegram notifications for new leads

## Deploy on Render

1. Create new Web Service → connect this repo
2. Set environment variables (see `.env.example`)
3. Deploy

## Embed on your website

```html
<script>
  window.ADHELLO_CHATBOT_URL = 'https://your-chatbot.onrender.com';
</script>
<script src="https://your-chatbot.onrender.com/widget.js" async></script>
```

## Environment Variables

| Variable | Description |
|---|---|
| `PORT` | Server port (default: 3001) |
| `KIE_AI_API_KEY` | KIE.ai API key for chat |
| `CRM_API_URL` | AdHello CRM URL |
| `CRM_API_KEY` | CRM API ingest key |
| `CRM_WORKSPACE_ID` | CRM workspace ID |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token for notifications |
| `TELEGRAM_CHAT_ID` | Your Telegram chat ID |
| `BUSINESS_NAME` | Your business name |
| `BUSINESS_WEBSITE` | Your website URL |
| `CHATBOT_PUBLIC_URL` | Public URL of this chatbot (for widget) |
