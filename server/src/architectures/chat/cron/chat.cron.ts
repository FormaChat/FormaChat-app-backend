import cron from 'node-cron';
import { chatService } from '../service/chat.service';
import { createLogger } from '../util/chat.logger.utils';

const logger = createLogger('cron-scheduler');

export function setupCronJobs() {
  
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

  cron.schedule('0 3 * * *', async () => {
    try {
      logger.info('[Cron] Starting permanent session deletion...');
      
      const result = await chatService.permanentlyDeleteSessions();
      
      logger.info('[Cron] ✓ Permanent deletion complete', {
        deleted: result.deletedCount,
        skipped: result.skippedCount,
        timestamp: new Date().toISOString()
      });
      
    } catch (error: any) {
      logger.error('[Cron] Permanent deletion failed', {
        message: error.message,
        stack: error.stack
      });
    }
  });

  logger.info('[Cron] ✓ Jobs scheduled successfully', {
    jobs: [
      'Session cleanup (hourly)',
      'Permanent session deletion (daily at 3am)'
    ]
  });
}

