// import Groq from "groq-sdk";
// import { createLogger } from '../utils/chat.logger.utils';
// import { env } from './chat.env';

// const logger = createLogger('groq-service');

// /**
//  * ========================================
//  * GROQ LLM SERVICE (FREE & FAST)
//  * ========================================
//  * 
//  * Generates chat responses using Groq's Llama 3.1
//  * 500+ tokens/second (10x faster than OpenAI!)
//  */

// class GroqService {
//   private static instance: Groq | null = null;

//   private static readonly config = {
//     apiKey: env.GROQ_API_KEY,
//     model: env.GROQ_MODEL || 'llama-3.1-70b-versatile',
//     temperature: parseFloat(env.GROQ_TEMPERATURE || '0.7'),
//     maxTokens: parseInt(env.GROQ_MAX_TOKENS || '500'),
//   };

//   /**
//    * Get Groq client (Singleton)
//    */
//   public static getClient(): Groq {
//     if (!GroqService.instance) {
//       if (!GroqService.config.apiKey) {
//         throw new Error('GROQ_API_KEY not set in environment variables');
//       }

//       GroqService.instance = new Groq({
//         apiKey: GroqService.config.apiKey,
//       });

//       logger.info('[Groq] Client initialized', {
//         model: GroqService.config.model
//       });
//     }

//     return GroqService.instance;
//   }

//   /**
//    * ========================================
//    * GENERATE CHAT RESPONSE
//    * ========================================
//    * 
//    * Uses business context from Pinecone to answer user questions
//    */
//   public static async generateResponse(
//     businessContext: string,
//     userQuestion: string,
//     businessName: string,
//     chatbotTone?: string
//   ): Promise<string> {
//     const startTime = Date.now();

//     try {
//       const client = GroqService.getClient();

//       // Build system prompt with business context
//       const systemPrompt = `You are a helpful chatbot for ${businessName}.

// Your tone should be: ${chatbotTone || 'professional and friendly'}.

// Use the following business information to answer customer questions:

// ${businessContext}

// Important guidelines:
// - Only answer based on the provided business information
// - If you don't know something, say so politely
// - Be concise but helpful
// - Use natural, conversational language
// - Don't make up information not in the context`;

//       logger.info('[Groq] Generating response', {
//         businessName,
//         questionLength: userQuestion.length,
//         contextLength: businessContext.length
//       });

//       // Call Groq API
//       const response = await client.chat.completions.create({
//         messages: [
//           { role: "system", content: systemPrompt },
//           { role: "user", content: userQuestion }
//         ],
//         model: GroqService.config.model,
//         temperature: GroqService.config.temperature,
//         max_tokens: GroqService.config.maxTokens,
//         stream: false
//       });

//       const answer = response.choices[0]?.message?.content || '';

//       const duration = Date.now() - startTime;

//       logger.info('[Groq] ✓ Response generated', {
//         duration: `${duration}ms`,
//         tokensUsed: response.usage?.total_tokens,
//         answerLength: answer.length,
//         model: response.model
//       });

//       return answer;

//     } catch (error: any) {
//       const duration = Date.now() - startTime;

//       logger.error('[Groq] Response generation failed', {
//         message: error?.message,
//         duration: `${duration}ms`
//       });

//       throw new Error(`Failed to generate response: ${error?.message}`);
//     }
//   }

//   /**
//    * ========================================
//    * GENERATE STREAMING RESPONSE
//    * ========================================
//    * 
//    * For real-time chat interfaces (optional)
//    */
//   public static async *generateStreamingResponse(
//     businessContext: string,
//     userQuestion: string,
//     businessName: string,
//     chatbotTone?: string
//   ): AsyncGenerator<string> {
//     try {
//       const client = GroqService.getClient();

//       const systemPrompt = `You are a helpful chatbot for ${businessName}.
// Your tone should be: ${chatbotTone || 'professional and friendly'}.

// Use the following business information to answer customer questions:

// ${businessContext}

// Important guidelines:
// - Only answer based on the provided business information
// - If you don't know something, say so politely
// - Be concise but helpful`;

//       const stream = await client.chat.completions.create({
//         messages: [
//           { role: "system", content: systemPrompt },
//           { role: "user", content: userQuestion }
//         ],
//         model: GroqService.config.model,
//         temperature: GroqService.config.temperature,
//         max_tokens: GroqService.config.maxTokens,
//         stream: true
//       });

//       for await (const chunk of stream) {
//         const content = chunk.choices[0]?.delta?.content || '';
//         if (content) {
//           yield content;
//         }
//       }

//     } catch (error: any) {
//       logger.error('[Groq] Streaming failed', {
//         message: error?.message
//       });
//       throw error;
//     }
//   }
// }

// // Exports
// export const generateResponse = GroqService.generateResponse.bind(GroqService);
// export const generateStreamingResponse = GroqService.generateStreamingResponse.bind(GroqService);

// export default GroqService;