const mongoose = require('mongoose');

const membershipSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  email: { type: String, },
  name: { type: String, },
  phoneNumber: { type: String, match: /^\d*$/ },
  gender: { type: String, enum: ['Male', 'Female'] },
  membership: { type: String, enum: ['Basic', 'Premium', 'Deluxe'], default: 'Basic' },
  startDate: { type: Date, default: Date.now },
  durationInDays: { type: Number },
  isActive: { type: Boolean, default: true },
  initialSignupUsed: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Membership', membershipSchema);
