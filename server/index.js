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
const { auth, hashOtp, signUser, verifyPassword, hashPassword } = require('./security');
const { allowedTransitions, categories, subcategories, statuses, validateComplaint, validateProfile } = require('./validation');

const app = express();
app.disable('x-powered-by');
const cleanComplaintText = (value) => String(value || '').replaceAll('`', '').trim();
const port = Number(process.env.PORT || 4000);
const normalizeOrigin = (value) => String(value || '').trim().replace(/\/$/, '');
const publicUrl = normalizeOrigin(process.env.PUBLIC_URL || process.env.CLIENT_URL || 'http://localhost:5173');
const uploadDir = path.resolve(process.env.UPLOAD_DIR || (process.env.VERCEL ? '/tmp/uploads' : 'uploads'));
fs.mkdirSync(uploadDir, { recursive: true });
const allowedOrigins = new Set([
  publicUrl,
  normalizeOrigin(process.env.CLIENT_URL || 'http://localhost:5173'),
  'https://campuscare-azure.vercel.app'
]);
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return callback(null, true);
    if (/^https:\/\/.*\.vercel\.app$/.test(origin)) return callback(null, true);
    if (process.env.NODE_ENV !== 'production') return callback(null, true);
    callback(new Error('Origin is not allowed'));
  },
  credentials: true
}));
app.use(express.json({ limit: '1mb' }));

let dbConnectionPromise = null;
async function ensureDbConnected() {
  if (mongoose.connection.readyState === 1) return;
  if (!dbConnectionPromise) {
    dbConnectionPromise = connectDatabase().catch((err) => {
      dbConnectionPromise = null;
      throw err;
    });
  }
  return dbConnectionPromise;
}

app.use(async (_req, _res, next) => {
  try {
    await ensureDbConnected();
    next();
  } catch (err) {
    next(err);
  }
});
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

const isDev = process.env.NODE_ENV !== 'production';
const otpRateLimitHandler = (req, res, _next, options) => {
  const retryAfter = Math.max(1, Math.ceil((req.rateLimit?.resetTime?.getTime?.() - Date.now()) / 1000) || Math.ceil(options.windowMs / 1000));
  res.status(options.statusCode).json({ error: `Too many sign-in attempts. Try again in ${Math.ceil(retryAfter / 60)} minutes.` });
};
const otpKey = (req) => `${req.ip}:${String(req.body?.email || '').trim().toLowerCase()}`;
const requestOtpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: isDev ? 100 : 8, standardHeaders: true, keyGenerator: otpKey, handler: otpRateLimitHandler });
const verifyOtpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: isDev ? 100 : 15, standardHeaders: true, keyGenerator: otpKey, handler: otpRateLimitHandler });
const complaintOtpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: isDev ? 100 : 20, standardHeaders: true, keyGenerator: (req) => `${req.ip}:${req.user?.sub || 'anonymous'}` });
const adminLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: isDev ? 100 : 10, standardHeaders: true });
const passwordAuthLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: isDev ? 100 : 12, standardHeaders: true });
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
  const cleanPass = String(process.env.SMTP_PASS || '').replace(/\s+/g, '');
  const isGmail = (process.env.SMTP_HOST || '').includes('gmail') || (process.env.SMTP_USER || '').includes('gmail');
  if (isGmail) {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.SMTP_USER, pass: cleanPass },
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 10000
    });
  }
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: cleanPass },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10000
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
        }, 10000);
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

async function cleanupDueDeletions() {
  try {
    const now = new Date();
    const dueUsers = await User.find({
      'deletion.inProgress': true,
      'deletion.scheduledAt': { $lte: now }
    }).select('_id email');
    if (!dueUsers.length) return;
    const userIds = dueUsers.map((u) => u._id);
    const emails = dueUsers.map((u) => u.email);

    await Promise.all([
      Otp.deleteMany({ email: { $in: emails } }),
      Notification.deleteMany({ user: { $in: userIds } }),
      ComplaintVerification.deleteMany({ student: { $in: userIds } }),
      DataRequest.deleteMany({ email: { $in: emails } }),
      User.deleteMany({ _id: { $in: userIds } })
    ]);
    console.info(`[CampusCare] Automatically purged ${userIds.length} account(s) that reached 7-day deletion maturity.`);
  } catch (err) {
    console.warn('[CampusCare] Error in cleanupDueDeletions:', err.message);
  }
}

async function sendComplaintOtp(email, challengeId) {
  const mailer = transporter();
  const code = String(crypto.randomInt(100000, 1000000));
  const otp = await Otp.create({
    email, purpose: 'complaint', challengeId,
    codeHash: hashOtp(`${email}:${challengeId}`, code),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000)
  });
  let mailDelivered = false;
  if (mailer) {
    try {
      await sendMailWithTimeout(mailer, {
        from: process.env.MAIL_FROM || process.env.SMTP_USER,
        to: email,
        subject: 'Verify your CampusCare complaint',
        text: `Your CampusCare complaint verification code is ${code}. It expires in 10 minutes.`
      });
      mailDelivered = true;
    } catch (error) {
      console.warn(`[CampusCare] Complaint verification email delivery to ${email} failed: ${error.message}`);
      if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_DEV_FALLBACK) {
        await Otp.deleteOne({ _id: otp._id });
        throw error;
      }
    }
  } else if (process.env.NODE_ENV === 'production') {
    await Otp.deleteOne({ _id: otp._id });
    throw new Error('Email delivery is not configured');
  }
  console.info(`[CampusCare OTP] Complaint verification code for ${email}: ${code} (delivered: ${mailDelivered ? 'via SMTP' : 'via console/fallback'})`);
  return { otp, code, delivered: mailDelivered };
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

const passwordRequirements = (password) => typeof password === 'string'
  && password.length >= 8
  && password.length <= 128
  && /[a-z]/.test(password)
  && /[A-Z]/.test(password)
  && /\d/.test(password);

app.post('/api/auth/register', passwordAuthLimiter, async (req, res, next) => {
  try {
    await cleanupDueDeletions();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const name = String(req.body.name || '').trim().slice(0, 100);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Valid email is required' });
    if (!passwordRequirements(password)) return res.status(400).json({ error: 'Password must be 8-128 characters and include uppercase, lowercase, and a number' });
    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ error: existing.passwordHash ? 'An account with this email already exists' : 'This account was created with Google or OTP. Use that sign-in method or ask an administrator to set a password.' });
    const user = await User.create({ email, name: name || email.split('@')[0], passwordHash: await hashPassword(password) });
    const token = signUser(user);
    setSessionCookie(res, token);
    res.status(201).json({ token, user: { id: user._id, email: user.email, name: user.name, role: user.role, profile: user.profile, deletion: user.deletion } });
  } catch (error) { next(error); }
});

app.post('/api/auth/password', passwordAuthLimiter, async (req, res, next) => {
  try {
    await cleanupDueDeletions();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const isConfiguredAdmin = Boolean(process.env.ADMIN_EMAIL && email === process.env.ADMIN_EMAIL.trim().toLowerCase());
    let user;
    if (isConfiguredAdmin) {
      if (!process.env.ADMIN_PASSWORD_HASH || !(await verifyPassword(password, process.env.ADMIN_PASSWORD_HASH))) return res.status(401).json({ error: 'Invalid email or password' });
      user = await User.findOneAndUpdate(
        { email },
        { $set: { email, role: 'admin', name: 'Administrator' } },
        { upsert: true, new: true }
      );
    } else {
      user = await User.findOne({ email });
      if (!user || !user.passwordHash || !(await verifyPassword(password, user.passwordHash))) return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (user.deletion?.inProgress) return res.status(403).json({ error: 'Sign-in is unavailable while your deletion request is being reviewed' });
    const token = signUser(user);
    setSessionCookie(res, token);
    res.json({ token, user: { id: user._id, email: user.email, name: user.name, role: user.role, profile: user.profile, deletion: user.deletion } });
  } catch (error) { next(error); }
});

app.post('/api/auth/request-otp', requestOtpLimiter, async (req, res, next) => {
  try {
    await cleanupDueDeletions();
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Valid email is required' });
    const code = String(crypto.randomInt(100000, 1000000));
    await Otp.deleteMany({ email, purpose: 'login', usedAt: { $exists: false } });
    const otp = await Otp.create({ email, purpose: 'login', codeHash: hashOtp(email, code), expiresAt: new Date(Date.now() + 10 * 60 * 1000) });
    const mailer = transporter();
    let mailDelivered = false;
    if (mailer) {
      try {
        await sendMailWithTimeout(mailer, {
          from: process.env.MAIL_FROM || process.env.SMTP_USER,
          to: email,
          subject: 'Your complaint portal sign-in code',
          text: `Your code is ${code}. It expires in 10 minutes.`
        });
        mailDelivered = true;
      } catch (mailError) {
        console.warn(`[CampusCare] Login OTP email delivery to ${email} failed: ${mailError.message}`);
        if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_DEV_FALLBACK) {
          await Otp.deleteOne({ _id: otp._id });
          const message = mailError.code === 'ETIMEDOUT'
            ? 'The email provider did not respond. Check SMTP host, port, and network settings.'
            : 'The email provider rejected the sign-in email. Check SMTP credentials and provider security settings.';
          return res.status(503).json({ error: message });
        }
      }
    } else if (process.env.NODE_ENV === 'production') {
      await Otp.deleteOne({ _id: otp._id });
      return res.status(503).json({ error: 'Email delivery is not configured' });
    }
    console.info(`[CampusCare OTP] Sign-in code for ${email}: ${code} (delivered: ${mailDelivered ? 'via SMTP' : 'via console/fallback'})`);
    res.json({
      message: 'OTP sent',
      devCode: isDev ? code : undefined
    });
  } catch (error) { next(error); }
});

app.post('/api/auth/verify-otp', verifyOtpLimiter, async (req, res, next) => {
  try {
    await cleanupDueDeletions();
    const email = String(req.body.email || '').trim().toLowerCase();
    const code = String(req.body.code || '').trim();
    const otp = await Otp.findOne({ email, purpose: 'login', usedAt: { $exists: false }, expiresAt: { $gt: new Date() }, failedAttempts: { $lt: 5 } }).sort({ createdAt: -1 });
    const submittedHash = hashOtp(email, code);
    const hashBuf = Buffer.from(otp ? otp.codeHash : '', 'hex');
    const subBuf = Buffer.from(submittedHash, 'hex');
    const valid = otp && /^\d{6}$/.test(code) && hashBuf.length === subBuf.length && hashBuf.length > 0 && crypto.timingSafeEqual(hashBuf, subBuf);
    if (!valid) {
      if (otp) { otp.failedAttempts += 1; await otp.save(); }
      return res.status(401).json({ error: 'Invalid or expired OTP' });
    }
    otp.usedAt = new Date();
    await otp.save();
    const user = await User.findOneAndUpdate({ email }, { $setOnInsert: { email, name: email.split('@')[0] } }, { new: true, upsert: true });
    const token = signUser(user); setSessionCookie(res, token);
    res.json({ token, user: { id: user._id, email: user.email, name: user.name, role: user.role, profile: user.profile, deletion: user.deletion } });
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
    return res.redirect(`${publicUrl}/auth/callback?token=${encodeURIComponent(token)}`);
  })(req, res, next);
});

app.get('/api/me', auth(), async (req, res, next) => {
  try {
    await cleanupDueDeletions();
    const user = await User.findById(req.user.sub).select('email name role profile deletion createdAt updatedAt') ||
      await User.findOneAndUpdate(
        { email: req.user.email },
        { $setOnInsert: { email: req.user.email, name: req.user.email?.split('@')[0] || 'Student' } },
        { new: true, upsert: true }
      ).select('email name role profile deletion createdAt updatedAt');
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
    const user = await User.findById(req.user.sub);
    if (!user) return res.status(404).json({ error: 'Account not found' });
    const startedAt = new Date();
    const scheduledAt = new Date(startedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
    user.deletion = {
      inProgress: true,
      startedAt,
      scheduledAt
    };
    await user.save();

    await DataRequest.findOneAndUpdate(
      { email: user.email, type: 'deletion' },
      { $set: { user: user._id, email: user.email, type: 'deletion', status: 'in_progress', details: 'Student scheduled deletion with 7-day grace period.' } },
      { upsert: true, new: true }
    );

    res.json({
      ok: true,
      message: 'Deletion under progress for 7 days. You can cancel at any time.',
      deletion: {
        inProgress: true,
        startedAt,
        scheduledAt,
        daysRemaining: 7
      }
    });
  } catch (error) { next(error); }
});

app.post('/api/account/deletion/cancel', auth(['student']), async (req, res, next) => {
  try {
    const user = await User.findById(req.user.sub);
    if (!user) return res.status(404).json({ error: 'Account not found' });
    user.deletion = {
      inProgress: false,
      startedAt: null,
      scheduledAt: null
    };
    await user.save();

    await DataRequest.updateMany(
      { email: user.email, type: 'deletion', status: { $in: ['pending', 'in_progress'] } },
      { $set: { status: 'cancelled', reviewNote: 'Cancelled by student' } }
    );

    res.json({
      ok: true,
      message: 'Account deletion stopped. Your account remains active.',
      deletion: { inProgress: false }
    });
  } catch (error) { next(error); }
});

app.delete('/api/account/deletion', auth(['student']), async (req, res, next) => {
  try {
    const user = await User.findById(req.user.sub);
    if (!user) return res.status(404).json({ error: 'Account not found' });
    user.deletion = {
      inProgress: false,
      startedAt: null,
      scheduledAt: null
    };
    await user.save();
    await DataRequest.updateMany(
      { email: user.email, type: 'deletion', status: { $in: ['pending', 'in_progress'] } },
      { $set: { status: 'cancelled', reviewNote: 'Cancelled by student' } }
    );
    res.json({
      ok: true,
      message: 'Account deletion stopped. Your account remains active.',
      deletion: { inProgress: false }
    });
  } catch (error) { next(error); }
});

app.get('/api/account/deletion', auth(['student']), async (req, res, next) => {
  try {
    await cleanupDueDeletions();
    const user = await User.findById(req.user.sub).select('deletion');
    if (!user || !user.deletion?.inProgress) {
      return res.json({ deletion: { inProgress: false } });
    }
    const now = Date.now();
    const scheduledTime = new Date(user.deletion.scheduledAt).getTime();
    const msRemaining = Math.max(0, scheduledTime - now);
    const daysRemaining = Math.max(1, Math.ceil(msRemaining / (24 * 60 * 60 * 1000)));
    res.json({
      deletion: {
        inProgress: true,
        startedAt: user.deletion.startedAt,
        scheduledAt: user.deletion.scheduledAt,
        daysRemaining
      }
    });
  } catch (error) { next(error); }
});

app.post('/api/complaints', auth(['student']), upload.single('attachment'), async (req, res, next) => {
  try {
    const error = validateComplaint(req.body);
    if (error) { await removeAttachment({ storedName: req.file?.filename }); return res.status(400).json({ error }); }
    const user = await User.findById(req.user.sub).select('email profile');
    if (!user?.email) { await removeAttachment({ storedName: req.file?.filename }); return res.status(401).json({ error: 'Student email is unavailable' }); }
    if (!user.profile?.studentUid) { await removeAttachment({ storedName: req.file?.filename }); return res.status(403).json({ error: 'Complete your student profile before submitting a complaint' }); }
    let attachment;
    try {
      attachment = await validateAttachment(req.file);
    } catch (attachmentError) {
      return res.status(400).json({ error: attachmentError.message });
    }
    const ticketId = await createTicketId();
    const complaint = await Complaint.create({
      ticketId,
      student: req.user.sub,
      category: req.body.category,
      subcategory: req.body.subcategory,
      title: cleanComplaintText(req.body.title),
      description: cleanComplaintText(req.body.description),
      attachment: (attachment && attachment.storedName) ? attachment : undefined,
      history: [{ status: 'Submitted', note: 'Complaint submitted', actor: req.user.sub }]
    });
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
  } catch (err) { next(err); }
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
      attachment: (attachment && attachment.storedName) ? attachment : undefined,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), lastSentAt: new Date()
    });
    let delivery;
    try {
      delivery = await sendComplaintOtp(user.email, challenge._id);
    } catch (mailError) {
      await removeAttachment(attachment);
      await ComplaintVerification.deleteOne({ _id: challenge._id });
      throw mailError;
    }
    res.status(201).json({
      challengeId: challenge._id,
      email: user.email,
      expiresAt: challenge.expiresAt,
      resendAvailableAt: new Date(Date.now() + 60 * 1000),
      devCode: isDev ? delivery.code : undefined
    });
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
    res.json({
      message: 'OTP sent',
      expiresAt: challenge.expiresAt,
      resendAvailableAt: new Date(Date.now() + 60 * 1000),
      devCode: isDev ? delivery.code : undefined
    });
  } catch (error) { next(error); }
});

app.post('/api/complaints/verification/:id/verify', auth(['student']), complaintOtpLimiter, async (req, res, next) => {
  let challenge;
  try {
    const code = String(req.body.code || '').trim();
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Enter the six-digit verification code' });
    challenge = await ComplaintVerification.findOneAndUpdate(
      {
        _id: req.params.id,
        student: req.user.sub,
        usedAt: { $exists: false },
        $or: [
          { processingAt: { $exists: false } },
          { processingAt: null },
          { processingAt: { $lt: new Date(Date.now() - 15000) } }
        ],
        expiresAt: { $gt: new Date() },
        failedAttempts: { $lt: 5 }
      },
      { $set: { processingAt: new Date() } },
      { new: true }
    );
    if (!challenge) return res.status(400).json({ error: 'Verification is invalid, expired, or already used' });
    const otp = await Otp.findOne({ email: challenge.email, purpose: 'complaint', challengeId: challenge._id, usedAt: { $exists: false }, expiresAt: { $gt: new Date() }, failedAttempts: { $lt: 5 } }).sort({ createdAt: -1 });
    const submittedHash = hashOtp(`${challenge.email}:${challenge._id}`, code);
    const hashBuf = Buffer.from(otp ? otp.codeHash : '', 'hex');
    const subBuf = Buffer.from(submittedHash, 'hex');
    const valid = otp && /^\d{6}$/.test(code) && hashBuf.length === subBuf.length && hashBuf.length > 0 && crypto.timingSafeEqual(hashBuf, subBuf);
    if (!valid) {
      await ComplaintVerification.updateOne({ _id: challenge._id }, { $unset: { processingAt: 1 }, $inc: { failedAttempts: 1 } });
      if (otp) { otp.failedAttempts += 1; await otp.save(); }
      return res.status(401).json({ error: 'Invalid or expired verification code' });
    }
    const ticketId = await createTicketId();
    const complaint = await Complaint.create({
      ticketId, student: req.user.sub, category: challenge.category, subcategory: challenge.subcategory,
      title: challenge.title, description: challenge.description,
      attachment: (challenge.attachment && challenge.attachment.storedName) ? challenge.attachment : undefined,
      history: [{ status: 'Submitted', note: 'Complaint submitted', actor: req.user.sub }]
    });
    otp.usedAt = new Date();
    await otp.save();
    challenge.usedAt = new Date();
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
      await ComplaintVerification.updateOne({ _id: challenge._id }, { $unset: { processingAt: 1 } }).catch(() => {});
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
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Complaint not found' });
    const complaint = await Complaint.findById(req.params.id).populate('student', 'email name profile').populate('messages.author', 'email name');
    if (!complaint) return res.status(404).json({ error: 'Complaint not found' });
    const studentId = complaint.student?._id ? complaint.student._id.toString() : (complaint.student ? complaint.student.toString() : null);
    if (req.user.role !== 'admin' && studentId !== req.user.sub) return res.status(404).json({ error: 'Complaint not found' });
    if (req.user.role !== 'admin') complaint.messages = complaint.messages.filter((message) => !message.internal);
    res.json({ complaint });
  } catch (error) { next(error); }
});

app.post('/api/complaints/:id/messages', auth(), async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Complaint not found' });
    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) return res.status(404).json({ error: 'Complaint not found' });
    const studentId = complaint.student ? complaint.student.toString() : null;
    if (req.user.role !== 'admin' && studentId !== req.user.sub) return res.status(404).json({ error: 'Complaint not found' });
    if (!String(req.body.body || '').trim()) return res.status(400).json({ error: 'Message is required' });
    complaint.messages.push({ author: req.user.sub, body: cleanComplaintText(req.body.body), internal: req.user.role === 'admin' && Boolean(req.body.internal) });
    await complaint.save();
    res.status(201).json({ complaint });
  } catch (error) { next(error); }
});

app.patch('/api/complaints/:id/status', auth(['admin']), async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Complaint not found' });
    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) return res.status(404).json({ error: 'Complaint not found' });
    if (!statuses.includes(req.body.status) || !allowedTransitions[complaint.status]?.includes(req.body.status)) return res.status(400).json({ error: `Invalid transition from ${complaint.status}` });
    complaint.status = req.body.status;
    complaint.history.push({ status: req.body.status, note: String(req.body.note || ''), actor: req.user.sub });
    await complaint.save();
    if (complaint.student) {
      await Notification.create({
        user: complaint.student, type: 'complaint', title: 'Complaint status updated',
        message: `${complaint.ticketId} is now ${complaint.status}.`, link: `/complaints/${complaint._id}`
      });
    }
    res.json({ complaint });
  } catch (error) { next(error); }
});

app.get('/api/complaints/:id/attachment', auth(), async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Attachment not found' });
    const complaint = await Complaint.findById(req.params.id);
    const studentId = complaint?.student ? complaint.student.toString() : null;
    if (!complaint || !complaint.attachment?.storedName || (req.user.role !== 'admin' && studentId !== req.user.sub)) return res.status(404).json({ error: 'Attachment not found' });
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
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Student profile not found' });
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
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Complaint not found' });
    const complaint = await Complaint.findById(req.params.id).populate('student', 'email name profile');
    if (!complaint) return res.status(404).json({ error: 'Complaint not found' });
    const studentId = complaint.student?._id ? complaint.student._id.toString() : (complaint.student ? complaint.student.toString() : null);
    if (req.user.role !== 'admin' && studentId !== req.user.sub) return res.status(404).json({ error: 'Complaint not found' });
    const document = new PDFDocument({ margin: 50 });
    res.type('application/pdf').attachment(`${complaint.ticketId}.pdf`);
    document.pipe(res);
    document.fontSize(20).text('CampusCare Complaint Report');
    document.moveDown().fontSize(11).text(`Ticket: ${complaint.ticketId}`);
    document.text(`Status: ${complaint.status}`);
    document.text(`Student: ${complaint.student?.name || complaint.student?.email || 'Student Account (Deleted)'}`);
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

async function connectDatabase() {
  const primaryUri = process.env.MONGODB_URI;
  const localUri = 'mongodb://127.0.0.1:27017/college_complaints';
  try {
    console.log('Connecting to database...');
    await mongoose.connect(primaryUri, { serverSelectionTimeoutMS: 4000 });
    console.log(`Connected to database successfully (${primaryUri?.includes('@') ? 'remote cluster' : primaryUri})`);
  } catch (primaryErr) {
    console.warn(`Primary database connection failed: ${primaryErr.message}`);
    if (primaryUri !== localUri) {
      console.log(`Attempting fallback connection to local MongoDB (${localUri})...`);
      try {
        await mongoose.connect(localUri, { serverSelectionTimeoutMS: 3000 });
        console.log('Connected to local MongoDB database fallback successfully!');
        return;
      } catch (localErr) {
        console.error(`Local MongoDB fallback connection also failed: ${localErr.message}`);
      }
    }
    throw primaryErr;
  }
}

if (require.main === module) {
  connectDatabase()
    .then(() => app.listen(port, () => console.log(`API listening on ${port}`)))
    .catch((error) => { console.error('MongoDB connection failed', error.message); process.exitCode = 1; });
}

module.exports = { app };
