import cron from 'node-cron';
import { chatService } from '../service/chat.service';
import { createLogger } from '../util/chat.logger.utils';

const logger = createLogger('cron-scheduler');

export function setupCronJobs() {
  
  // ========================================
  // 1. SESSION CLEANUP (Every Hour)
  // ========================================
  cron.schedule('0 * * * *', async () => {
    try {
      logger.info('[Cron] Starting session cleanup...');
      
      const result = await chatService.markAbandonedSessions();
      
      logger.info('[Cron] ✓ Session cleanup complete', {
        abandoned: result.abandonedCount,
        ended: result.endedCount,
        timestamp: new Date().toISOString()
      });
      
    } catch (error: any) {
      logger.error('[Cron] Session cleanup failed', {
        message: error.message,
        stack: error.stack
      });
    }
  });

  // ========================================
  // 2. MESSAGE DELETION (Daily at 3am)
  // ========================================
  // cron.schedule('0 3 * * *', async () => {
  //   try {
  //     logger.info('[Cron] Starting message deletion...');
      
  //     const result = await chatService.deleteOldMessages();
      
  //     logger.info('[Cron] ✓ Message deletion complete', {
  //       deleted: result.deletedCount,
  //       timestamp: new Date().toISOString()
  //     });
      
  //   } catch (error: any) {
  //     logger.error('[Cron] Message deletion failed', {
  //       message: error.message,
  //       stack: error.stack
  //     });
  //   }
  // });

  logger.info('[Cron] ✓ Jobs scheduled successfully', {
    jobs: [
      'Session cleanup (hourly)',
      // 'Message deletion (daily at 3am)'
    ]
  });
}

/**
 * ========================================
 * MANUAL TRIGGER FUNCTIONS (For Testing)
 * ========================================
 */

export async function triggerSessionCleanup() {
  logger.info('[Manual] Triggering session cleanup...');
  const result = await chatService.markAbandonedSessions();
  logger.info('[Manual] Session cleanup result:', result);
  return result;
}

// export async function triggerMessageDeletion() {
//   logger.info('[Manual] Triggering message deletion...');
//   const result = await chatService.deleteOldMessages();
//   logger.info('[Manual] Message deletion result:', result);
//   return result;
// }


// // Find sessions eligible for permanent deletion
// const sessionsToDelete = await ChatSession.find({
//   deletedAt: { $ne: null },           // User marked for deletion
//   messageCount: 0,                     // No messages
//   'contact.captured': false            // No contact captured
// });

// // For each session, check if any ContactLead references it
// for (const session of sessionsToDelete) {
//   const hasLinkedLead = await ContactLead.findOne({
//     $or: [
//       { firstSessionId: session.sessionId },
//       { lastSessionId: session.sessionId }
//     ]
//   });
  
//   if (!hasLinkedLead) {
//     // Safe to permanently delete
//     await ChatSession.deleteOne({ sessionId: session.sessionId });
//     await ChatMessage.deleteMany({ sessionId: session.sessionId });
//   }
// }