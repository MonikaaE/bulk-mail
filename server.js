/* ═══════════════════════════════════════════════════════════
   MailFlow — server.js
   Node.js backend for bulk email sending with attachments
═══════════════════════════════════════════════════════════ */

const express = require('express');
const nodemailer = require('nodemailer');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// ─── Middleware ───────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// ─── Multer for file uploads ─────────────────────────────
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'attachment') {
      // Allow PDF, DOC, DOCX, images
      const allowed = ['.pdf', '.doc', '.docx', '.png', '.jpg', '.jpeg'];
      const ext = path.extname(file.originalname).toLowerCase();
      if (allowed.includes(ext)) {
        cb(null, true);
      } else {
        cb(new Error('Only PDF, DOC, DOCX, PNG, JPG files are allowed.'));
      }
    } else {
      cb(null, true);
    }
  }
});

// ─── Helper: Create SMTP transporter ─────────────────────
function createTransporter(config) {
  const { provider, email, appPassword } = config;

  const smtpConfig = {
    gmail: {
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: { user: email, pass: appPassword }
    },
    outlook: {
      host: 'smtp.office365.com',
      port: 587,
      secure: false,
      auth: { user: email, pass: appPassword }
    },
    yahoo: {
      host: 'smtp.mail.yahoo.com',
      port: 587,
      secure: false,
      auth: { user: email, pass: appPassword }
    },
    custom: {
      host: config.smtpHost || 'smtp.gmail.com',
      port: parseInt(config.smtpPort) || 587,
      secure: config.smtpSecure === 'true' || config.smtpSecure === true,
      auth: { user: email, pass: appPassword }
    }
  };

  return nodemailer.createTransport(smtpConfig[provider] || smtpConfig.gmail);
}

// ─── Helper: Sleep ───────────────────────────────────────
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── API: Test SMTP Connection ───────────────────────────
app.post('/api/test-connection', async (req, res) => {
  try {
    const transporter = createTransporter(req.body);
    await transporter.verify();
    res.json({ success: true, message: 'SMTP connection verified successfully!' });
  } catch (error) {
    res.json({ success: false, message: `Connection failed: ${error.message}` });
  }
});

// ─── API: Send Test Email ────────────────────────────────
app.post('/api/send-test', upload.single('attachment'), async (req, res) => {
  try {
    const { provider, email, appPassword, testTo, subject, body, fromName } = req.body;

    const transporter = createTransporter({ provider, email, appPassword });

    const mailOptions = {
      from: `"${fromName || 'MailFlow'}" <${email}>`,
      to: testTo,
      subject: `[TEST] ${subject || 'Test Email'}`,
      html: body || '<p>This is a test email from MailFlow.</p>',
      attachments: []
    };

    if (req.file) {
      mailOptions.attachments.push({
        filename: req.file.originalname,
        path: req.file.path
      });
    }

    await transporter.sendMail(mailOptions);

    // Clean up uploaded file
    if (req.file) {
      fs.unlink(req.file.path, () => {});
    }

    res.json({ success: true, message: `Test email sent to ${testTo}!` });
  } catch (error) {
    if (req.file) fs.unlink(req.file.path, () => {});
    res.json({ success: false, message: `Failed: ${error.message}` });
  }
});

// ─── API: Send Bulk Emails ───────────────────────────────
app.post('/api/send-bulk', upload.single('attachment'), async (req, res) => {
  try {
    const {
      provider, email, appPassword,
      recipients, subject, body, fromName,
      delayMs
    } = req.body;

    const recipientList = JSON.parse(recipients);
    if (!recipientList || recipientList.length === 0) {
      return res.json({ success: false, message: 'No recipients provided.' });
    }

    const transporter = createTransporter({
      provider, email, appPassword,
      smtpHost: req.body.smtpHost,
      smtpPort: req.body.smtpPort,
      smtpSecure: req.body.smtpSecure
    });

    // Verify connection first
    await transporter.verify();

    const delay = parseInt(delayMs) || 2000; // Default 2s between emails
    let sent = 0;
    let failed = 0;
    const errors = [];

    for (let i = 0; i < recipientList.length; i++) {
      const r = recipientList[i];
      const recipientName = r.name && r.name.trim() ? r.name.trim() : '';

      // Personalized body & subject if {{name}} is used
      let personalizedBody = body || '';
      let personalizedSubject = subject || '';

      if (recipientName) {
        personalizedBody = personalizedBody.replace(/\{\{\s*name\s*\}\}/gi, recipientName);
        personalizedSubject = personalizedSubject.replace(/\{\{\s*name\s*\}\}/gi, recipientName);
      } else {
        personalizedBody = personalizedBody.replace(/\{\{\s*name\s*\}\}/gi, 'Hiring Manager');
        personalizedSubject = personalizedSubject.replace(/\{\{\s*name\s*\}\}/gi, '');
      }

      const mailOptions = {
        from: `"${fromName || 'MailFlow'}" <${email}>`,
        to: recipientName ? `"${recipientName}" <${r.email}>` : r.email,
        subject: personalizedSubject,
        html: personalizedBody,
        attachments: []
      };

      if (req.file) {
        mailOptions.attachments.push({
          filename: req.file.originalname,
          path: req.file.path
        });
      }

      try {
        await transporter.sendMail(mailOptions);
        sent++;
      } catch (e) {
        failed++;
        errors.push({ email: r.email, error: e.message });
      }

      // Delay between emails to avoid rate limiting
      if (i < recipientList.length - 1) {
        await sleep(delay);
      }
    }

    // Clean up uploaded file after all sends
    if (req.file) {
      fs.unlink(req.file.path, () => {});
    }

    res.json({
      success: true,
      sent,
      failed,
      total: recipientList.length,
      errors: errors.slice(0, 10),
      message: `Completed! ${sent} sent, ${failed} failed out of ${recipientList.length} emails.`
    });

  } catch (error) {
    if (req.file) fs.unlink(req.file.path, () => {});
    res.json({ success: false, message: `Bulk send error: ${error.message}` });
  }
});

// ─── Error Handling Middleware ───────────────────────────
app.use((err, req, res, next) => {
  if (err) {
    console.error('Error:', err.message);
    return res.status(400).json({ success: false, message: err.message });
  }
  next();
});

// ─── Start Server ────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  ✉  MailFlow server running at http://localhost:${PORT}\n`);
});
