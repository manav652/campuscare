const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const hashOtp = (email, code) => crypto
  .createHmac('sha256', process.env.OTP_SECRET)
  .update(`${email}:${code}`)
  .digest('hex');

const signUser = (user) => jwt.sign(
  { sub: user._id.toString(), role: user.role, email: user.email },
  process.env.JWT_SECRET,
  { expiresIn: process.env.JWT_EXPIRES_IN || '2h' }
);

const auth = (roles = []) => (req, res, next) => {
  try {
    const header = req.get('authorization') || '';
    const cookies = Object.fromEntries((req.get('cookie') || '').split(';').map((part) => part.trim().split('=').map(decodeURIComponent)).filter(([key, value]) => key && value));
    const token = header.startsWith('Bearer ') ? header.slice(7) : cookies.campuscare_session;
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    if (roles.length && !roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' });
  }
};

const verifyPassword = (password, hash) => bcrypt.compare(password, hash);

module.exports = { auth, hashOtp, signUser, verifyPassword };
