// app.js
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const dotenv = require('dotenv');
const path = require('path');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const Chat = require('./models/chat');

dotenv.config();

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.log(err));

io.on('connection', (socket) => {
  console.log('User connected');
  
  socket.on('registerUser', (username) => {
    socket.username = username;
  });

  socket.on('chatMessage', async ({ sender, recipient, message }) => {
    // 🚨 REMOVE THIS OLD LINE if it exists:
    // io.emit('chatMessage', { sender, recipient, message });

    // ✅ INSTEAD, add this broadcast logic:
    for (let [id, sock] of io.of("/").sockets) {
      if (sock.username === sender || sock.username === recipient) {
        sock.emit('chatMessage', { sender, recipient, message });
      }
    }

    // ✅ Save message to MongoDB
    try {
      const newMsg = new Chat({ sender, recipient, message });
      await newMsg.save();
    } catch (err) {
      console.error('Failed to save message:', err);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected');
  });
});

// Middleware
app.use(express.urlencoded({ extended: true }));  // for parsing form data
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); 
app.use(express.static('public'));
// to serve static assets
app.set('view engine', 'ejs');

// Session middleware
app.use(session({
  secret: 'secret_key', 
  resave: false, 
  saveUninitialized: true
}));

// Routes
const itemRoutes = require('./routes/api');
app.use('/', itemRoutes);

const PORT = process.env.PORT || 5000;
http.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});