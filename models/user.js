const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true
  },
  username: {
    type: String,
    required: true,
    unique: true
  },
  password: {
    type: String,
    required: true
  },
  membership: {
    type: String,
    enum: ['Basic', 'Premium', 'Deluxe'],
    default: 'Basic'
  },
  phoneNumber: {
    type: String,
    match: /^\d*$/ // Digits only
  },
  gender: {
    type: String,
    enum: ['Male', 'Female']
  }
});

const User = mongoose.model('User', userSchema);

module.exports = User;
