const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String, default: '' },
  role: { type: String, enum: ['student', 'admin'], default: 'student' },
  googleId: { type: String, default: '' },
  profile: {
    studentUid: String,
    fatherGuardianName: String,
    course: String,
    semester: String,
    section: String,
    mobileNumber: String
  }
}, { timestamps: true });

const otpSchema = new mongoose.Schema({
  email: { type: String, required: true, index: true },
  purpose: { type: String, enum: ['login', 'complaint'], default: 'login', index: true },
  challengeId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
  codeHash: { type: String, required: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  failedAttempts: { type: Number, default: 0 },
  usedAt: Date
}, { timestamps: true });

const complaintVerificationSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  email: { type: String, required: true },
  category: { type: String, required: true },
  subcategory: { type: String, required: true },
  title: { type: String, required: true, maxlength: 160 },
  description: { type: String, required: true, maxlength: 5000 },
  attachment: {
    originalName: String,
    storedName: String,
    mimeType: String,
    size: Number
  },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  lastSentAt: { type: Date, required: true },
  failedAttempts: { type: Number, default: 0 },
  processingAt: Date,
  usedAt: Date
}, { timestamps: true });

const complaintSchema = new mongoose.Schema({
  ticketId: { type: String, required: true, unique: true, index: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  category: { type: String, required: true },
  subcategory: { type: String, required: true },
  title: { type: String, required: true, trim: true, maxlength: 160 },
  description: { type: String, required: true, trim: true, maxlength: 5000 },
  attachment: {
    originalName: String,
    storedName: String,
    mimeType: String,
    size: Number
  },
  status: {
    type: String,
    enum: ['Submitted', 'Under Review', 'In Progress', 'Waiting for Student', 'Resolved', 'Closed'],
    default: 'Submitted',
    index: true
  },
  messages: [{
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true, maxlength: 3000 },
    internal: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
  }],
  history: [{
    status: String,
    note: String,
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now }
  }]
}, { timestamps: true });

const dataRequestSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  email: { type: String, required: true, lowercase: true, trim: true, index: true },
  type: { type: String, enum: ['deletion'], default: 'deletion' },
  details: { type: String, trim: true, maxlength: 2000, default: '' },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  reviewNote: { type: String, trim: true, maxlength: 1000 },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: Date
}, { timestamps: true });

const notificationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: ['complaint', 'account'], required: true },
  title: { type: String, required: true, trim: true, maxlength: 160 },
  message: { type: String, required: true, trim: true, maxlength: 500 },
  link: { type: String, trim: true, maxlength: 200 },
  readAt: Date
}, { timestamps: true });

module.exports = {
  User: mongoose.model('User', userSchema),
  Otp: mongoose.model('Otp', otpSchema),
  ComplaintVerification: mongoose.model('ComplaintVerification', complaintVerificationSchema),
  Complaint: mongoose.model('Complaint', complaintSchema),
  DataRequest: mongoose.model('DataRequest', dataRequestSchema),
  Notification: mongoose.model('Notification', notificationSchema)
};
