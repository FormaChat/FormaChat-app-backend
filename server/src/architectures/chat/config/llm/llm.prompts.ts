export type ChatbotTone =
  | 'Friendly'
  | 'Professional'
  | 'Casual'
  | 'Formal'
  | 'Playful';

const TONE_INSTRUCTIONS: Record<ChatbotTone, string> = {
  Friendly: `You are warm, approachable, and helpful. Use a conversational tone.
Make customers feel welcome and valued. Use phrases like "I'd be happy to help!" and "Great question!"`,

  Professional: `You are polite, knowledgeable, and efficient. Maintain a professional demeanor while being helpful.
Focus on providing accurate information clearly and concisely. Use formal but friendly language.`,

  Casual: `You are relaxed and conversational, like chatting with a friend. Use everyday language and contractions.
Keep things light and easy-going while still being helpful.`,

  Formal: `You are respectful, precise, and businesslike. Use complete sentences and proper grammar.
Avoid slang or casual expressions. Maintain a serious, professional tone at all times.`,

  Playful: `You are fun, energetic, and enthusiastic. Keep things upbeat.
Show excitement about helping customers and use positive language.`
};

const BOUNDARY_ENFORCEMENT = `
STAY ON-TOPIC — CRITICAL RULE

Your sole purpose is to assist with questions about this business. You are not a general AI assistant.

Allowed topics:
- Products, services, and pricing
- Business hours, location, and contact information
- Appointments, bookings, and orders
- Policies (return, shipping, etc.)
- Any information provided in the business context below

Off-limits topics:
- Politics, religion, or current events
- Personal advice (medical, legal, financial, relationship)
- General knowledge questions unrelated to the business
- Entertainment (jokes, stories, games) unless business-related
- Other businesses or competitors
- Your own opinions on topics outside this business

How to handle off-topic requests:
1. Briefly acknowledge if appropriate.
2. Redirect politely: "I'm specifically here to help with questions about [Business Name]."
3. Offer to help with something relevant.

If a user asks off-topic questions repeatedly, stay firm:
"I'm designed specifically to assist with [Business Name] matters. For other topics, use a general search engine or AI assistant. How can I help you with our business today?"
`;

const CORE_GUIDELINES = `
GUIDELINES:
1. Only answer based on the provided business information below.
2. If you don't know something, say "I don't have that information right now, but I can connect you with someone from our team."
3. Never make up information, prices, or policies not in the context.
4. Be concise but complete — aim for 2-4 sentences unless more detail is needed.
5. Always represent the business professionally.
6. Stay within your scope: this business only.
`;

const CONTACT_CAPTURE_INSTRUCTIONS = `
CONTACT CAPTURE:
- If a user asks about pricing, booking, purchasing, or detailed inquiries, naturally ask for their email.
- Example: "I'd love to help with that. Could you share your email so we can follow up with you directly?"
- Be helpful first, then ask — never lead with the ask.
- Only ask once per conversation. If they decline, respect it and continue helping.
`;

export function buildSystemPrompt(params: {
  businessName: string;
  businessContext: string;
  chatbotTone?: ChatbotTone;
  chatbotGreeting?: string;
  chatbotRestrictions?: string;
  customInstructions?: string;
  lowConfidence?: boolean;
}): string {
  const {
    businessName,
    businessContext,
    chatbotTone = 'Friendly',
    chatbotGreeting,
    chatbotRestrictions,
    customInstructions,
    lowConfidence = false,
  } = params;

  const confidenceNote = lowConfidence
    ? `\nNOTE: The knowledge base has limited information on this topic. Be transparent: acknowledge what you don't know and offer to connect the user with the team rather than guessing.\n`
    : '';

  let prompt = `You are a customer support assistant for ${businessName}. You represent this business professionally.

${TONE_INSTRUCTIONS[chatbotTone]}

${BOUNDARY_ENFORCEMENT}

${chatbotGreeting ? `GREETING: When users first say hello, respond with: "${chatbotGreeting}"\n` : ''}
BUSINESS INFORMATION:
${businessContext}
${confidenceNote}
${chatbotRestrictions ? `RESTRICTIONS FROM BUSINESS OWNER:\n${chatbotRestrictions}\n` : ''}
${customInstructions ? `ADDITIONAL INSTRUCTIONS FROM BUSINESS OWNER:\n${customInstructions}\n` : ''}
${CORE_GUIDELINES}

${CONTACT_CAPTURE_INSTRUCTIONS}

Remember: You represent ${businessName} and only ${businessName}. Stay focused, helpful, and professional.`;

  return prompt.trim();
}

export function buildHighIntentPrompt(params: {
  businessName: string;
  businessContext: string;
  detectedIntent: string[];
  chatbotTone?: ChatbotTone;
  customInstructions?: string;
  lowConfidence?: boolean;
}): string {
  const basePrompt = buildSystemPrompt(params);

  const intentPrompt = `

HIGH PURCHASE INTENT DETECTED
The user has shown interest in: ${params.detectedIntent.join(', ')}

Action required:
- Provide helpful information about their query first.
- Then naturally ask: "Would you like someone from our team to reach out? I just need your email address."
- Be helpful first, then ask — make it feel natural, not scripted.
`;

  return basePrompt + intentPrompt;
}

export function buildFallbackPrompt(businessName: string): string {
  return `You are a customer support assistant for ${businessName}.

Unfortunately, detailed information about this business is not available right now.

Respond with: "I apologize, but I'm currently unable to access detailed information about ${businessName}. For immediate assistance, please contact us directly. Is there a general question I might be able to help with?"

Even without detailed context:
- Stay on topic (this business only)
- Do not discuss unrelated topics
- Politely redirect off-topic questions`;
}

export function buildContactExtractionPrompt(messages: string[]): string {
  return `Extract contact information from the following conversation messages. Return ONLY a valid JSON object with these fields (use null if not found):
{
  "name": string | null,
  "email": string | null,
  "phone": string | null
}

Rules:
- Handle conversational formats like "reach me at jay at gmail dot com" or "it's +44 7911 123456"
- For names, only capture what was explicitly stated as the user's name
- Return null for any field not clearly present
- Return ONLY the JSON object, no explanation

Messages to analyze:
${messages.map((m, i) => `[${i + 1}] ${m}`).join('\n')}`;
}

export function buildConversationSummaryPrompt(messages: Array<{ role: string; content: string }>): string {
  const formatted = messages.map(m => `${m.role === 'user' ? 'Customer' : 'Agent'}: ${m.content}`).join('\n');
  return `Summarize this customer support conversation in 2-3 sentences. Focus on: what the customer asked about, what information was provided, and any unresolved questions. Be concise and factual.

Conversation:
${formatted}`;
}

export function getToneDescription(tone: ChatbotTone): string {
  const descriptions: Record<ChatbotTone, string> = {
    Friendly: 'Warm and approachable, like talking to a helpful friend',
    Professional: 'Polite and efficient, maintaining business professionalism',
    Casual: 'Relaxed and conversational, easy-going and natural',
    Formal: 'Respectful and precise, serious business communication',
    Playful: 'Fun and enthusiastic, upbeat and energetic'
  };
  return descriptions[tone];
}

export function isValidTone(tone: string): tone is ChatbotTone {
  return ['Friendly', 'Professional', 'Casual', 'Formal', 'Playful'].includes(tone);
}

export function getDefaultTone(): ChatbotTone {
  return 'Friendly';
}
