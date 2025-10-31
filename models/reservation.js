const mongoose = require('mongoose');

const reservationSchema = new mongoose.Schema({
  username: String,
  floor: Number,
  room: String,
  date: Date,
  startTime: Date,
  endTime: Date,
  paymentMethod: String,
  status: { type: String, default: 'pending' },
}, { timestamps: true }); 


module.exports = mongoose.model('Reservation', reservationSchema);
