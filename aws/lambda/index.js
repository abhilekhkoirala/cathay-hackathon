/* Lambda entry point. Wires the real AWS clients into the verify logic.
 * @aws-sdk/* v3 is already included in the Node.js Lambda runtime, so there is nothing to npm install.
 * SES + DynamoDB access comes from the function's IAM role — no keys or SMTP passwords anywhere. */
'use strict';
const { SESv2Client, SendEmailCommand } = require('@aws-sdk/client-sesv2');
const { createHandler, BRAND } = require('./verify');
const { createDynamoStore } = require('./store');

const SENDER_EMAIL = process.env.SENDER_EMAIL || '';
const MAIL_MODE = process.env.MAIL_MODE === 'demo' ? 'demo' : 'ses';

const ses = new SESv2Client({});
const utf8 = (Data) => ({ Data, Charset: 'UTF-8' });

const mailer = {
  async send({ to, subject, text, html }) {
    if (!SENDER_EMAIL) throw new Error('SENDER_EMAIL is not configured');
    await ses.send(new SendEmailCommand({
      FromEmailAddress: `"${BRAND}" <${SENDER_EMAIL}>`,
      Destination: { ToAddresses: [to] },
      Content: { Simple: { Subject: utf8(subject), Body: { Text: utf8(text), Html: utf8(html) } } },
    }));
  },
};

exports.handler = createHandler({
  store: createDynamoStore({ tableName: process.env.TABLE_NAME }),
  mailer,
  mailMode: MAIL_MODE,
});
