// Incoming message routing


// All bot channels need webhook endpoints:
// - WhatsApp: POST /webhooks/whatsapp/:businessId
// - Telegram: POST /webhooks/telegram/:businessId

// // Webhook routing:
// 1. Receive message from platform
// 2. Extract business ID from endpoint
// 3. Verify business is active and can chat
// 4. Send to chat service for AI response
// 5. Format response for platform
// 6. Send back through platform API