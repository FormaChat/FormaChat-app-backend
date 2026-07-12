import cron from 'node-cron';
import { UserModel, BlacklistedEmailModel } from '../persistence/auth.user.models';
import { UserService } from '../services/auth.user.service';
import { createLogger } from '../utils/auth.logger.utils';

const logger = createLogger('auth-cron-scheduler');

export function setupAuthCronJobs() {
  // Daily at 4am — hard-delete accounts whose deactivation grace period has
  // expired, and blacklist their email so it can't be used to register again.
  cron.schedule('0 4 * * *', async () => {
    try {
      logger.info('[Cron] Starting expired-deactivation cleanup...');

      const graceMs = UserService.DEACTIVATION_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;
      const cutoff = new Date(Date.now() - graceMs);

      const expiredUsers = await UserModel.find({
        isActive: false,
        deactivatedAt: { $lte: cutoff }
      }).select('_id email');

      let deleted = 0;
      for (const user of expiredUsers) {
        try {
          await BlacklistedEmailModel.updateOne(
            { email: user.email },
            { $setOnInsert: { email: user.email, blacklistedAt: new Date() } },
            { upsert: true }
          );
          await UserModel.deleteOne({ _id: user._id });
          deleted++;
        } catch (innerError: any) {
          logger.error('[Cron] Failed to delete expired account', {
            userId: user._id.toString(),
            message: innerError.message
          });
        }
      }

      logger.info('[Cron] ✓ Expired-deactivation cleanup complete', {
        deleted,
        total: expiredUsers.length
      });
    } catch (error: any) {
      logger.error('[Cron] Expired-deactivation cleanup failed', {
        message: error.message,
        stack: error.stack
      });
    }
  });

  logger.info('[Cron] ✓ Auth jobs scheduled successfully', {
    jobs: ['Expired deactivation cleanup + email blacklist (daily at 4am)']
  });
}
