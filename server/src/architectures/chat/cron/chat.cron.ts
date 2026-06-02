import cron from 'node-cron';
import { chatService } from '../service/chat.service';
import { createLogger } from '../util/chat.logger.utils';
import { ChatSession, ChatMessage, ContactLead } from '../model/chat.model';
import Business from '../../business/models/business.model';
import { emailCoreService } from '../../email/services/email.core.service';

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

  // Monday at 8am — weekly digest to all active business owners
  cron.schedule('0 8 * * 1', async () => {
    logger.info('[Cron] Starting weekly digest...');
    try {
      const now = new Date();
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - 7);
      weekStart.setHours(0, 0, 0, 0);

      const weekRange = `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

      const businesses = await Business.find({ isActive: true }).select('_id basicInfo userEmail').lean();

      let sent = 0;
      for (const biz of businesses) {
        try {
          const businessId = String(biz._id);

          const [sessions, leads] = await Promise.all([
            ChatSession.find({ businessId, startedAt: { $gte: weekStart } }).select('messageCount botMessageCount').lean(),
            ContactLead.find({ businessId, firstContactDate: { $gte: weekStart } }).select('name email phone').lean(),
          ]);

          if (sessions.length === 0) continue; // skip owners with no activity

          const totalMessages = sessions.reduce((s, sess) => s + (sess.botMessageCount ?? 0), 0);
          const avgMsgs = sessions.length > 0 ? Math.round(totalMessages / sessions.length) : 0;

          await emailCoreService.sendWeeklyDigest({
            businessOwnerEmail: biz.userEmail,
            firstName: biz.userEmail.split('@')[0],
            businessId,
            businessName: biz.basicInfo?.businessName ?? 'Your Business',
            weekRange,
            totalConversations: sessions.length,
            newLeads: leads.length,
            totalMessages,
            avgMessagesPerSession: avgMsgs,
            newLeadsDetails: leads.slice(0, 5).map(l => ({ name: l.name, email: l.email, phone: l.phone })),
          });

          sent++;
        } catch {
          // skip individual failures — continue to next business
        }
      }

      logger.info('[Cron] Weekly digest complete', { sent, total: businesses.length });
    } catch (error: any) {
      logger.error('[Cron] Weekly digest failed', { message: error.message });
    }
  });

  logger.info('[Cron] ✓ Jobs scheduled successfully', {
    jobs: [
      'Session cleanup (hourly)',
      'Permanent session deletion (daily at 3am)',
      'Weekly digest (Monday 8am)'
    ]
  });
}

