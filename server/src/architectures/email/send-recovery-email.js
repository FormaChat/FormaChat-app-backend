
// send-recovery-emails.js
const { Resend } = require('resend');
const handlebars = require('handlebars');
const fs = require('fs');
const path = require('path');
const { email } = require('envalid');


const RESEND_API_KEY = 're_bUzMvuX9_3GwkStPW5VjP8eX6iwboM69x';
const FROM_EMAIL = 'support@formachat.com';
const TEMPLATE_PATH = path.join(__dirname, 'service-recovery.hbs');

const affectedUsers = [
  { email: 'mrwillroom2005@gmail.com', firstName: 'Mr Will'},
 
];

function loadTemplate() {
  try {
    const templateContent = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
    return handlebars.compile(templateContent);
  } catch (error) {
    console.error(`❌ Failed to load template from ${TEMPLATE_PATH}`);
    console.error('Error:', error.message);
    process.exit(1);
  }
}

async function sendRecoveryEmails() {
  const resend = new Resend(RESEND_API_KEY);
  const template = loadTemplate();
  
  console.log('🚀 Starting recovery email campaign...\n');
  console.log(`📧 Template loaded from: ${TEMPLATE_PATH}`);
  console.log(`📧 Sending to ${affectedUsers.length} user(s)\n`);
  
  const results = {
    success: 0,
    failed: 0,
    errors: []
  };

  for (const user of affectedUsers) {
    try {
      const html = template({
        firstName: user.firstName || 'there',
        currentYear: new Date().getFullYear()
      });

      const { data, error } = await resend.emails.send({
        from: FROM_EMAIL,
        to: user.email,
        subject: 'Action Required: Complete Your FormaChat Registration',
        html: html
      });

      if (error) {
        throw error;
      }

      console.log(`✅ Sent to ${user.email} (ID: ${data.id})`);
      results.success++;
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      console.error(`❌ Failed to send to ${user.email}:`, error.message);
      results.failed++;
      results.errors.push({ email: user.email, error: error.message });
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log('📊 CAMPAIGN SUMMARY');
  console.log('='.repeat(50));
  console.log(`✅ Successfully sent: ${results.success}`);
  console.log(`❌ Failed: ${results.failed}`);
  
  if (results.errors.length > 0) {
    console.log('\n❌ Failed emails:');
    results.errors.forEach(err => {
      console.log(`   - ${err.email}: ${err.error}`);
    });
  }
  
  console.log('='.repeat(50) + '\n');
}

if (require.main === module) {
  sendRecoveryEmails()
    .then(() => {
      console.log('✅ Recovery email campaign completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Campaign failed:', error);
      process.exit(1);
    });
}

module.exports = { sendRecoveryEmails };