/**
 * Sends every customer-facing email template to a review inbox so you can see
 * the redesigned templates rendered for real, exactly as a recipient would.
 *
 * Run it yourself (not run automatically by anything):
 *   npx tsx scripts/send-template-previews.ts
 *   npx tsx scripts/send-template-previews.ts someone-else@example.com   (override recipient)
 *
 * Requires RESEND_API_KEY (and optionally EMAIL_BANNER_URL) to be set in .env -
 * it reads the same env config the running server uses, no server needs to be up.
 */

import { templateService } from '../src/architectures/email/services/template.service';
import { sendEmail } from '../src/architectures/email/providers/email.provider';

const TO = process.argv[2] || 'owusujoyansah@gmail.com';

async function main() {
  console.log(`Sending template previews to ${TO}...\n`);

  const templates: Array<{ label: string; subject: string; html: string }> = [
    {
      label: 'OTP - email verification',
      subject: '[Preview] Verify Your Email',
      html: templateService.renderOTPEmail({ otp: '482913', type: 'email_verification' }),
    },
    {
      label: 'OTP - password reset',
      subject: '[Preview] Reset Your Password',
      html: templateService.renderOTPEmail({ otp: '773204', type: 'password_reset' }),
    },
    {
      label: 'OTP - 2FA',
      subject: '[Preview] Two-Factor Authentication Code',
      html: templateService.renderOTPEmail({ otp: '159620', type: '2fa' }),
    },
    {
      label: 'Magic link login',
      subject: '[Preview] Your Sign-In Link',
      html: templateService.renderMagicLinkEmail({
        magicLinkUrl: 'https://formachat.com/#/magic-login?email=owusujoyansah%40gmail.com&token=preview-token-do-not-use',
      }),
    },
    {
      label: 'Welcome',
      subject: '[Preview] Welcome to FormaChat',
      html: templateService.renderWelcomeEmail({ firstName: 'Joy', lastName: 'Owusu Ansah' }),
    },
    {
      label: 'Password changed',
      subject: '[Preview] Password Changed Successfully',
      html: templateService.renderPasswordChangedEmail({ changedAt: new Date() }),
    },
    {
      label: 'Account deactivated',
      subject: '[Preview] Account Deactivated',
      html: templateService.renderAccountDeactivatedEmail({
        deactivatedAt: new Date(),
        reason: 'Requested by user',
      }),
    },
    {
      label: 'Lead captured',
      subject: '[Preview] New Lead Captured',
      html: templateService.renderLeadNotificationEmail({
        businessName: 'Acme Coffee Co.',
        leadName: 'Sarah Mensah',
        leadEmail: 'sarah.mensah@example.com',
        leadPhone: '+233 24 123 4567',
        sessionId: 'preview-session-id',
        messageCount: 7,
        capturedAt: new Date(),
      }),
    },
    {
      label: 'Weekly summary',
      subject: '[Preview] Acme Coffee Co. - Weekly Report',
      html: templateService.renderWeeklySummaryEmail({
        businessId: 'preview-business-id',
        businessName: 'Acme Coffee Co.',
        firstName: 'Joy',
        weekRange: 'Jul 5 - Jul 11, 2026',
        totalConversations: 42,
        newLeads: 6,
        totalMessages: 318,
        avgMessagesPerSession: 8,
        topQuestion: 'Do you have oat milk available?',
        newLeadsDetails: [
          { name: 'Sarah Mensah', email: 'sarah.mensah@example.com', phone: '+233 24 123 4567' },
          { name: 'Kojo Boateng', email: 'kojo.b@example.com' },
        ],
      }),
    },
  ];

  for (const t of templates) {
    try {
      const id = await sendEmail({ to: TO, subject: t.subject, html: t.html });
      console.log(`  sent: ${t.label} (id: ${id})`);
    } catch (err: any) {
      console.error(`  FAILED: ${t.label} - ${err.message}`);
    }
  }

  console.log('\nDone. Check the inbox (and spam folder) for all templates.');
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
