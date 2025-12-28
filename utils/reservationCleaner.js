const Reservation = require('../models/reservation'); 

async function cleanUpExpiredReservations() {
  const currentTime = new Date();

  // Delete pending reservations older than 3 minutes
  const resultPending = await Reservation.deleteMany({
    status: 'pending',
    createdAt: { $lt: currentTime - 3 * 60 * 1000 } 
  });

  // Delete reservations where the endTime passed
  const resultExpired = await Reservation.deleteMany({
    status: 'confirmed', 
    endTime: { $lt: currentTime }
  });

  console.log(`${resultPending.deletedCount} pending reservations older than 3 minutes deleted.`);
  console.log(`${resultExpired.deletedCount} expired reservations deleted.`);
}

module.exports = cleanUpExpiredReservations;

// Property of Marco - https://github.com/MarcoBenedictus
