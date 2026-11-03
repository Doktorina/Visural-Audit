/**
 * Test SMTP delivery to a list of addresses.
 * node scripts/test-recipients.js addr1 addr2 ...
 */
const mailer = require('../mailer');

async function main() {
  const list = process.argv.slice(2).filter((e) => e.includes('@'));
  if (!list.length) {
    console.error('Usage: node scripts/test-recipients.js email1 email2 ...');
    process.exit(1);
  }
  for (const to of list) {
    try {
      const r = await mailer.sendMail({
        to,
        subject: 'Visural Audit — тест доставки',
        text: `Тест ${new Date().toISOString()}\nПолучатель: ${to}`,
      });
      console.log(to, r.sent ? 'OK' : 'FAIL', r.message || '');
    } catch (e) {
      console.log(to, 'ERR', e.message || e);
    }
  }
}

main();
