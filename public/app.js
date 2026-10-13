/* ═══════════════════════════════════════════════════════════
   MailFlow — app.js
   Frontend logic for bulk recruiter email sending
═══════════════════════════════════════════════════════════ */

'use strict';

// ─── API Base URL ──────────────────────────────────────────
// Handles both http://localhost:3000 and direct file:// access
const API_BASE = (window.location.protocol === 'file:') ? 'http://localhost:3000' : '';

// ─── State ────────────────────────────────────────────────
const state = {
  recipients: [],        // [{ name: string, email: string }]
  attachmentFile: null,  // File object
  bodyMode: 'rich',      // 'rich' | 'html'
  smtpConfig: {
    provider: 'gmail',
    email: '',
    appPassword: '',
    smtpHost: '',
    smtpPort: 587,
    smtpSecure: false
  },
  history: []            // [{ id, timestamp, subject, total, sent, failed }]
};

// ─── Initialization ──────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadStoredData();
  initNavigation();
  initSidebar();
  initFileUploads();
  initLiveReviewSync();
  updateConnectionStatusUI();
  renderHistory();
});

// ─── LocalStorage Persistence ────────────────────────────
function loadStoredData() {
  try {
    const savedConfig = localStorage.getItem('mailflow_smtp_config');
    if (savedConfig) {
      state.smtpConfig = { ...state.smtpConfig, ...JSON.parse(savedConfig) };
      populateSettingsForm();
    }

    const savedHistory = localStorage.getItem('mailflow_history');
    if (savedHistory) {
      state.history = JSON.parse(savedHistory);
    }
  } catch (err) {
    console.error('Error loading stored data:', err);
  }
}

function saveSmtpToStorage() {
  localStorage.setItem('mailflow_smtp_config', JSON.stringify(state.smtpConfig));
}

function saveHistoryToStorage() {
  localStorage.setItem('mailflow_history', JSON.stringify(state.history));
}

// ─── Navigation & Sidebar ────────────────────────────────
function initNavigation() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const page = btn.dataset.page;
      goToPage(page);
    });
  });
}

function goToPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const targetPage = document.getElementById(`page-${page}`);
  if (targetPage) targetPage.classList.add('active');

  const activeNav = document.getElementById(`nav-${page}`);
  if (activeNav) activeNav.classList.add('active');

  const titles = {
    compose: 'Compose & Send',
    history: 'Send History',
    settings: 'SMTP Settings'
  };
  const titleEl = document.getElementById('topbar-title');
  if (titleEl) titleEl.textContent = titles[page] || 'MailFlow';

  // Close mobile sidebar if open
  const sidebar = document.getElementById('sidebar');
  if (sidebar && window.innerWidth <= 900) {
    sidebar.classList.remove('open');
  }
}

function initSidebar() {
  const hamburger = document.getElementById('hamburger-btn');
  const sidebar = document.getElementById('sidebar');
  if (hamburger && sidebar) {
    hamburger.addEventListener('click', () => {
      sidebar.classList.toggle('open');
    });
  }
}

// ─── Rich Text & HTML Editor ─────────────────────────────
function formatText(cmd) {
  document.execCommand(cmd, false, null);
  const editor = document.getElementById('email-body-rich');
  if (editor) editor.focus();
}

function insertLink() {
  const url = prompt('Enter link URL (e.g., https://linkedin.com/in/username):');
  if (url) {
    document.execCommand('createLink', false, url);
  }
}

function switchMode(mode) {
  const richEditor = document.getElementById('email-body-rich');
  const htmlEditor = document.getElementById('email-body-html');
  const richBtn = document.getElementById('mode-rich');
  const htmlBtn = document.getElementById('mode-html');

  if (mode === 'html') {
    state.bodyMode = 'html';
    htmlEditor.value = richEditor.innerHTML.trim();
    richEditor.classList.add('hidden');
    htmlEditor.classList.remove('hidden');
    htmlBtn.classList.add('active');
    richBtn.classList.remove('active');
    htmlEditor.focus();
  } else {
    state.bodyMode = 'rich';
    richEditor.innerHTML = htmlEditor.value;
    htmlEditor.classList.add('hidden');
    richEditor.classList.remove('hidden');
    richBtn.classList.add('active');
    htmlBtn.classList.remove('active');
    richEditor.focus();
  }
}

function getEmailBody() {
  if (state.bodyMode === 'html') {
    return document.getElementById('email-body-html').value;
  }
  return document.getElementById('email-body-rich').innerHTML;
}

// ─── File Uploads (Resume & Recipient Lists) ──────────────
function initFileUploads() {
  // 1. PDF / Resume Dropzone
  const pdfZone = document.getElementById('pdf-drop-zone');
  const pdfInput = document.getElementById('pdf-input');

  if (pdfZone && pdfInput) {
    pdfZone.addEventListener('click', (e) => {
      if (e.target.tagName !== 'BUTTON') pdfInput.click();
    });

    ['dragenter', 'dragover'].forEach(name => {
      pdfZone.addEventListener(name, (e) => {
        e.preventDefault();
        pdfZone.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach(name => {
      pdfZone.addEventListener(name, (e) => {
        e.preventDefault();
        pdfZone.classList.remove('dragover');
      });
    });

    pdfZone.addEventListener('drop', (e) => {
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        setAttachment(e.dataTransfer.files[0]);
      }
    });
  }

  // 2. Email List Dropzone
  const emailZone = document.getElementById('email-drop-zone');
  const emailInput = document.getElementById('email-file-input');

  if (emailZone && emailInput) {
    emailZone.addEventListener('click', () => emailInput.click());

    ['dragenter', 'dragover'].forEach(name => {
      emailZone.addEventListener(name, (e) => {
        e.preventDefault();
        emailZone.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach(name => {
      emailZone.addEventListener(name, (e) => {
        e.preventDefault();
        emailZone.classList.remove('dragover');
      });
    });

    emailZone.addEventListener('drop', (e) => {
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        processEmailFile(e.dataTransfer.files[0]);
      }
    });
  }
}

function handlePdfUpload(event) {
  if (event.target.files && event.target.files[0]) {
    setAttachment(event.target.files[0]);
  }
}

function setAttachment(file) {
  const allowed = ['.pdf', '.doc', '.docx', '.png', '.jpg', '.jpeg'];
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();

  if (!allowed.includes(ext)) {
    showToast('Only PDF, DOC, DOCX files are supported.', 'error');
    return;
  }

  if (file.size > 25 * 1024 * 1024) {
    showToast('File size must be under 25MB.', 'error');
    return;
  }

  state.attachmentFile = file;

  // Update UI
  const attachedBox = document.getElementById('attached-file-info');
  const nameEl = document.getElementById('attached-file-name');
  const sizeEl = document.getElementById('attached-file-size');
  const badge = document.getElementById('attachment-badge');
  const zone = document.getElementById('pdf-drop-zone');

  if (nameEl) nameEl.textContent = file.name;
  if (sizeEl) sizeEl.textContent = formatBytes(file.size);
  if (attachedBox) attachedBox.classList.remove('hidden');
  if (badge) {
    badge.textContent = 'Attached';
    badge.classList.add('count-badge');
  }
  if (zone) zone.classList.add('hidden');

  updateReview();
  showToast(`Attached: ${file.name}`, 'info');
}

function removeAttachment() {
  state.attachmentFile = null;

  const pdfInput = document.getElementById('pdf-input');
  if (pdfInput) pdfInput.value = '';

  const attachedBox = document.getElementById('attached-file-info');
  const badge = document.getElementById('attachment-badge');
  const zone = document.getElementById('pdf-drop-zone');

  if (attachedBox) attachedBox.classList.add('hidden');
  if (zone) zone.classList.remove('hidden');
  if (badge) {
    badge.textContent = 'Optional';
    badge.classList.remove('count-badge');
  }

  updateReview();
  showToast('Attachment removed', 'info');
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ─── Recipient Emails Handling ───────────────────────────
function switchRecipientTab(tab) {
  const pasteTab = document.getElementById('tab-paste');
  const uploadTab = document.getElementById('tab-upload');
  const pastePanel = document.getElementById('recipient-paste-panel');
  const uploadPanel = document.getElementById('recipient-upload-panel');

  if (tab === 'paste') {
    pasteTab.classList.add('active');
    uploadTab.classList.remove('active');
    pastePanel.classList.remove('hidden');
    uploadPanel.classList.add('hidden');
  } else {
    uploadTab.classList.add('active');
    pasteTab.classList.remove('active');
    uploadPanel.classList.remove('hidden');
    pastePanel.classList.add('hidden');
  }
}

// Parse text into [{ name, email }]
function parseEmailString(rawText) {
  const lines = rawText.split(/[\r\n]+/);
  const found = [];
  const seen = new Set();

  const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/;

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;

    const match = line.match(emailRegex);
    if (match) {
      const email = match[1].toLowerCase().trim();
      if (!seen.has(email)) {
        seen.add(email);
        // Try extracting name before email or before comma
        let name = '';
        if (line.includes(',')) {
          const parts = line.split(',');
          name = parts[0].replace(emailRegex, '').replace(/["<>]/g, '').trim();
        } else if (line.includes('<')) {
          name = line.substring(0, line.indexOf('<')).replace(/["<>]/g, '').trim();
        }

        found.push({ name: name || '', email });
      }
    }
  }

  return found;
}

function parseAndLoadEmails() {
  const textarea = document.getElementById('paste-emails');
  const text = textarea ? textarea.value : '';

  if (!text.trim()) {
    showToast('Please paste email addresses first.', 'error');
    return;
  }

  const parsed = parseEmailString(text);
  if (parsed.length === 0) {
    showToast('No valid email addresses found.', 'error');
    return;
  }

  addRecipients(parsed);
  showToast(`Loaded ${parsed.length} email addresses!`, 'success');
}

function clearPastedEmails() {
  const textarea = document.getElementById('paste-emails');
  if (textarea) textarea.value = '';
}

function handleEmailFileUpload(event) {
  if (event.target.files && event.target.files[0]) {
    processEmailFile(event.target.files[0]);
  }
}

function processEmailFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    const parsed = parseEmailString(text);

    if (parsed.length === 0) {
      showToast('No valid email addresses found in file.', 'error');
      return;
    }

    addRecipients(parsed);
    showToast(`Loaded ${parsed.length} emails from ${file.name}!`, 'success');
  };
  reader.onerror = () => {
    showToast('Failed to read the file.', 'error');
  };
  reader.readAsText(file);
}

function addRecipients(newRecipients) {
  const existingMap = new Map();
  state.recipients.forEach(r => existingMap.set(r.email.toLowerCase(), r));

  newRecipients.forEach(r => {
    existingMap.set(r.email.toLowerCase(), r);
  });

  state.recipients = Array.from(existingMap.values());
  renderRecipientsList();
  updateReview();
}

function removeRecipient(email) {
  state.recipients = state.recipients.filter(r => r.email.toLowerCase() !== email.toLowerCase());
  renderRecipientsList();
  updateReview();
}

function clearAllEmails() {
  state.recipients = [];
  renderRecipientsList();
  updateReview();
  showToast('Cleared all recipients', 'info');
}

function renderRecipientsList() {
  const section = document.getElementById('loaded-emails-section');
  const list = document.getElementById('loaded-emails-list');
  const badge = document.getElementById('email-count-badge');

  if (badge) {
    badge.textContent = `${state.recipients.length} email${state.recipients.length === 1 ? '' : 's'}`;
  }

  if (state.recipients.length === 0) {
    if (section) section.classList.add('hidden');
    if (list) list.innerHTML = '';
    return;
  }

  if (section) section.classList.remove('hidden');
  if (list) {
    list.innerHTML = state.recipients.map(r => `
      <div class="email-tag">
        <span>${escapeHtml(r.name ? `${r.name} (${r.email})` : r.email)}</span>
        <button class="email-tag-remove" onclick="removeRecipient('${escapeHtml(r.email)}')" title="Remove">✕</button>
      </div>
    `).join('');
  }
}

// ─── Step 4: Live Review Sync ────────────────────────────
function initLiveReviewSync() {
  const subjectInput = document.getElementById('email-subject');
  const fromNameInput = document.getElementById('from-name');

  if (subjectInput) {
    subjectInput.addEventListener('input', updateReview);
  }
  if (fromNameInput) {
    fromNameInput.addEventListener('input', updateReview);
  }

  updateReview();
}

function updateReview() {
  const subjectInput = document.getElementById('email-subject');
  const fromNameInput = document.getElementById('from-name');

  const reviewSubject = document.getElementById('review-subject');
  const reviewFrom = document.getElementById('review-from');
  const reviewAttachment = document.getElementById('review-attachment');
  const reviewRecipients = document.getElementById('review-recipients');

  const nameVal = fromNameInput ? fromNameInput.value.trim() : '';
  const subjVal = subjectInput ? subjectInput.value.trim() : '';

  if (reviewSubject) reviewSubject.textContent = subjVal || '—';

  if (reviewFrom) {
    if (state.smtpConfig.email) {
      reviewFrom.textContent = nameVal ? `${nameVal} <${state.smtpConfig.email}>` : state.smtpConfig.email;
    } else {
      reviewFrom.textContent = nameVal || 'Not configured in Settings';
    }
  }

  if (reviewAttachment) {
    reviewAttachment.textContent = state.attachmentFile ? state.attachmentFile.name : 'None';
  }

  if (reviewRecipients) {
    reviewRecipients.textContent = `${state.recipients.length} recruiter${state.recipients.length === 1 ? '' : 's'}`;
  }
}

// ─── Send Test Email ─────────────────────────────────────
async function sendTestEmail() {
  if (!state.smtpConfig.email || !state.smtpConfig.appPassword) {
    showToast('Please configure your Email & App Password in SMTP Settings first!', 'error');
    goToPage('settings');
    return;
  }

  const subject = document.getElementById('email-subject').value.trim() || 'Test Email from MailFlow';
  const body = getEmailBody();
  const fromName = document.getElementById('from-name').value.trim() || 'MailFlow';

  const testBtn = document.getElementById('send-test-btn');
  if (testBtn) {
    testBtn.disabled = true;
    testBtn.textContent = '⏳ Sending test...';
  }

  const formData = new FormData();
  formData.append('provider', state.smtpConfig.provider);
  formData.append('email', state.smtpConfig.email);
  formData.append('appPassword', state.smtpConfig.appPassword);
  formData.append('testTo', state.smtpConfig.email); // Send to self
  formData.append('subject', subject);
  formData.append('body', body);
  formData.append('fromName', fromName);

  if (state.attachmentFile) {
    formData.append('attachment', state.attachmentFile);
  }

  try {
    const res = await fetch(`${API_BASE}/api/send-test`, {
      method: 'POST',
      body: formData
    });

    const data = await res.json();
    if (data.success) {
      showToast(`Test email successfully sent to ${state.smtpConfig.email}! Check your inbox.`, 'success');
    } else {
      showToast(`Test failed: ${data.message}`, 'error');
    }
  } catch (err) {
    showToast(`Network error: ${err.message}. Is server running?`, 'error');
  } finally {
    if (testBtn) {
      testBtn.disabled = false;
      testBtn.textContent = '🧪 Send Test to Yourself';
    }
  }
}

// ─── Send Bulk Emails ────────────────────────────────────
async function sendBulkEmails() {
  if (!state.smtpConfig.email || !state.smtpConfig.appPassword) {
    showToast('Please configure your Email & App Password in SMTP Settings first!', 'error');
    goToPage('settings');
    return;
  }

  const subject = document.getElementById('email-subject').value.trim();
  if (!subject) {
    showToast('Please enter an email Subject Line.', 'error');
    document.getElementById('email-subject').focus();
    return;
  }

  const body = getEmailBody();
  if (!body || body === '<p><br></p>' || body === '') {
    showToast('Please write your Email Body.', 'error');
    return;
  }

  if (state.recipients.length === 0) {
    showToast('Please add at least one recruiter email address in Step 3.', 'error');
    return;
  }

  const delayInput = document.getElementById('send-delay');
  const delaySec = delayInput ? Math.max(1, parseInt(delayInput.value) || 3) : 3;
  const delayMs = delaySec * 1000;
  const fromName = document.getElementById('from-name').value.trim() || 'MailFlow';

  const confirmMsg = `Send to ${state.recipients.length} recruiter(s) with ${state.attachmentFile ? `attachment "${state.attachmentFile.name}"` : 'no attachment'}?`;
  if (!confirm(confirmMsg)) return;

  const sendBtn = document.getElementById('send-all-btn');
  const progressArea = document.getElementById('send-progress-area');
  const progressBar = document.getElementById('send-progress-bar');
  const progressLabel = document.getElementById('send-progress-label');
  const resultBox = document.getElementById('send-result');

  if (sendBtn) sendBtn.disabled = true;
  if (resultBox) {
    resultBox.className = 'send-result hidden';
    resultBox.innerHTML = '';
  }
  if (progressArea) progressArea.classList.remove('hidden');

  if (progressBar) progressBar.style.width = '10%';
  if (progressLabel) progressLabel.textContent = `Connecting to ${state.smtpConfig.provider.toUpperCase()} & starting delivery...`;

  const formData = new FormData();
  formData.append('provider', state.smtpConfig.provider);
  formData.append('email', state.smtpConfig.email);
  formData.append('appPassword', state.smtpConfig.appPassword);
  formData.append('recipients', JSON.stringify(state.recipients));
  formData.append('subject', subject);
  formData.append('body', body);
  formData.append('fromName', fromName);
  formData.append('delayMs', delayMs);

  if (state.attachmentFile) {
    formData.append('attachment', state.attachmentFile);
  }

  // Simulated progress increments while sending
  let progress = 10;
  const totalEmails = state.recipients.length;
  const estimatedTotalTime = totalEmails * delayMs + 3000;
  const progressTimer = setInterval(() => {
    if (progress < 90) {
      progress += Math.max(2, Math.floor(80 / (estimatedTotalTime / 1000)));
      if (progressBar) progressBar.style.width = `${Math.min(progress, 90)}%`;
      if (progressLabel) progressLabel.textContent = `Sending emails with ${delaySec}s delay between recruiters... (${Math.round((progress / 90) * totalEmails)} of ${totalEmails})`;
    }
  }, 1000);

  try {
    const res = await fetch(`${API_BASE}/api/send-bulk`, {
      method: 'POST',
      body: formData
    });

    clearInterval(progressTimer);
    const data = await res.json();

    if (progressBar) progressBar.style.width = '100%';
    if (progressLabel) progressLabel.textContent = 'Done!';

    if (data.success) {
      resultBox.className = 'send-result success';
      resultBox.innerHTML = `
        <strong>🎉 Campaign Complete!</strong><br />
        Successfully sent: <strong>${data.sent}</strong> &nbsp;|&nbsp;
        Failed: <strong>${data.failed}</strong> &nbsp;|&nbsp;
        Total: <strong>${data.total}</strong>
        ${data.errors && data.errors.length > 0 ? `<div style="margin-top:8px; font-size:0.8rem; color:#fca5a5;">Failed addresses:<br/>${data.errors.map(e => `• ${escapeHtml(e.email)}: ${escapeHtml(e.error)}`).join('<br/>')}</div>` : ''}
      `;
      resultBox.classList.remove('hidden');

      // Record in history
      const historyEntry = {
        id: Date.now(),
        date: new Date().toLocaleString(),
        subject: subject,
        total: data.total,
        sent: data.sent,
        failed: data.failed,
        attachment: state.attachmentFile ? state.attachmentFile.name : null
      };
      state.history.unshift(historyEntry);
      saveHistoryToStorage();
      renderHistory();

      showToast(`Campaign finished! ${data.sent} sent successfully.`, 'success');
    } else {
      resultBox.className = 'send-result error';
      resultBox.innerHTML = `<strong>Delivery Error:</strong> ${escapeHtml(data.message)}`;
      resultBox.classList.remove('hidden');
      showToast(`Error: ${data.message}`, 'error');
    }
  } catch (err) {
    clearInterval(progressTimer);
    if (progressBar) progressBar.style.width = '0%';
    resultBox.className = 'send-result error';
    resultBox.innerHTML = `<strong>Network / Server Error:</strong> ${escapeHtml(err.message)}. Make sure server.js is running.`;
    resultBox.classList.remove('hidden');
    showToast(`Failed to connect to server: ${err.message}`, 'error');
  } finally {
    if (sendBtn) sendBtn.disabled = false;
  }
}

// ─── SMTP Settings Logic ─────────────────────────────────
function onProviderChange() {
  const provider = document.querySelector('input[name="provider"]:checked').value;
  state.smtpConfig.provider = provider;

  const hint = document.getElementById('app-password-hint');
  const emailInput = document.getElementById('smtp-email');

  if (hint) {
    if (provider === 'gmail') {
      hint.innerHTML = 'For Gmail: Go to <a href="https://myaccount.google.com/apppasswords" target="_blank" class="link">Google App Passwords</a> → Select Mail & Device → Generate 16-digit password';
      if (emailInput && !emailInput.value) emailInput.placeholder = 'yourname@gmail.com';
    } else if (provider === 'outlook') {
      hint.innerHTML = 'For Outlook/Office 365: Go to Microsoft Account Security → Advanced Security Options → App Passwords';
      if (emailInput && !emailInput.value) emailInput.placeholder = 'yourname@outlook.com';
    } else if (provider === 'yahoo') {
      hint.innerHTML = 'For Yahoo: Go to Account Security → Generate App Password';
      if (emailInput && !emailInput.value) emailInput.placeholder = 'yourname@yahoo.com';
    }
  }
}

function togglePasswordVisibility() {
  const pwd = document.getElementById('smtp-password');
  const btn = document.getElementById('toggle-password-btn');
  if (pwd) {
    if (pwd.type === 'password') {
      pwd.type = 'text';
      if (btn) btn.textContent = '🙈';
    } else {
      pwd.type = 'password';
      if (btn) btn.textContent = '👁';
    }
  }
}

function populateSettingsForm() {
  const emailInput = document.getElementById('smtp-email');
  const pwdInput = document.getElementById('smtp-password');
  const providerRadio = document.querySelector(`input[name="provider"][value="${state.smtpConfig.provider}"]`);

  if (emailInput) emailInput.value = state.smtpConfig.email || '';
  if (pwdInput) pwdInput.value = state.smtpConfig.appPassword || '';
  if (providerRadio) providerRadio.checked = true;

  onProviderChange();
  updateConnectionStatusUI();
}

function updateConnectionStatusUI() {
  const dot = document.querySelector('.status-dot');
  const statusText = document.querySelector('.status-text');
  const userDisplay = document.getElementById('user-name-display');
  const emailDisplay = document.getElementById('user-email-display');
  const avatar = document.getElementById('user-avatar-sidebar');

  const configured = Boolean(state.smtpConfig.email && state.smtpConfig.appPassword);

  if (dot && statusText) {
    if (configured) {
      dot.className = 'status-dot connected';
      statusText.textContent = `${state.smtpConfig.provider.toUpperCase()} Ready`;
    } else {
      dot.className = 'status-dot disconnected';
      statusText.textContent = 'Not configured';
    }
  }

  if (configured) {
    if (userDisplay) userDisplay.textContent = state.smtpConfig.email.split('@')[0];
    if (emailDisplay) emailDisplay.textContent = state.smtpConfig.email;
    if (avatar) avatar.textContent = state.smtpConfig.email.charAt(0).toUpperCase();
  }
}

async function testConnection() {
  const email = document.getElementById('smtp-email').value.trim();
  const appPassword = document.getElementById('smtp-password').value.trim();
  const provider = document.querySelector('input[name="provider"]:checked').value;

  if (!email || !appPassword) {
    showToast('Please enter both Email and App Password to test.', 'error');
    return;
  }

  const testBtn = document.getElementById('test-connection-btn');
  const statusBox = document.getElementById('settings-status');

  if (testBtn) {
    testBtn.disabled = true;
    testBtn.textContent = '🔌 Testing...';
  }

  if (statusBox) {
    statusBox.className = 'settings-status';
    statusBox.textContent = 'Testing connection with SMTP server...';
    statusBox.classList.remove('hidden');
  }

  try {
    const res = await fetch(`${API_BASE}/api/test-connection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, email, appPassword })
    });

    const data = await res.json();
    if (data.success) {
      statusBox.className = 'settings-status send-result success';
      statusBox.innerHTML = '<strong>Connection Successful!</strong> Your email credentials are valid and ready to send.';
      showToast('SMTP Connection Verified!', 'success');
    } else {
      statusBox.className = 'settings-status send-result error';
      statusBox.innerHTML = `<strong>Connection Failed:</strong> ${escapeHtml(data.message)}`;
      showToast('Connection failed. Check your App Password.', 'error');
    }
  } catch (err) {
    if (statusBox) {
      statusBox.className = 'settings-status send-result error';
      statusBox.innerHTML = `<strong>Error:</strong> ${escapeHtml(err.message)}. Is server running?`;
    }
    showToast(`Cannot reach server: ${err.message}`, 'error');
  } finally {
    if (testBtn) {
      testBtn.disabled = false;
      testBtn.textContent = '🔌 Test Connection';
    }
  }
}

function saveSettings() {
  const email = document.getElementById('smtp-email').value.trim();
  const appPassword = document.getElementById('smtp-password').value.trim();
  const provider = document.querySelector('input[name="provider"]:checked').value;

  if (!email || !appPassword) {
    showToast('Please fill in both Email and App Password.', 'error');
    return;
  }

  state.smtpConfig = {
    ...state.smtpConfig,
    provider,
    email,
    appPassword
  };

  saveSmtpToStorage();
  updateConnectionStatusUI();
  updateReview();
  showToast('Settings saved successfully!', 'success');
}

function clearAllData() {
  if (!confirm('Are you sure you want to clear all stored credentials, recipients, and history?')) return;
  localStorage.removeItem('mailflow_smtp_config');
  localStorage.removeItem('mailflow_history');
  state.smtpConfig = { provider: 'gmail', email: '', appPassword: '', smtpHost: '', smtpPort: 587, smtpSecure: false };
  state.history = [];
  state.recipients = [];
  state.attachmentFile = null;

  populateSettingsForm();
  renderRecipientsList();
  renderHistory();
  removeAttachment();
  updateReview();
  showToast('All local data cleared.', 'info');
}

// ─── Send History ────────────────────────────────────────
function renderHistory() {
  const container = document.getElementById('history-list');
  if (!container) return;

  if (state.history.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📜</div>
        <p>No email campaigns sent yet.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = state.history.map(item => `
    <div class="campaign-card">
      <div class="campaign-meta">
        <h3>${escapeHtml(item.subject || 'Untitled')}</h3>
        <p>${item.date} &nbsp;•&nbsp; ${item.total} recruiter${item.total === 1 ? '' : 's'}${item.attachment ? ` &nbsp;•&nbsp; 📎 ${escapeHtml(item.attachment)}` : ''}</p>
      </div>
      <div class="campaign-stats">
        <span class="stat-pill success">${item.sent} sent</span>
        ${item.failed > 0 ? `<span class="stat-pill danger">${item.failed} failed</span>` : ''}
      </div>
    </div>
  `).join('');
}

// ─── Toast Notifications ─────────────────────────────────
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icons = {
    success: '✅',
    error: '❌',
    info: 'ℹ️'
  };

  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || 'ℹ️'}</span>
    <span class="toast-message">${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ─── Utility: HTML Escape ────────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
