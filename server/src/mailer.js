const nodemailer = require('nodemailer');

/**
 * Creates a transporter.
 * In production: uses SMTP credentials from env (e.g. Gmail, SendGrid, Resend).
 * In development: uses Ethereal (no credentials needed, catches all emails).
 */
async function createTransporter() {
  if (process.env.SMTP_HOST) {
    // Production SMTP (SendGrid, Brevo, Gmail, etc.)
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  // Dev: use Ethereal auto-account (view emails at https://ethereal.email)
  const testAccount = await nodemailer.createTestAccount();
  const transporter = nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    auth: {
      user: testAccount.user,
      pass: testAccount.pass,
    },
  });
  console.log('[email] Using Ethereal test account:', testAccount.user);
  return transporter;
}

async function sendPasswordResetOtp({ toEmail, toName, otp }) {
  const transporter = await createTransporter();
  const fromName = process.env.EMAIL_FROM_NAME || 'CollabEdit';
  const fromEmail = process.env.EMAIL_FROM || 'noreply@collabdoc.app';

  const info = await transporter.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to: toEmail,
    subject: 'Your CollabEdit Password Reset OTP',
    text: `Hi ${toName},\n\nYour one-time password (OTP) to reset your password is:\n\n  ${otp}\n\nThis code expires in 15 minutes. Do not share it with anyone.\n\nIf you did not request this, please ignore this email.\n\n— The CollabEdit Team`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#f9f9f9;border-radius:8px;padding:32px">
        <h2 style="margin:0 0 8px;color:#202124">Password Reset</h2>
        <p style="color:#5f6368;margin:0 0 24px">Hi <strong>${toName}</strong>,</p>
        <p style="color:#5f6368">Use the OTP below to reset your CollabEdit password. This code is valid for <strong>15 minutes</strong> and can only be used once.</p>
        <div style="background:#fff;border:2px solid #1a73e8;border-radius:8px;text-align:center;padding:24px;margin:24px 0">
          <span style="font-size:36px;font-weight:900;letter-spacing:10px;color:#1a73e8">${otp}</span>
        </div>
        <p style="color:#5f6368;font-size:13px">If you did not request a password reset, you can safely ignore this email.</p>
        <hr style="border:none;border-top:1px solid #e8eaed;margin:24px 0"/>
        <p style="color:#9aa0a6;font-size:12px;margin:0">— The CollabEdit Team</p>
      </div>
    `,
  });

  // In dev, log the preview URL so you can see the email without a real inbox
  if (!process.env.SMTP_HOST) {
    console.log('[email] Preview URL:', nodemailer.getTestMessageUrl(info));
  }
}

module.exports = { sendPasswordResetOtp };
