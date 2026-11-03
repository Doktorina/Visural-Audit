const mailer = require('../mailer');
const pd = require('../prescription-doc');
const db = require('../data/db.json');

async function main() {
  const reg = await mailer.sendRegistrationMail({
    to: process.argv[2] || 'kirillsadrin812@gmail.com',
    firstName: 'Test',
    code: '123456',
  });
  console.log('registration:', JSON.stringify(reg));

  const v = db.violations[0];
  const u = db.users.find((x) => x.id === v.createdByUserId) || db.users[0];
  if (v && u) {
    const { attachments } = pd.buildEmailAttachments(v, db, { user: u, db });
    const many = await mailer.sendMailMany({
      recipients: [
        'sec-work@visural.ru',
        'admin@victory-check.ru',
        'kirillsadrin812@gmail.com',
      ],
      subject: 'Visural Audit — тест акта',
      text: 'Тестовое письмо с актом-предписанием',
      attachments,
    });
    console.log('act mail:', JSON.stringify({ sent: many.sent, message: many.message, hasAct: many.sent }));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
