require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
const XLSX = require('xlsx');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const mongoose = require('mongoose');
const { User, Otp, ComplaintVerification, Complaint, DataRequest, Notification } = require('./models');
const { auth, hashOtp, signUser, verifyPassword } = require('./security');
const { allowedTransitions, categories, subcategories, statuses, validateComplaint, validateProfile } = require('./validation');

const app = express();
app.disable('x-powered-by');
const cleanComplaintText = (value) => String(value || '').replaceAll('`', '').trim();
const port = Number(process.env.PORT || 4000);
const normalizeOrigin = (value) => String(value || '').trim().replace(/\/$/, '');
const publicUrl = normalizeOrigin(process.env.PUBLIC_URL || process.env.CLIENT_URL || 'http://localhost:5173');
const uploadDir = path.resolve(process.env.UPLOAD_DIR || 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const allowedOrigins = new Set([
  publicUrl,
  normalizeOrigin(process.env.CLIENT_URL || 'http://localhost:5173'),
  'https://campuscare-azure.vercel.app'
]);
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    if (process.env.NODE_ENV !== 'production' && /^https:\/\/([a-z0-9-]+\.)?(loca\.lt|vscode\.dev)$/i.test(origin)) return callback(null, true);
    callback(new Error('Origin is not allowed'));
  },
  credentials: true
}));
app.use(express.json({ limit: '1mb' }));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cache-Control', 'no-store');
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
app.use(passport.initialize());

const otpRateLimitHandler = (req, res, _next, options) => {
  const retryAfter = Math.max(1, Math.ceil((req.rateLimit?.resetTime?.getTime?.() - Date.now()) / 1000) || Math.ceil(options.windowMs / 1000));
  res.status(options.statusCode).json({ error: `Too many sign-in attempts. Try again in ${Math.ceil(retryAfter / 60)} minutes.` });
};
const otpKey = (req) => `${req.ip}:${String(req.body?.email || '').trim().toLowerCase()}`;
const requestOtpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, keyGenerator: otpKey, handler: otpRateLimitHandler });
const verifyOtpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: true, keyGenerator: otpKey, handler: otpRateLimitHandler });
const complaintOtpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, keyGenerator: (req) => `${req.ip}:${req.user?.sub || 'anonymous'}` });
const adminLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true });
const cookieSameSite = process.env.COOKIE_SAMESITE || (process.env.NODE_ENV === 'production' ? 'None' : 'Lax');
const cookieOptions = `HttpOnly; Path=/; SameSite=${cookieSameSite}; Max-Age=${2 * 60 * 60}${process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`;
const setSessionCookie = (res, token) => res.setHeader('Set-Cookie', `campuscare_session=${encodeURIComponent(token)}; ${cookieOptions}`);
const clearSessionCookie = () => `campuscare_session=; HttpOnly; Path=/; SameSite=${cookieSameSite}; Max-Age=0${process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`;
const readCookie = (req, name) => Object.fromEntries((req.get('cookie') || '').split(';').map((part) => part.trim().split('=').map(decodeURIComponent)).filter(([key, value]) => key && value))[name];
const oauthCookieOptions = 'HttpOnly; Path=/; SameSite=Lax; Max-Age=600';
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const ok = (ext === '.pdf' && file.mimetype === 'application/pdf') ||
      (['.jpg', '.jpeg'].includes(ext) && ['image/jpeg', 'image/jpg'].includes(file.mimetype));
    cb(ok ? null : new Error('Only PDF and JPEG attachments are allowed'), ok);
  }
});

function transporter() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    if (process.env.NODE_ENV === 'production') return null;
    return nodemailer.createTransport({ jsonTransport: true });
  }
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000
  });
}

async function sendMailWithTimeout(mailer, message) {
  let timer;
  try {
    return await Promise.race([
      mailer.sendMail(message),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error('Email provider did not respond in time');
          error.code = 'ETIMEDOUT';
          reject(error);
        }, 18000);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function createTicketId() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const ticketId = `CMP-${new Date().getFullYear()}-${crypto.randomInt(100000, 1000000)}`;
    if (!(await Complaint.exists({ ticketId }))) return ticketId;
  }
  throw new Error('Could not allocate a unique complaint ID');
}

async function removeAttachment(attachment) {
  if (attachment?.storedName) await fs.promises.unlink(path.join(uploadDir, attachment.storedName)).catch(() => {});
}

async function validateAttachment(file) {
  if (!file) return null;
  const signature = await fs.promises.readFile(file.path);
  const isPdf = file.mimetype === 'application/pdf' && signature.subarray(0, 4).toString() === '%PDF';
  const isJpeg = ['image/jpeg', 'image/jpg'].includes(file.mimetype) && signature.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  if (!isPdf && !isJpeg) {
    await fs.promises.unlink(file.path).catch(() => {});
    throw new Error('Attachment content does not match its declared type');
  }
  return { originalName: file.originalname, storedName: file.filename, mimeType: file.mimetype, size: file.size };
}

async function cleanupComplaintVerifications() {
  const expired = await ComplaintVerification.find({ expiresAt: { $lte: new Date() }, usedAt: { $exists: false } }).select('attachment');
  await Promise.all(expired.map((item) => removeAttachment(item.attachment)));
  if (expired.length) {
    const ids = expired.map((item) => item._id);
    await Promise.all([
      ComplaintVerification.deleteMany({ _id: { $in: ids } }),
      Otp.deleteMany({ purpose: 'complaint', challengeId: { $in: ids } })
    ]);
  }
}

async function sendComplaintOtp(email, challengeId) {
  const mailer = transporter();
  if (!mailer) throw new Error('Email delivery is not configured');
  const code = String(crypto.randomInt(100000, 1000000));
  const otp = await Otp.create({
    email, purpose: 'complaint', challengeId,
    codeHash: hashOtp(`${email}:${challengeId}`, code),
    expiresAt: new Date(Date.now() + 5 * 60 * 1000)
  });
  try {
    await sendMailWithTimeout(mailer, {
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to: email,
      subject: 'Verify your CampusCare complaint',
      text: `Your CampusCare complaint verification code is ${code}. It expires in 5 minutes.`
    });
    if (!process.env.SMTP_HOST) console.info(`[development] Complaint verification code for ${email}: ${code}`);
  } catch (error) {
    await Otp.deleteOne({ _id: otp._id });
    throw error;
  }
  return { otp };
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/meta', (_req, res) => res.json({ categories, subcategories, statuses }));
app.post('/api/auth/logout', (_req, res) => { res.setHeader('Set-Cookie', clearSessionCookie()); res.json({ ok: true }); });
app.get('/api/notifications', auth(), async (req, res, next) => {
  try {
    const notifications = await Notification.find({ user: req.user.sub }).sort({ createdAt: -1 }).limit(30);
    res.json({ notifications, unread: await Notification.countDocuments({ user: req.user.sub, readAt: { $exists: false } }) });
  } catch (error) { next(error); }
});
app.patch('/api/notifications/read', auth(), async (req, res, next) => {
  try {
    await Notification.updateMany({ user: req.user.sub, readAt: { $exists: false } }, { $set: { readAt: new Date() } });
    res.json({ ok: true });
  } catch (error) { next(error); }
});
app.delete('/api/notifications', auth(), async (req, res, next) => {
  try {
    const result = await Notification.deleteMany({ user: req.user.sub });
    res.json({ deleted: result.deletedCount || 0 });
  } catch (error) { next(error); }
});

app.post('/api/auth/request-otp', requestOtpLimiter, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Valid email is required' });
    const deletion = await DataRequest.findOne({ email, type: 'deletion', status: 'pending' }).select('_id');
    if (deletion) return res.status(423).json({ error: 'Account deletion is under progress. You cannot sign in until an administrator completes the request.' });
    const code = String(crypto.randomInt(100000, 1000000));
    await Otp.deleteMany({ email, purpose: 'login', usedAt: { $exists: false } });
    const otp = await Otp.create({ email, purpose: 'login', codeHash: hashOtp(email, code), expiresAt: new Date(Date.now() + 5 * 60 * 1000) });
    const mailer = transporter();
    if (!mailer) {
      await Otp.deleteOne({ _id: otp._id });
      return res.status(503).json({ error: 'Email delivery is not configured' });
    }
    try {
      await sendMailWithTimeout(mailer, { from: process.env.MAIL_FROM || process.env.SMTP_USER, to: email, subject: 'Your complaint portal sign-in code', text: `Your code is ${code}. It expires in 10 minutes.` });
    } catch (mailError) {
      await Otp.deleteOne({ _id: otp._id });
      console.error('Login OTP email delivery failed:', mailError.message);
      return res.status(503).json({ error: 'The email provider rejected the sign-in email. Check SMTP credentials and provider security settings.' });
    }
    res.json({ message: 'OTP sent' });
  } catch (error) { next(error); }
});

app.post('/api/auth/verify-otp', verifyOtpLimiter, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const code = String(req.body.code || '').trim();
    const otp = await Otp.findOne({ email, purpose: 'login', usedAt: { $exists: false }, expiresAt: { $gt: new Date() }, failedAttempts: { $lt: 5 } }).sort({ createdAt: -1 });
    const submittedHash = hashOtp(email, code);
    if (!otp || !/^\d{6}$/.test(code) || !crypto.timingSafeEqual(Buffer.from(otp.codeHash), Buffer.from(submittedHash))) {
      if (otp) { otp.failedAttempts += 1; await otp.save(); }
      return res.status(401).json({ error: 'Invalid or expired OTP' });
    }
    otp.usedAt = new Date();
    await otp.save();
    const deletion = await DataRequest.findOne({ email, type: 'deletion', status: 'pending' }).select('_id');
    if (deletion) return res.status(423).json({ error: 'Account deletion is under progress. You cannot sign in until an administrator completes the request.' });
    const user = await User.findOneAndUpdate({ email }, { $setOnInsert: { email, name: email.split('@')[0] } }, { new: true, upsert: true });
    const token = signUser(user); setSessionCookie(res, token);
    res.json({ token, user: { id: user._id, email: user.email, name: user.name, role: user.role, profile: user.profile } });
  } catch (error) { next(error); }
});

const googleConfigured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

if (googleConfigured) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || `${publicUrl}/api/auth/google/callback`
  }, async (_accessToken, _refreshToken, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value?.toLowerCase();
      if (!email) return done(new Error('Google account has no email'));
      const user = await User.findOneAndUpdate({ email }, { $set: { googleId: profile.id, name: profile.displayName } }, { new: true, upsert: true });
      done(null, user);
    } catch (error) { done(error); }
  }));
}

app.get('/api/auth/google', (req, res, next) => {
  if (!googleConfigured) return res.status(503).json({ error: 'Google OAuth is not configured' });
  const state = crypto.randomBytes(32).toString('hex');
  res.setHeader('Set-Cookie', [
    clearSessionCookie(),
    `campuscare_oauth_${state}=${state}; ${oauthCookieOptions}`
  ]);
  passport.authenticate('google', { scope: ['openid', 'email', 'profile'], session: false, state })(req, res, next);
});

app.get('/api/auth/google/callback', (req, res, next) => {
  if (!googleConfigured) return res.status(503).json({ error: 'Google OAuth is not configured' });
  const state = String(req.query.state || '');
  if (!/^[a-f0-9]{64}$/.test(state) || readCookie(req, `campuscare_oauth_${state}`) !== state) {
    return res.status(400).json({ error: 'OAuth session expired. Start Google sign-in again.' });
  }
  passport.authenticate('google', { session: false }, (error, user) => {
    if (error || !user) {
      console.error('Google OAuth callback failed:', error?.message || 'No user returned');
      return res.redirect(`${publicUrl}/login?error=google`);
    }
    const token = signUser(user);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Set-Cookie', [
      `campuscare_session=${encodeURIComponent(token)}; ${cookieOptions}`,
      `campuscare_oauth_${state}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`
    ]);
    return res.redirect(`${publicUrl}/auth/callback`);
  })(req, res, next);
});

app.get('/api/me', auth(), async (req, res, next) => {
  try {
    const user = await User.findById(req.user.sub).select('email name role profile createdAt updatedAt') ||
      await User.findOneAndUpdate(
        { email: req.user.email },
        { $setOnInsert: { email: req.user.email, name: req.user.email?.split('@')[0] || 'Student' } },
        { new: true, upsert: true }
      ).select('email name role profile createdAt updatedAt');
    if (!user) return res.status(401).json({ error: 'Account could not be loaded' });
    res.json({ user });
  } catch (error) { next(error); }
});

app.put('/api/profile', auth(['student']), async (req, res, next) => {
  try {
    const allowed = ['studentUid', 'fatherGuardianName', 'course', 'semester', 'section', 'mobileNumber'];
    const profile = Object.fromEntries(allowed.map((key) => [key, String(req.body[key] || '').trim()]));
    const profileError = validateProfile({ ...profile, name: req.body.name });
    if (profileError) return res.status(400).json({ error: profileError });
    const user = await User.findByIdAndUpdate(req.user.sub, { $set: { profile, name: profile.studentUid ? String(req.body.name || '').trim() : undefined } }, { new: true, runValidators: true });
    res.json({ user });
  } catch (error) { next(error); }
});

app.post('/api/account/deletion', auth(['student']), async (req, res, next) => {
  try {
    const user = await User.findById(req.user.sub).select('email');
    if (!user) return res.status(404).json({ error: 'Account not found' });
    const pending = await DataRequest.findOne({ email: user.email, type: 'deletion', status: 'pending' });
    if (pending) return res.status(409).json({ error: 'A data request is already under review' });
    const request = await DataRequest.create({ user: user._id, email: user.email, type: 'deletion', details: 'Student requested account deletion.' });
    try {
      const admins = await User.find({ role: 'admin' }).select('_id');
      if (admins.length) await Notification.insertMany(admins.map((admin) => ({
        user: admin._id, type: 'account', title: 'Account deletion requested',
        message: `${user.email} requested account deletion.`, link: '/admin'
      })));
    } catch (notificationError) {
      console.warn('Deletion notification could not be created', notificationError.message);
    }
    res.setHeader('Set-Cookie', clearSessionCookie());
    res.status(201).json({ request: { id: request._id, type: request.type, status: request.status, createdAt: request.createdAt } });
  } catch (error) { next(error); }
});

app.get('/api/account/deletion', auth(['student']), async (req, res, next) => {
  try {
    const user = await User.findById(req.user.sub).select('email');
    const request = user && await DataRequest.findOne({ email: user.email, type: 'deletion' }).sort({ createdAt: -1 }).select('status createdAt reviewedAt reviewNote');
    res.json({ request });
  } catch (error) { next(error); }
});

app.post('/api/complaints', auth(['student']), (_req, res) => {
  res.status(403).json({ error: 'Complaint email verification is required before submission' });
});

app.post('/api/complaints/verification', auth(['student']), complaintOtpLimiter, upload.single('attachment'), async (req, res, next) => {
  try {
    await cleanupComplaintVerifications();
    const error = validateComplaint(req.body);
    if (error) { await removeAttachment({ storedName: req.file?.filename }); return res.status(400).json({ error }); }
    const user = await User.findById(req.user.sub).select('email');
    if (!user?.email) { await removeAttachment({ storedName: req.file?.filename }); return res.status(401).json({ error: 'Verified student email is unavailable' }); }
    const profile = await User.findById(req.user.sub).select('profile');
    if (!profile?.profile?.studentUid) { await removeAttachment({ storedName: req.file?.filename }); return res.status(403).json({ error: 'Complete your student profile before submitting a complaint' }); }
    let attachment;
    try {
      attachment = await validateAttachment(req.file);
    } catch (attachmentError) {
      return res.status(400).json({ error: attachmentError.message });
    }
    const previous = await ComplaintVerification.find({ student: req.user.sub, usedAt: { $exists: false } }).select('attachment');
    await Promise.all(previous.map((item) => removeAttachment(item.attachment)));
    await Otp.deleteMany({ purpose: 'complaint', challengeId: { $in: previous.map((item) => item._id) } });
    await ComplaintVerification.deleteMany({ student: req.user.sub, usedAt: { $exists: false } });
    const challenge = await ComplaintVerification.create({
      student: req.user.sub, email: user.email, category: req.body.category, subcategory: req.body.subcategory,
      title: cleanComplaintText(req.body.title), description: cleanComplaintText(req.body.description),
      attachment, expiresAt: new Date(Date.now() + 5 * 60 * 1000), lastSentAt: new Date()
    });
    let delivery;
    try {
      delivery = await sendComplaintOtp(user.email, challenge._id);
    } catch (mailError) {
      await removeAttachment(attachment);
      await ComplaintVerification.deleteOne({ _id: challenge._id });
      throw mailError;
    }
    res.status(201).json({ challengeId: challenge._id, email: user.email, expiresAt: challenge.expiresAt, resendAvailableAt: new Date(Date.now() + 60 * 1000) });
  } catch (error) { next(error); }
});

app.post('/api/complaints/verification/:id/resend', auth(['student']), complaintOtpLimiter, async (req, res, next) => {
  try {
    const challenge = await ComplaintVerification.findOne({ _id: req.params.id, student: req.user.sub, usedAt: { $exists: false }, expiresAt: { $gt: new Date() } });
    if (!challenge) return res.status(404).json({ error: 'Complaint verification has expired. Start again.' });
    if (challenge.lastSentAt > new Date(Date.now() - 60 * 1000)) return res.status(429).json({ error: 'Please wait 60 seconds before requesting another code' });
    await Otp.deleteMany({ purpose: 'complaint', challengeId: challenge._id, usedAt: { $exists: false } });
    const delivery = await sendComplaintOtp(challenge.email, challenge._id);
    challenge.lastSentAt = new Date();
    challenge.failedAttempts = 0;
    await challenge.save();
    res.json({ message: 'OTP sent', expiresAt: challenge.expiresAt, resendAvailableAt: new Date(Date.now() + 60 * 1000) });
  } catch (error) { next(error); }
});

app.post('/api/complaints/verification/:id/verify', auth(['student']), complaintOtpLimiter, async (req, res, next) => {
  let challenge;
  try {
    const code = String(req.body.code || '').trim();
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Enter the six-digit verification code' });
    challenge = await ComplaintVerification.findOneAndUpdate(
      { _id: req.params.id, student: req.user.sub, usedAt: { $exists: false }, processingAt: { $exists: false }, expiresAt: { $gt: new Date() }, failedAttempts: { $lt: 5 } },
      { $set: { processingAt: new Date() } }, { new: true }
    );
    if (!challenge) return res.status(400).json({ error: 'Verification is invalid, expired, or already used' });
    const otp = await Otp.findOne({ email: challenge.email, purpose: 'complaint', challengeId: challenge._id, usedAt: { $exists: false }, expiresAt: { $gt: new Date() }, failedAttempts: { $lt: 5 } }).sort({ createdAt: -1 });
    const submittedHash = hashOtp(`${challenge.email}:${challenge._id}`, code);
    if (!otp || !crypto.timingSafeEqual(Buffer.from(otp.codeHash), Buffer.from(submittedHash))) {
      challenge.processingAt = undefined;
      challenge.failedAttempts += 1;
      await challenge.save();
      if (otp) { otp.failedAttempts += 1; await otp.save(); }
      return res.status(401).json({ error: 'Invalid or expired verification code' });
    }
    const ticketId = await createTicketId();
    const complaint = await Complaint.create({
      ticketId, student: req.user.sub, category: challenge.category, subcategory: challenge.subcategory,
      title: challenge.title, description: challenge.description, attachment: challenge.attachment,
      history: [{ status: 'Submitted', note: 'Complaint submitted', actor: req.user.sub }]
    });
    otp.usedAt = new Date();
    await otp.save();
    challenge.usedAt = new Date();
    challenge.processingAt = undefined;
    await challenge.save();
    await ComplaintVerification.deleteOne({ _id: challenge._id });
    try {
      await Notification.create({
        user: req.user.sub, type: 'complaint', title: 'Complaint submitted',
        message: `Complaint ${ticketId} was submitted successfully.`, link: `/complaints/${complaint._id}`
      });
      const admins = await User.find({ role: 'admin' }).select('_id');
      if (admins.length) await Notification.insertMany(admins.map((admin) => ({
        user: admin._id, type: 'complaint', title: 'New complaint received',
        message: `${ticketId} needs review.`, link: `/complaints/${complaint._id}`
      })));
    } catch (notificationError) {
      console.warn('Complaint notifications could not be created', notificationError.message);
    }
    res.status(201).json({ complaint });
  } catch (error) {
    if (challenge && !challenge.usedAt) {
      challenge.processingAt = undefined;
      await challenge.save().catch(() => {});
    }
    console.error('Complaint verification failed', error);
    if (error.name === 'ValidationError') {
      const fields = Object.keys(error.errors || {});
      const details = fields.length ? ` Check: ${fields.join(', ')}.` : '';
      return res.status(400).json({ error: `Complaint data could not be saved.${details}` });
    }
    res.status(500).json({ error: 'Complaint submission failed. Please try again.' });
  }
});

app.get('/api/complaints', auth(), async (req, res, next) => {
  try {
    const filter = req.user.role === 'admin' ? {} : { student: req.user.sub };
    if (req.query.status && statuses.includes(req.query.status)) filter.status = req.query.status;
    if (req.query.category && categories.includes(req.query.category)) filter.category = req.query.category;
    if (req.query.search) {
      const search = new RegExp(String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ ticketId: search }, { title: search }];
    }
    if (req.query.ticketId) filter.ticketId = new RegExp(String(req.query.ticketId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    if (req.query.title) filter.title = new RegExp(String(req.query.title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    if (req.query.from || req.query.to) filter.createdAt = {};
    if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
    if (req.query.to) filter.createdAt.$lt = new Date(`${req.query.to}T23:59:59.999Z`);
    const complaints = await Complaint.find(filter).populate('student', 'email name profile').sort({ createdAt: -1 });
    res.json({ complaints });
  } catch (error) { next(error); }
});

app.get('/api/complaints/:id', auth(), async (req, res, next) => {
  try {
    const complaint = await Complaint.findById(req.params.id).populate('student', 'email name profile').populate('messages.author', 'email name');
    if (!complaint || (req.user.role !== 'admin' && complaint.student._id.toString() !== req.user.sub)) return res.status(404).json({ error: 'Complaint not found' });
    if (req.user.role !== 'admin') complaint.messages = complaint.messages.filter((message) => !message.internal);
    res.json({ complaint });
  } catch (error) { next(error); }
});

app.post('/api/complaints/:id/messages', auth(), async (req, res, next) => {
  try {
    const complaint = await Complaint.findById(req.params.id);
    if (!complaint || (req.user.role !== 'admin' && complaint.student.toString() !== req.user.sub)) return res.status(404).json({ error: 'Complaint not found' });
    if (!String(req.body.body || '').trim()) return res.status(400).json({ error: 'Message is required' });
    complaint.messages.push({ author: req.user.sub, body: cleanComplaintText(req.body.body), internal: req.user.role === 'admin' && Boolean(req.body.internal) });
    await complaint.save();
    res.status(201).json({ complaint });
  } catch (error) { next(error); }
});

app.patch('/api/complaints/:id/status', auth(['admin']), async (req, res, next) => {
  try {
    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) return res.status(404).json({ error: 'Complaint not found' });
    if (!statuses.includes(req.body.status) || !allowedTransitions[complaint.status].includes(req.body.status)) return res.status(400).json({ error: `Invalid transition from ${complaint.status}` });
    complaint.status = req.body.status;
    complaint.history.push({ status: req.body.status, note: String(req.body.note || ''), actor: req.user.sub });
    await complaint.save();
    await Notification.create({
      user: complaint.student, type: 'complaint', title: 'Complaint status updated',
      message: `${complaint.ticketId} is now ${complaint.status}.`, link: `/complaints/${complaint._id}`
    });
    res.json({ complaint });
  } catch (error) { next(error); }
});

app.get('/api/complaints/:id/attachment', auth(), async (req, res, next) => {
  try {
    const complaint = await Complaint.findById(req.params.id);
    if (!complaint || !complaint.attachment?.storedName || (req.user.role !== 'admin' && complaint.student.toString() !== req.user.sub)) return res.status(404).json({ error: 'Attachment not found' });
    res.download(path.join(uploadDir, complaint.attachment.storedName), complaint.attachment.originalName);
  } catch (error) { next(error); }
});

app.post('/api/auth/admin', adminLimiter, async (req, res) => {
  const email = String(req.body.email || '').toLowerCase();
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD_HASH || email !== process.env.ADMIN_EMAIL.toLowerCase() || !(await verifyPassword(String(req.body.password || ''), process.env.ADMIN_PASSWORD_HASH))) return res.status(401).json({ error: 'Invalid admin credentials' });
  const user = await User.findOneAndUpdate({ email }, { $set: { email, role: 'admin', name: 'Administrator' } }, { upsert: true, new: true });
  const token = signUser(user); setSessionCookie(res, token);
  res.json({ token, user: { id: user._id, email: user.email, role: user.role, name: user.name } });
});

app.get('/api/admin/data-requests', auth(['admin']), async (_req, res, next) => {
  try { res.json({ requests: await DataRequest.find({ type: 'deletion' }).populate('user', 'email name profile').sort({ createdAt: -1 }) }); } catch (error) { next(error); }
});
app.get('/api/admin/users', auth(['admin']), async (_req, res, next) => {
  try {
    const users = await User.find({ role: 'student' }).select('email name profile createdAt updatedAt').sort({ name: 1, email: 1 });
    res.json({ users });
  } catch (error) { next(error); }
});
app.get('/api/admin/users/:id', auth(['admin']), async (req, res, next) => {
  try {
    const user = await User.findOne({ _id: req.params.id, role: 'student' }).select('email name profile createdAt updatedAt');
    if (!user) return res.status(404).json({ error: 'Student profile not found' });
    const complaints = await Complaint.find({ student: user._id }).select('ticketId title category status createdAt').sort({ createdAt: -1 });
    const deletion = await DataRequest.findOne({ user: user._id, type: 'deletion' }).sort({ createdAt: -1 }).select('status createdAt reviewedAt reviewNote');
    res.json({ user, complaints, deletion });
  } catch (error) { next(error); }
});

app.patch('/api/admin/data-requests/:id', auth(['admin']), async (req, res, next) => {
  try {
    const status = String(req.body.status || '');
    if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Invalid review status' });
    const request = await DataRequest.findById(req.params.id);
    if (!request || request.status !== 'pending') return res.status(404).json({ error: 'Data request not found' });
    request.status = status; request.reviewNote = cleanComplaintText(req.body.reviewNote); request.reviewedBy = req.user.sub; request.reviewedAt = new Date();
    await request.save();
    if (status === 'approved' && request.type === 'deletion') {
      await User.findByIdAndDelete(request.user);
    }
    res.json({ request: { id: request._id, type: request.type, status: request.status, reviewNote: request.reviewNote } });
  } catch (error) { next(error); }
});

app.get('/api/admin/summary', auth(['admin']), async (_req, res, next) => {
  try {
    const groups = await Complaint.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
    res.json({ counts: Object.fromEntries(statuses.map((status) => [status, groups.find((group) => group._id === status)?.count || 0])) });
  } catch (error) { next(error); }
});

app.get('/api/admin/export.csv', auth(['admin']), async (_req, res, next) => {
  try {
    const complaints = await Complaint.find().populate('student', 'email name').sort({ createdAt: -1 });
    const escape = (value) => {
      const text = String(value ?? '');
      const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
      return `"${safe.replaceAll('"', '""')}"`;
    };
    const rows = [['Ticket ID', 'Student', 'Email', 'Category', 'Title', 'Status', 'Created At'], ...complaints.map((item) => [item.ticketId, item.student?.name, item.student?.email, item.category, item.title, item.status, item.createdAt.toISOString()])];
    res.type('text/csv').send(rows.map((row) => row.map(escape).join(',')).join('\n'));
  } catch (error) { next(error); }
});

app.get('/api/admin/export.xlsx', auth(['admin']), async (_req, res, next) => {
  try {
    const complaints = await Complaint.find().populate('student', 'email name').sort({ createdAt: -1 });
    const rows = complaints.map((item) => ({
      'Ticket ID': item.ticketId, Student: item.student?.name || '', Email: item.student?.email || '',
      Category: item.category, Title: item.title, Status: item.status, 'Created At': item.createdAt.toISOString()
    }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Complaints');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment('complaints.xlsx').send(buffer);
  } catch (error) { next(error); }
});

app.get('/api/complaints/:id/export.pdf', auth(), async (req, res, next) => {
  try {
    const complaint = await Complaint.findById(req.params.id).populate('student', 'email name profile');
    if (!complaint || (req.user.role !== 'admin' && complaint.student._id.toString() !== req.user.sub)) return res.status(404).json({ error: 'Complaint not found' });
    const document = new PDFDocument({ margin: 50 });
    res.type('application/pdf').attachment(`${complaint.ticketId}.pdf`);
    document.pipe(res);
    document.fontSize(20).text('CampusCare Complaint Report');
    document.moveDown().fontSize(11).text(`Ticket: ${complaint.ticketId}`);
    document.text(`Status: ${complaint.status}`);
    document.text(`Student: ${complaint.student.name || complaint.student.email}`);
    document.text(`Category: ${complaint.category} / ${complaint.subcategory}`);
    document.moveDown().fontSize(14).text(complaint.title);
    document.moveDown().fontSize(11).text(complaint.description);
    document.moveDown().fontSize(14).text('Status history');
    complaint.history.forEach((entry) => document.fontSize(10).text(`${entry.status} — ${new Date(entry.createdAt).toLocaleString()}${entry.note ? ` — ${entry.note}` : ''}`));
    document.end();
  } catch (error) { next(error); }
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError || error.message?.includes('attachments')) return res.status(400).json({ error: error.message });
  console.error(error);
  res.status(500).json({ error: 'Unexpected server error' });
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found' }));

if (require.main === module) {
  mongoose.connect(process.env.MONGODB_URI).then(() => app.listen(port, () => console.log(`API listening on ${port}`))).catch((error) => { console.error('MongoDB connection failed', error.message); process.exitCode = 1; });
}

module.exports = { app };
