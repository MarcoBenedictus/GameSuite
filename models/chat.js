const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema({
  sender: String,
  recipient: String,
  message: String,
  timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Chat', chatSchema);

// Property of Marco - https://github.com/MarcoBenedictus