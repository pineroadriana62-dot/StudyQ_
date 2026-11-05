const nodemailer = require('nodemailer');

function createTransport() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user, pass }
  });
}

function reminderTemplate({ name, subjectName, eventType, eventTitle, daysRemaining = 3 }) {
  const safeName = escapeHtml(name || 'Estudiante');
  const safeSubject = escapeHtml(subjectName || 'Materia');
  const safeType = escapeHtml(eventType === 'schedule' ? 'Sesión de estudio/práctica' : 'Evaluación');
  const safeTitle = escapeHtml(eventTitle || 'Actividad académica');
  return `<!doctype html><html><body style="margin:0;background:#f5f7fb;font-family:Arial,sans-serif"><div style="max-width:560px;margin:24px auto;background:white;border-radius:16px;padding:28px"><p style="color:#635bff;font-weight:bold">STUDYQ</p><h1 style="color:#202238">Hola, ${safeName}</h1><p>Te recordamos que falta <strong>${daysRemaining} días</strong> para tu próxima actividad.</p><div style="background:#f0efff;border-radius:12px;padding:18px"><p style="margin:4px 0"><strong>Materia:</strong> ${safeSubject}</p><p style="margin:4px 0"><strong>Tipo:</strong> ${safeType}</p><p style="margin:4px 0"><strong>Actividad:</strong> ${safeTitle}</p></div><p style="color:#686b7f">Organiza tu tiempo y prepárate con calma. ¡Tú puedes!</p></div></body></html>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

async function sendReminder({ to, name, subjectName, eventType, eventTitle }) {
  const transport = createTransport();
  if (!transport) return { sent: false, reason: 'SMTP no configurado' };
  await transport.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject: `StudyQ: ${subjectName} — actividad en 3 días`,
    html: reminderTemplate({ name, subjectName, eventType, eventTitle })
  });
  return { sent: true };
}

module.exports = { sendReminder, createTransport };
