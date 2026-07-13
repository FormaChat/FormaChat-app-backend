/**
 * Sends the "what's new" marketing update email to a review inbox so you can
 * see it rendered for real, exactly as a recipient would, before it ever
 * goes anywhere near real users.
 *
 * Run it yourself (not run automatically by anything):
 *   npx tsx scripts/send-marketing-preview.ts
 *   npx tsx scripts/send-marketing-preview.ts someone-else@example.com   (override recipient)
 *
 * Requires RESEND_API_KEY (and optionally EMAIL_BANNER_URL) to be set in .env -
 * it reads the same env config the running server uses, no server needs to be up.
 *
 * Once you're happy with how this looks, the real send-to-everyone script is
 * scripts/send-marketing-broadcast.ts - a separate script, deliberately, so
 * previewing this one can never accidentally email a real user.
 */

import { templateService } from '../src/architectures/email/services/template.service';
import { sendEmail } from '../src/architectures/email/providers/email.provider';

const TO = process.argv[2] || 'owusujoyansah@gmail.com';

// Marketing sends from a named person, not the noreply@ address every other
// (transactional) email uses - "Display Name <address>" is what makes an
// inbox show a real name instead of a bare address, and reads as a person
// reaching out rather than an automated notification. Only the marketing
// scripts override `from` like this; transactional email keeps using the
// default RESEND_FROM_EMAIL.
const MARKETING_FROM = 'Joy from FormaChat <joy@formachat.com>';

async function main() {
  console.log(`Sending marketing email preview to ${TO}...\n`);

  const html = templateService.renderMarketingUpdateEmail({ firstName: 'Joy' });

  const id = await sendEmail({
    to: TO,
    from: MARKETING_FROM,
    subject: "[Preview] What's new on FormaChat",
    html,
  });

  console.log(`Sent (id: ${id}). Check the inbox (and spam folder).`);
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
