/**
 * Sends the "what's new" marketing update email to every active, verified
 * user - the real broadcast, not a preview.
 *
 * SAFETY: defaults to a DRY RUN. It connects to the database, builds the
 * exact recipient list, and prints it (count + first few emails) without
 * sending a single message. Nothing goes out until you explicitly pass
 * --send. There is no other way to trigger a real send from this script.
 *
 * Preview what the email actually looks like first, with:
 *   npx tsx scripts/send-marketing-preview.ts
 *
 * Dry run (default - safe, sends nothing):
 *   npx tsx scripts/send-marketing-broadcast.ts
 *
 * Real send, once you've reviewed the dry-run output and are ready:
 *   npx tsx scripts/send-marketing-broadcast.ts --send
 *
 * Targets: UserModel where isActive: true AND isVerified: true - accounts
 * that completed registration (email-verified) and have not deactivated
 * their account. Sends one email at a time (never a shared "to" list, which
 * would leak every recipient's address to every other recipient), with a
 * short delay between sends to stay well under Resend's rate limits.
 */

import { databaseManager } from '../src/architectures/auth/config/auth.database';
import { UserModel } from '../src/architectures/auth/persistence/auth.user.models';
import { templateService } from '../src/architectures/email/services/template.service';
import { sendEmail } from '../src/architectures/email/providers/email.provider';

const SEND = process.argv.includes('--send');
const DELAY_MS = 600; // stays comfortably under Resend's default rate limit

// Same named-sender address as send-marketing-preview.ts - keep these two
// in sync, since the whole point of the preview script is to show exactly
// what real recipients will see.
const MARKETING_FROM = 'Joy from FormaChat <joy@formachat.com>';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log(`Mode: ${SEND ? 'REAL SEND' : 'DRY RUN (no emails will be sent)'}\n`);

  await databaseManager.connect();

  try {
    const recipients = await UserModel.find({ isActive: true, isVerified: true })
      .select('email firstName')
      .lean();

    console.log(`Found ${recipients.length} active, verified user(s).`);

    if (recipients.length === 0) {
      console.log('Nothing to do.');
      return;
    }

    if (!SEND) {
      console.log('\nFirst 10 recipients (dry run - nothing sent):');
      recipients.slice(0, 10).forEach((u) => console.log(`  - ${u.firstName} <${u.email}>`));
      if (recipients.length > 10) {
        console.log(`  ...and ${recipients.length - 10} more`);
      }
      console.log('\nRe-run with --send to actually email these users.');
      return;
    }

    console.log('\nSending for real. Ctrl+C now if this is not what you meant to do.\n');

    let sent = 0;
    let failed = 0;

    for (const user of recipients) {
      try {
        const html = templateService.renderMarketingUpdateEmail({ firstName: user.firstName });
        await sendEmail({
          to: user.email,
          from: MARKETING_FROM,
          subject: "What's new on FormaChat",
          html,
        });
        sent++;
        console.log(`  sent: ${user.email}`);
      } catch (err: any) {
        failed++;
        console.error(`  FAILED: ${user.email} - ${err.message}`);
      }

      await sleep(DELAY_MS);
    }

    console.log(`\nDone. Sent: ${sent}, Failed: ${failed}, Total: ${recipients.length}`);
  } finally {
    await databaseManager.disconnect();
  }
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
