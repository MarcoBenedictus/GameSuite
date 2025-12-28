const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/user');
const Reservation = require('../models/reservation');
const Membership = require('../models/membership');
const Chat = require('../models/chat');
const cleanUpExpiredReservations = require('../utils/reservationCleaner');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const router = express.Router();

//index/home
router.get('/', (req, res) => {
  res.render('index');
});

// Dashboard 
router.get('/dashboard', async (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/registlogin/login');  
  }


  try {
    const user = await User.findById(req.session.userId); 
    const reservations = await Reservation.find({ userId: user._id });

    if (!user) {
      return res.redirect('/registlogin/login');  
    }

    // Render the dashboard page and pass the username to the view
    res.render('dashboard', { username: user.username, reservations: reservations, });
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

// Registration Page
router.get('/registlogin/register', (req, res) => {
  res.render('registlogin/register', { error: null });
});

router.post('/registlogin/register', async (req, res) => {
  const { email, username, password } = req.body;

  // Check existing email or username 
  const existingUser = await User.findOne({ $or: [{ email }, { username }] });
  if (existingUser) {
    return res.render('registlogin/register', { error: 'Email or username already exists' });
  }

  // Hash password
  const hashedPassword = await bcrypt.hash(password, 10);

  const newUser = new User({
    email,
    username,
    password: hashedPassword
  });

  // Save 
  await newUser.save();
  res.redirect('/registlogin/login');  
});

// Login page
router.get('/registlogin/login', (req, res) => {
  res.render('registlogin/login', { error: null });  // render the login page
});

router.post('/registlogin/login', async (req, res) => {
  const { emailOrUsername, password } = req.body;

  const user = await User.findOne({ $or: [{ email: emailOrUsername }, { username: emailOrUsername }] });

  if (!user) {
    return res.render('registlogin/login', { error: 'Invalid email or username' }); 
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    return res.render('registlogin/login', { error: 'Invalid password' }); 
  }

  req.session.userId = user._id;
  req.session.username = user.username

  if (user.username.toLowerCase() === 'marco') {
    return res.redirect('/admin/admindashboard');
  } else {
    return res.redirect('/dashboard');
  }
});

// Forgot Password page
router.get('/registlogin/forgotpassword', (req, res) => {
  res.render('registlogin/forgotpassword', { error: null });  // render the forgot password page
});
router.post('/registlogin/forgotpassword', async (req, res) => {
  const { email } = req.body;

  try {
    const user = await User.findOne({ email });

    if (!user) {
      return res.render('registlogin/forgotpassword', { error: 'Email not found' });
    }

    console.log(`Password reset requested for ${email}`);

    res.render('registlogin/forgotpassword', { error: 'Reset link has been sent.' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// About Us 
router.get('/misc/aboutus', (req, res) => {
  res.render('misc/aboutus');  
});

//tombol bantuan
router.get('/misc/tombolbantuan', (req, res) => {
  res.render('misc/tombolbantuan');  
});

// Socket.IO & GeminiAI Chatbot 
router.get('/misc/chat/ai', async (req, res) => {
  const username = req.session.username;
  if (!username) return res.redirect('/registlogin/login');

  const messages = await Chat.find({
    $or: [
      { sender: username, recipient: 'ai' },
      { sender: 'ai', recipient: username }
    ]
  }).sort({ timestamp: 1 });

  res.render('misc/chat_ai', { username, messages });
});
  
router.post('/api/chat/ai', async (req, res) => {
  const username = req.session.username;
  const userMessage = req.body.message;
  if (!username) return res.status(401).json({ error: 'Not logged in' });

  try {
    const model = genAI.getGenerativeModel({ model: 'models/gemini-2.0-flash' });

    const result = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [{
            text: `You are a helpful chatbot that only answers questions about the GameSuite website.
If the question is unrelated (like general trivia, jokes, or coding), reply: "I'm here to help you with GameSuite-related questions.
it doesnt have to specifically be about the website, like if someone asks what do i do, or what can i do, etc. you know you can answer.
like things where someone says "test" then you should still assist them."

User: ${userMessage}`
          }]
        }
      ]
    });

    const aiReply = result.response.candidates[0].content.parts[0].text;

    await Chat.create({ sender: username, recipient: 'ai', message: userMessage });
    await Chat.create({ sender: 'ai', recipient: username, message: aiReply });

    res.json({ reply: aiReply });

  } catch (error) {
    console.error('Gemini API error:', error);
    res.status(500).json({ error: 'Gemini error' });
  }
});

// Clear AI Chat History
router.post('/api/chat/ai/clear', async (req, res) => {
  const username = req.session.username;
  if (!username) return res.status(401).json({ error: 'Not logged in' });

  try {
    await Chat.deleteMany({
      $or: [
        { sender: username, recipient: 'ai' },
        { sender: 'ai', recipient: username }
      ]
    });
    res.json({ message: 'Chat cleared' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to clear chat' });
  }
});

// Socket.IO Chat
router.get('/misc/chat', async (req, res) => {
  const username = req.session.username;
  if (!username) return res.redirect('/registlogin/login');

  if (username === 'marco') {
    // Admin mode: show user list
    const rawUsers = await Chat.aggregate([
  { $match: { recipient: 'marco' } },
  { $sort: { timestamp: -1 } },
  {
    $group: {
      _id: '$sender',
      lastMessage: { $first: '$message' },
      timestamp: { $first: '$timestamp' }
    }
  }
]);

const users = rawUsers.map(u => ({
  username: u._id,
  lastMessage: u.lastMessage.length > 30 ? u.lastMessage.substring(0, 30) + '...' : u.lastMessage,
  timestamp: new Date(u.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}));

res.render('misc/admin_chat_select', { username, users });
    return res.render('misc/admin_chat_select', { username, users: allUsers });
  }

// Normal user: show their conversation with admin
  const messages = await Chat.find({
    $or: [
      { sender: username, recipient: 'marco' },
      { sender: 'marco', recipient: username }
    ]
  }).sort({ timestamp: 1 });

  res.render('misc/chat', { username, messages, chattingWith: null });
});

// Socket.IO Chat for Admin
router.get('/misc/chat/:user', async (req, res) => {
  const admin = req.session.username;
  if (admin !== 'marco') return res.status(403).send("Forbidden");

  const user = req.params.user;

  const messages = await Chat.find({
    $or: [
      { sender: user, recipient: 'marco' },
      { sender: 'marco', recipient: user }
    ]
  }).sort({ timestamp: 1 });

  res.render('misc/chat', { username: 'marco', messages, chattingWith: user });
});

// Socket.IO Inbox
router.get('/misc/inbox', async (req, res) => {
  const username = req.session.username;
  if (!username) return res.redirect('/registlogin/login');

  if (username.toLowerCase() === 'marco') {
    const rawUsers = await Chat.aggregate([
      { $match: { recipient: 'marco' } },
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: '$sender',
          lastMessage: { $first: '$message' },
          timestamp: { $first: '$timestamp' }
        }
      }
    ]);

    const users = rawUsers.map(u => ({
      username: u._id,
      lastMessage: u.lastMessage.length > 30 ? u.lastMessage.slice(0, 30) + '...' : u.lastMessage,
      timestamp: new Date(u.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }));

    return res.render('misc/inbox', { username, role: 'admin', users });
  }

  // Normal user
  const chatOptions = [
    { username: 'marco', label: 'Chat with Admin' },
    { username: 'ai', label: 'Chat with AI' }
  ];

  res.render('misc/inbox', { username, role: 'user', users: chatOptions });
});

// Room Reservation

// Ruangan Capacity Selection 
router.get('/ruangan/ruanganlanding', async (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/registlogin/login');
  }

  try {
    await cleanUpExpiredReservations(); 

    const user = await User.findById(req.session.userId);
    if (!user) return res.redirect('/registlogin/login');

    res.render('ruangan/ruanganlanding', { username: user.username });
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

router.post('/ruangan/ruanganlanding', async (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/registlogin/login');
  }

  try {
    const user = await User.findById(req.session.userId);
    if (!user) return res.redirect('/registlogin/login');

    const username = user.username;
    const { people } = req.body;
    const numberOfPeople = parseInt(people, 10);

    if (isNaN(numberOfPeople) || ![1, 2, 5].includes(numberOfPeople)) {
      return res.render('ruangan/ruanganlanding', {
        username,
        error: 'System has detected anomalies, please try again.'
      });
    }

    let floor, roomsAvailable;

    if (numberOfPeople === 1) {
      floor = 1;
      roomsAvailable = ['101', '102', '103', '104', '105', '106', '107', '108', '109', '110'];
    } else if (numberOfPeople === 2) {
      floor = 2;
      roomsAvailable = ['201', '202', '203', '204', '205'];
    } else if (numberOfPeople === 5) {
      floor = 3;
      roomsAvailable = ['301', '302', '303', '304', '305'];
    }

    const room = roomsAvailable[Math.floor(Math.random() * roomsAvailable.length)];

    const reservation = new Reservation({
      username,
      floor,
      room,
      status: 'pending'
    });

    await reservation.save();
    req.session.reservationId = reservation._id;
    req.session.people = numberOfPeople;

    res.redirect('/ruangan/ruanganlanding2');
  } catch (err) {
    console.error(err);
    res.status(500).render('ruangan/ruanganlanding', {
      username: req.session.username || 'User',
      error: 'Internal server error.'
    });
  }
});

// Ruangan Time selection page
router.get('/ruangan/ruanganlanding2', async (req, res) => {
  const reservationId = req.session.reservationId;
  if (!reservationId) return res.redirect('/ruangan/ruanganlanding');

  const reservation = await Reservation.findById(reservationId);
  if (!reservation) return res.redirect('/ruangan/ruanganlanding');

  res.render('ruangan/ruanganlanding2', { room: reservation.room, error: null });
});

router.post('/ruangan/ruanganlanding2', async (req, res) => {
  const { startTime, endTime, date } = req.body;
  const reservationId = req.session.reservationId;

  try {
    const reservation = await Reservation.findById(reservationId);
    if (!reservation) {
      return res.render('ruangan/ruanganlanding2', { room: 'N/A', error: 'Reservation not found.' });
    }

    const newStart = new Date(`${date}T${startTime}`);
    const newEnd = new Date(`${date}T${endTime}`);
    const now = new Date();

    const selectedDate = new Date(date);
    selectedDate.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const renderError = (message) => {
      return res.render('ruangan/ruanganlanding2', {
        room: reservation.room,
        error: message
      });
    };

    if (selectedDate < today) return renderError('You cannot reserve for a past date.');
    if (newStart.getMinutes() !== 0 || newEnd.getMinutes() !== 0)
      return renderError('Please select times that start and end on the hour (e.g. 13:00).');
    if (newStart.toDateString() === now.toDateString() && newStart <= now)
      return renderError('You cannot reserve a time slot in the past.');
    if (newEnd <= newStart) return renderError('End time must be after start time.');

    const startHour = newStart.getHours();
    const endHour = newEnd.getHours();
    if (startHour < 8 || endHour > 22)
      return renderError('Reservations are only allowed between 08:00 and 22:00.');

    let roomsAvailable;
    if (reservation.floor === 1) {
      roomsAvailable = ['101', '102', '103', '104', '105', '106', '107', '108', '109', '110'];
    } else if (reservation.floor === 2) {
      roomsAvailable = ['201', '202', '203', '204', '205'];
    } else if (reservation.floor === 3) {
      roomsAvailable = ['301', '302', '303', '304', '305'];
    }

    roomsAvailable = roomsAvailable.sort(() => Math.random() - 0.5);

    let assignedRoom = null;
    for (const room of roomsAvailable) {
      const conflict = await Reservation.findOne({
        room,
        date,
        $or: [
          { startTime: { $lt: newEnd }, endTime: { $gt: newStart } }
        ]
      });

      if (!conflict) {
        assignedRoom = room;
        break;
      }
    }

    if (!assignedRoom) return renderError('All rooms are booked for this time. Please choose another.');

    const duration = (newEnd - newStart) / (1000 * 60 * 60);

    reservation.date = date;
    reservation.startTime = newStart;
    reservation.endTime = newEnd;
    reservation.duration = duration;
    reservation.status = 'pending';
    reservation.room = assignedRoom;
    reservation.username = req.session.username;
    await reservation.save();

    req.session.reservationDetails = {
      duration,
      date,
      startTime,
      endTime,
      room: assignedRoom
    };

    res.redirect('/ruangan/ruanganlanding3');
  } catch (err) {
    console.error(err);
    res.render('ruangan/ruanganlanding2', { room: 'N/A', error: 'Something went wrong.' });
  }
});

// GET: Payment selection page
router.get('/ruangan/ruanganlanding3', (req, res) => {
  if (!req.session.reservationDetails) {
    return res.redirect('/ruangan/ruanganlanding2');
  }
  res.render('ruangan/ruanganlanding3');
});

// POST: Payment selection and final confirmation
router.post('/ruangan/ruanganlanding3', async (req, res) => {
  const { paymentMethod } = req.body;
  const { reservationDetails, reservationId, people, userId } = req.session;

  if (!reservationDetails || !paymentMethod || !reservationId) {
    return res.status(400).send('Missing reservation data.');
  }

  try {
    const user = await User.findById(userId);
    if (!user) return res.status(404).send('User not found.');

    console.log('User ID from session:', userId);
    console.log('User Membership Type:', user.membershipType);

    let pricePerHour;
    switch (people) {
      case 1:
        pricePerHour = 15000;
        break;
      case 2:
        pricePerHour = 30000;
        break;
      case 5:
        pricePerHour = 75000;
        break;
      default:
        return res.status(400).send('Invalid room type.');
    }

    let totalCost = pricePerHour * reservationDetails.duration;

    // Membership Discount
    const membership = (user.membership || '').toLowerCase();
    if (membership === 'premium') {
      totalCost *= 0.95; // 5% off
    } else if (membership === 'deluxe') {
      totalCost *= 0.90; // 10% off
    }

    // Pembulatan Discount
    totalCost = Math.round(totalCost);

    console.log('Final Total Cost:', totalCost);

    const reservation = await Reservation.findById(reservationId);
    if (!reservation) return res.status(404).send('Reservation not found.');

    reservation.paymentMethod = paymentMethod;
    reservation.status = 'confirmed';
    await reservation.save();

    // Clean up session
    delete req.session.reservationDetails;
    delete req.session.reservationId;
    delete req.session.people;

    res.render('ruangan/ruanganlanding4', { totalCost, paymentMethod });
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal server error.');
  }
});

// Check Reservasi Pribadi
router.get('/myreservations', async (req, res) => {
  if (!req.session.userId) return res.redirect('/registlogin/login');

  try {
    const user = await User.findById(req.session.userId);
    const reservations = await Reservation.find({ username: user.username }).sort({ date: -1, startTime: 1 });

    res.render('ruangan/myreservations', { username: user.username, reservations });
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

// Membership routes

// Membership Landing Page
router.get('/membership/membershiplanding', (req, res) => {
  res.render('membership/membershiplanding', { username: req.session.username }); // in case you want to greet them
});

router.post('/membership/membershiplanding', (req, res) => {
  const { selectedOption } = req.body;

  if (selectedOption === 'signup') {
    res.redirect('/membership/membershipsignup');
  } else if (selectedOption === 'check') {
    res.redirect('/membership/membershipstatuscheck');
  } else if (selectedOption === 'renew') {
    res.redirect('/membership/membershiprenew');
  } else {
    res.redirect('/membership/membershiplanding');
  }
});

// Membership Sign Up Page
router.get('/membership/membershipsignup', async (req, res) => {
  if (!req.session.userId) return res.redirect('/registlogin/login');

  try {
    const user = await User.findById(req.session.userId);
    if (!user) return res.redirect('/registlogin/login');

    // Check if user has an active membership
    const existingMembership = await Membership.findOne({
      userId: user._id,
      isActive: true
    }).sort({ createdAt: -1 });

    if (existingMembership) {
      const now = new Date();
      const expiryDate = new Date(existingMembership.startDate);
      expiryDate.setDate(expiryDate.getDate() + existingMembership.durationInDays);

      if (now < expiryDate) {
        const remainingTime = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));

        req.session.membershipRemaining = {
          remainingTime,
          membershipType: existingMembership.membership
        };

        return res.redirect('/membership/membershipalreadyactive');
      } else {
 
        existingMembership.isActive = false;
        await existingMembership.save();
      }
    }

    res.render('membership/membershipsignup', {
      email: user.email,
      username: user.username
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

router.post('/membership/membershipsignup', async (req, res) => {
  const { phoneNumber, gender, membership } = req.body;

  if (!/^\d{12}$/.test(phoneNumber)) {
    return res.status(400).send('Phone number must contain 12 digits of numbers');
  }

  req.session.signupDetails = {
    phoneNumber,
    gender,
    membershipType: membership
  };

  res.redirect('/membership/membershipsignuppayment');
});

// Membership Signup Payment Page
router.get('/membership/membershipsignuppayment', async (req, res) => {
  if (!req.session.userId || !req.session.signupDetails) {
    return res.redirect('/membership/membershipsignup');
  }

  try {
    const user = await User.findById(req.session.userId);
    if (!user) return res.redirect('/registlogin/login');

    res.render('membership/membershipsignuppayment', {
      email: user.email,
      username: user.username,
      membershipType: req.session.signupDetails.membershipType
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

router.post('/membership/membershipsignuppayment', async (req, res) => {
  if (!req.session.userId || !req.session.signupDetails) {
    return res.redirect('/membership/membershipsignup');
  }

  const { paymentMethod } = req.body;
  const { phoneNumber, gender, membershipType } = req.session.signupDetails;

  try {
    const user = await User.findById(req.session.userId);
    if (!user) return res.redirect('/registlogin/login');

    // Check for existing membership
    let existingMembership = await Membership.findOne({ userId: user._id }).sort({ createdAt: -1 });
    let isFirstSignup = !existingMembership || !existingMembership.initialSignupUsed;

    // Expire old membership if it’s expired
    if (existingMembership) {
      const expiry = new Date(existingMembership.startDate);
      expiry.setDate(expiry.getDate() + existingMembership.durationInDays);
      if (new Date().getTime() > expiry) {
        existingMembership.isActive = false;
        await existingMembership.save();
      }
    }

    // Math Harga Awal
    let baseCost = membershipType === 'Premium' ? 150000 : 250000;
    let totalCost = isFirstSignup ? baseCost / 2 : baseCost;

    // Create new membership
    const newMembership = new Membership({
      userId: user._id,
      email: user.email,
      name: user.username,
      phoneNumber,
      gender,
      membership: membershipType,
      startDate: new Date().getTime(),
      durationInDays: 30,
      isActive: true,
      initialSignupUsed: true
    });

    await newMembership.save();

    // 🔧 Update user model here
    await User.findByIdAndUpdate(user._id, {
      membership: membershipType,
      phoneNumber,
      gender
    });

    // Store final values in session for display
    req.session.membershipPayment = {
      totalCost,
      paymentMethod
    };

    delete req.session.signupDetails; // cleanup

    res.redirect('/membership/membershipsignupcomplete');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error processing membership.');
  }
});

// Membership Signup Complete Page
router.get('/membership/membershipsignupcomplete', async (req, res) => {
  if (!req.session.userId || !req.session.membershipPayment) {
    return res.redirect('/membership/membershiplanding');
  }

  const { totalCost, paymentMethod } = req.session.membershipPayment;
  delete req.session.membershipPayment;

  try {
    const user = await User.findById(req.session.userId);
    if (!user) return res.redirect('/registlogin/login');

    res.render('membership/membershipsignupcomplete', {
      username: user.username,
      totalCost,
      paymentMethod
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error displaying confirmation.');
  }
});

// Membership Already Active Page
router.get('/membership/membershipalreadyactive', async (req, res) => {
  if (!req.session.userId || !req.session.membershipRemaining) {
    return res.redirect('/membership/membershiplanding');
  }

  const { remainingTime, membershipType } = req.session.membershipRemaining;
  delete req.session.membershipRemaining;

  try {
    const user = await User.findById(req.session.userId);
    if (!user) return res.redirect('/registlogin/login');

    res.render('membership/membershipalreadyactive', {
      username: user.username,
      membershipType,
      remainingTime
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error displaying active membership info.');
  }
});

// Membership Status Check Page
router.get('/membership/membershipstatuscheck', async (req, res) => {
  if (!req.session.userId) return res.redirect('/registlogin/login');

  try {
    const user = await User.findById(req.session.userId);
    if (!user) return res.redirect('/registlogin/login');

    const latestMembership = await Membership.findOne({
      userId: user._id
    }).sort({ createdAt: -1 });

    let membershipStatus = "No Membership";
    let remainingDays = 0;

    if (latestMembership) {
      const startDate = new Date(latestMembership.startDate);
      const expiryDate = new Date(startDate);
      expiryDate.setDate(expiryDate.getDate() + latestMembership.durationInDays);

      const now = new Date();

      if (now < expiryDate && latestMembership.isActive) {
        membershipStatus = latestMembership.membership;
        remainingDays = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
      } else {
        membershipStatus = "Expired";
        remainingDays = 0;
      }
    }

    res.render('membership/membershipstatuscheck', {
      username: user.username,
      email: user.email,
      phoneNumber: latestMembership?.phoneNumber || 'Not Provided',
      gender: latestMembership?.gender || 'Not Provided',
      membershipType: latestMembership?.membership,
      remainingTime: remainingDays
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error checking membership status.');
  }
});

// Membership Renew Page
router.get('/membership/membershiprenew', async (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/registlogin/login');
  }

  try {
    const user = await User.findById(req.session.userId);
    if (!user) return res.redirect('/registlogin/login');

    // Check if the user has an active membership
    const activeMembership = await Membership.findOne({ userId: user._id, isActive: true }).sort({ createdAt: -1 });

    if (!activeMembership) {
      return res.redirect('/membership/membershiplanding');
    }

    req.session.renewMembershipType = activeMembership.membership;
    res.render('membership/membershiprenew', {
      username: user.username,
      membershipType: activeMembership.membership,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading renew page');
  }
});

// Handle Membership Renewal POST
router.post('/membership/membershiprenew', async (req, res) => {
  const { selectedDuration } = req.body;

  if (!selectedDuration) {
    return res.redirect('/membership/membershiprenew');
  }

  req.session.renewDuration = selectedDuration;

  const duration = parseInt(selectedDuration);
  const membershipType = req.session.renewMembershipType;

  // Calculate total cost based on duration
  let totalCost = 0;
  if (membershipType === 'Premium') {
    totalCost = 150000; // Premium base price
  } else if (membershipType === 'Deluxe') {
    totalCost = 250000; // Deluxe base price
  }

  if (duration === 3) {
    totalCost *= 0.8 * 3;
  } else if (duration === 6) {
    totalCost *= 0.7 * 6;
  }

  req.session.totalCost = totalCost;
  req.session.membershipType = membershipType;
  req.session.duration = duration;

  res.redirect('/membership/membershiprenewpayment');
});

// Payment Page
router.get('/membership/membershiprenewpayment', async (req, res) => {
  if (!req.session.userId || !req.session.totalCost) {
    return res.redirect('/membership/membershiplanding');
  }

  try {
    const user = await User.findById(req.session.userId);
    if (!user) return res.redirect('/registlogin/login');

    res.render('membership/membershiprenewpayment', {
      username: user.username,
      membershipType: req.session.membershipType,
      totalCost: req.session.totalCost,
      duration: req.session.duration,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading payment page');
  }
});

// Handle Payment POST
router.post('/membership/membershiprenewpayment', async (req, res) => {
  const { paymentMethod } = req.body;

  if (!paymentMethod) {
    return res.redirect('/membership/membershiprenewpayment');
  }

  const { membershipType, duration, totalCost } = req.session;

  try {
    const user = await User.findById(req.session.userId);
    if (!user) return res.redirect('/registlogin/login');

    // Get current active membership
    const currentMembership = await Membership.findOne({
      userId: user._id,
      isActive: true,
    }).sort({ createdAt: -1 });

    let newDurationInDays = duration * 30; // Convert duration to days (30 days per month)

    if (currentMembership) {
      // Calculate remaining days from the current membership
      const now = Date.now();
      const elapsedDays = Math.floor((now - currentMembership.startDate) / (1000 * 60 * 60 * 24));
      const remainingDays = Math.max(currentMembership.durationInDays - elapsedDays, 0);

      // Add remaining days to the new renewal duration
      newDurationInDays += remainingDays;

      // Update the current membership
      currentMembership.durationInDays = newDurationInDays;
      currentMembership.startDate = now; // Reset start date for the renewal
      currentMembership.isActive = true;

      await currentMembership.save();
    } else {
      // If no active membership exists, create a new one
      const renewedMembership = new Membership({
        userId: user._id,
        email: user.email,
        name: user.username,
        membership: membershipType,
        startDate: new Date().getTime(),
        durationInDays: newDurationInDays,
        isActive: true,
        initialSignupUsed: true,
      });

      await renewedMembership.save();
    }

    // Save payment details to session
    req.session.membershipRenewPayment = {
      totalCost,
      paymentMethod,
    };

    // Clear session variables related to renewal
    delete req.session.renewDuration;
    delete req.session.renewMembershipType;

    res.redirect('/membership/membershiprenewcomplete');
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to process renewal');
  }
});

// Membership Renew Complete Page
router.get('/membership/membershiprenewcomplete', async (req, res) => {
  if (!req.session.userId || !req.session.membershipRenewPayment) {
    return res.redirect('/membership/membershiplanding');
  }

  const { totalCost, paymentMethod } = req.session.membershipRenewPayment;
  delete req.session.membershipRenewPayment;

  try {
    const user = await User.findById(req.session.userId);
    if (!user) return res.redirect('/registlogin/login');

    res.render('membership/membershiprenewcomplete', {
      username: user.username,
      totalCost,
      paymentMethod,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error showing renewal confirmation');
  }
});

//logout
router.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).send('Failed to log out');
    }
    res.redirect('/registlogin/login'); // Redirect to login after logout
  });
});

// ADMIN ROUTES

// Admin Dashboard
router.get('/admin/admindashboard', (req, res) => {
  if (!req.session || !req.session.username) {
    return res.redirect('/registlogin/login'); // Not logged in
  }

  if (req.session.username.toLowerCase() !== 'marco') {
    return res.status(403).send('Access denied. Admins only.');
  }

  res.render('admin/admindashboard', {
    username: req.session.username
  });
});

// Admin membership page (GET)
router.get('/admin/adminmembership', async (req, res) => {
  if (!req.session || req.session.username.toLowerCase() !== 'marco') {
    return res.status(403).send('Access denied.');
  }

  try {
    const memberships = await Membership.find().populate('userId').sort({ name: 1 });
    const allUsers = await User.find().sort({ username: 1 });

    res.render('admin/adminmembership', {
      memberships,
      allUsers
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// Update membership (POST)
router.post('/admin/adminmembership/update/:id', async (req, res) => {
  const { userId, membership, durationInDays, isActive } = req.body;

  try {
    const now = new Date();
    const expiryDate = new Date(now.getTime() + durationInDays * 24 * 60 * 60 * 1000);

    await Membership.findByIdAndUpdate(req.params.id, {
      userId,
      membership,
      durationInDays,
      isActive: isActive === 'true',
      expiryDate
    });

    res.redirect('/admin/adminmembership');
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to update membership');
  }
});

// Delete membership (POST)
router.post('/admin/adminmembership/delete/:id', async (req, res) => {
  try {
    await Membership.findByIdAndDelete(req.params.id);
    res.redirect('/admin/adminmembership');
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to delete membership');
  }
});

// Admin Ruangan
router.get('/admin/adminruangan', (req, res) => {
  if (!req.session || req.session.username.toLowerCase() !== 'marco') {
    return res.status(403).send('Access denied.');
  }

  res.render('admin/adminruangan');
});

// Admin Floor 1
router.get('/admin/adminruangan1', async (req, res) => {
  if (!req.session || req.session.username.toLowerCase() !== 'marco') {
    return res.status(403).send('Access denied.');
  }

  const reservations = await Reservation.find({
    room: { $gte: 101, $lte: 110 }
  }).sort({ startTime: 1 });

  res.render('admin/adminruangan1', { reservations });
});

// Admin Floor 2
router.get('/admin/adminruangan2', async (req, res) => {
  if (!req.session || req.session.username.toLowerCase() !== 'marco') {
    return res.status(403).send('Access denied.');
  }

  const reservations = await Reservation.find({
    room: { $gte: 201, $lte: 205 }
  }).sort({ startTime: 1 });

  res.render('admin/adminruangan2', { reservations });
});

// Admin Floor 3
router.get('/admin/adminruangan3', async (req, res) => {
  if (!req.session || req.session.username.toLowerCase() !== 'marco') {
    return res.status(403).send('Access denied.');
  }

  const reservations = await Reservation.find({
    room: { $gte: 301, $lte: 305 }
  }).sort({ startTime: 1 });

  res.render('admin/adminruangan3', { reservations });
});

// Delete reservation (POST)
router.post('/admin/reservation/delete/:id', async (req, res) => {
  try {
    await Reservation.findByIdAndDelete(req.params.id);
    res.redirect(req.get('referer'));
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

module.exports = router;

// Property of Marco - https://github.com/MarcoBenedictus
