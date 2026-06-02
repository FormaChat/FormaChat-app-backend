Auth — What's Missing & What Could Be Better
Social Sign-In (Google, GitHub, Apple)
The architecture is clean enough to slot this in alongside the existing email/password flow. On login, you'd just skip the password check and OTP entirely. The hard part is already done — sessions, JWT, refresh tokens all work. This is a fairly straightforward addition and removes the #1 friction point at registration.

2FA is half-built
The OTP system supports type: '2fa' and the enum is defined everywhere, but nothing actually triggers it. You could add a user preference flag and enforce 2FA on login for security-conscious users. The RabbitMQ event + email template for it already exists.

Password Reset is stubbed
The endpoint exists but the implementation is incomplete. The OTP + Redis flow is already perfectly set up for it — it's probably a few hours of work to wire it through. Right now users who forget their password are stuck.

Magic Link Login
Instead of password + OTP, offer a "send me a login link" option. You already have Resend, you already have JWT. Generate a short-lived signed token, email it, verify on click. No new infrastructure needed.

Breach Detection
There's an actual // TODO: HIBP check comment in your auth service. HaveIBeenPwned has a free k-anonymity API — you send the first 5 chars of the SHA-1 hash of their password and get back whether it's in any known breach list. One API call at registration/password change. Adds real security credibility.

Email Templates — Redesign Opportunities
The current templates are functional but basic. They're olive-colored, text-heavy, and use basic HTML tables. Here's what would make them stand out:

Welcome Email — most important one, needs the most work
Currently it just says "account created, log in." It should be a mini onboarding sequence:

A short 3-step visual showing what the user can do (Create a business → Upload knowledge → Deploy the widget)
A prominent CTA: "Create Your First AI Agent"
A "Did you know?" tip section
Social proof — "Join X businesses already using FormaChat"
Think of it as a product tour, not a confirmation receipt.

OTP Email — works but feels cold
The OTP display is good (monospace, prominent). But the surrounding copy is generic. Personalise it with {{firstName}}, add a subtle brand personality line, and make the "valid for 10 minutes" timer more visually prominent — maybe a progress bar style strip.

Password Changed — actually the best designed one
The red security notice box is great. The only thing I'd add: a one-click "This wasn't me — lock my account" link that hits a signed endpoint and immediately revokes all sessions. Right now it just says "contact support" which introduces friction in an emergency.

Account Deactivated — missing a win-back opportunity
The reactivation button is there but buried. Make the entire email a soft win-back — "We're sorry to see you go. Here's what you're leaving behind" with a simple stat like "Your chatbot answered X questions." Personalization here has huge retention value.

Missing templates you should add:

trial-expiring.hbs — "Your trial ends in 3 days" with an upgrade CTA
lead-captured.hbs — notify business owners when a new lead comes in (this is a key platform value moment)
weekly-summary.hbs — business owner gets "your chatbot had 47 conversations this week, captured 3 leads" every Monday morning
Chat & RAG — The Core Product
The LLM situation
Right now you're 100% locked to Groq (llama-3.3-70b-versatile). Claude, OpenAI, and Gemini are stubbed but empty. The risk: if Groq has an outage or rate-limits you, the entire platform goes down. You should at minimum implement one fallback (Claude Haiku is cheap and fast). Each business could even choose their preferred model as a setting.

Streaming is commented out
There's a /message/stream endpoint in the routes but it's commented out in the router. Streaming responses (typing indicator effect) transforms the chat experience from "waiting for a blob of text" to feeling like a real conversation. This is worth prioritising — it's likely the biggest UX improvement available.

Contact extraction is fragile
You're using regex to extract emails, phone numbers, and names from chat messages. This works for "my email is user@example.com" but completely breaks for anything conversational like "reach me at jay at gmail dot com" or Indian phone formats. Replace this with an LLM call — just pass the last 3 messages and ask the model to extract structured contact info. Groq is fast enough that it won't noticeably delay the response.

The system prompt tones
The 5 tones (Friendly, Professional, Casual, Formal, Playful) are good, but the business owner can't customise beyond picking one. Add a free-text "additional instructions" field — "Always respond in Spanish", "Never discuss pricing, always redirect to a call", "End every message with our tagline". This is a 10-minute model change that unlocks massive flexibility.

Conversation memory cuts off at 10 messages
After 10 exchanges, the chatbot forgets the beginning of the conversation. For short support chats this is fine, but for longer sales conversations it's a problem. The fix: summarise the early conversation into a single "conversation context" string using the LLM, and inject that into the system prompt instead of the raw messages. This is called a rolling summary pattern.

Confidence scoring
When Pinecone returns low relevance scores, the bot should say "I don't have specific information about that, but here's the closest I can find" rather than hallucinating an answer. You already have the relevanceScore per result — just add a threshold check.

Business Profile — Underutilised
Knowledge base versioning
Right now there's no history of what was uploaded or when. If a business owner uploads a new price list and the bot starts giving wrong answers, there's no rollback. Add a simple version history — store each vector sync with a timestamp and vector count, allow restoring a previous version.

Business health score
Calculate a simple score based on: number of FAQs added, document uploads, greeting configured, tone set, operating hours set. Show this as a profile completion meter. Businesses that fill out more data get better chatbot performance — this nudges them toward doing it.

File uploads currently have no preview
Documents and images are stored as URLs but never re-shown to the user. The dashboard should let business owners see what's in their knowledge base, delete individual chunks, and see which documents generated which vector entries.

New Features Worth Building
Lead notification emails
When a visitor submits their contact info through the chat, the business owner gets no notification right now. An instant email — "New lead from your chatbot: [name], [email], said they're interested in pricing" — is one of the highest-value features for retention. Business owners love seeing the product working.

Webhook system
Let business owners drop a webhook URL in their settings, and fire it when a new lead is captured. This connects FormaChat to their CRM (HubSpot, Notion, Airtable, etc.) without you having to build native integrations. One outbound POST request unlocks hundreds of integration possibilities.

Scheduled weekly digest
Every Monday morning, business owners get an email summary: conversations this week, new leads, most asked question, top performing document. This keeps them engaged with the product even when they're not logging in, and demonstrates value passively.

Analytics events over RabbitMQ
Right now the chat service fires no events. Every session.started, lead.captured, message.sent, session.ended event should be published — even if nothing consumes them yet. You can build an analytics consumer later without touching the chat service.

Business-to-business isolation audit
The canChat() method checks if a business is active and vectors are ready before serving a session. But there's no check that one business can't query another business's Pinecone namespace if they know the ID format (business_{id}). Worth confirming that the namespace access is properly scoped.

The One I'd Build First
Lead notification email. It requires almost nothing new — you have the ContactLead model, you have Resend, you have the business owner's email. One new RabbitMQ event (lead.captured from chat service), one new consumer in email service, one new lead-captured.hbs template. It closes the most important feedback loop in the whole product: "your AI is working, it captured a real lead." That's what makes business owners stick.

What do you want to tackle first?