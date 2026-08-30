const { Resend } = require('resend');

class EmailConfigError extends Error {}

function getClient() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new EmailConfigError(
      'RESEND_API_KEY is not set — add it to .env before using the Contact us form.'
    );
  }
  return new Resend(apiKey);
}

// CONTACT_EMAIL_TO defaults to the app owner's inbox per the current
// project request. CONTACT_EMAIL_FROM defaults to Resend's shared
// sandbox sender, which works without verifying your own domain — swap
// it for a verified "you@closetry.app" (or whatever domain you land on)
// before real launch, since the sandbox sender has lower deliverability
// and Resend may rate limit or restrict it for production traffic.
async function sendContactEmail({ fromName, fromEmail, subject, message }) {
  const resend = getClient();
  const to = process.env.CONTACT_EMAIL_TO || 'cristianpoenaru7@gmail.com';
  const from = process.env.CONTACT_EMAIL_FROM || 'Closetry <onboarding@resend.dev>';

  return resend.emails.send({
    from,
    to,
    replyTo: fromEmail, // reply in your inbox goes straight back to the user
    subject: `[Closetry] ${subject || 'New contact message'}`,
    text: `From: ${fromName} <${fromEmail}>\n\n${message}`,
  });
}

module.exports = { sendContactEmail, EmailConfigError };
