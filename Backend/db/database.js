// MongoDB connection via Mongoose. Call connect() once at boot (server.js) and
// await it before the server starts listening. Models live in ../models.
const mongoose = require('mongoose');
const { MONGODB_URI } = require('../config');

// Fail fast on malformed queries instead of silently ignoring extra fields.
mongoose.set('strictQuery', true);

let connecting = null;

async function connect() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (!connecting) {
    connecting = mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
    });
  }
  await connecting;
  return mongoose.connection;
}

async function disconnect() {
  await mongoose.disconnect();
  connecting = null;
}

module.exports = { connect, disconnect, mongoose };
