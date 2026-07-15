// Thin Socket.IO wrapper so route handlers can push live updates to students
// without importing the server. server.js calls init(httpServer) once at boot;
// routes call the notify* helpers after they mutate data.
//
// Room scheme (each student socket joins all three on connect):
//   user:<id>                     -> a single student
//   program:<program>             -> every student in a program (all semesters)
//   psem:<program>:<semester>     -> students of one program + semester
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { JWT_SECRET, CORS_ORIGINS } = require('../config');
const { User } = require('../models');

let io = null;

function init(httpServer) {
  // In local dev (no CORS_ORIGINS configured) allow any origin; in production
  // restrict Socket.IO to the same allowlist the HTTP API uses.
  const corsOrigin = CORS_ORIGINS.length ? CORS_ORIGINS : true;
  io = new Server(httpServer, { cors: { origin: corsOrigin, credentials: true } });

  // Authenticate every socket from the JWT it presents in the handshake.
  io.use(async (socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) return next(new Error('Missing auth token.'));
    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch {
      return next(new Error('Invalid or expired token.'));
    }
    try {
      const user = await User.findById(payload.id).select('_id role program semester').lean();
      if (!user) return next(new Error('User no longer exists.'));
      socket.data.user = user;
      next();
    } catch (err) {
      next(err);
    }
  });

  io.on('connection', (socket) => {
    const u = socket.data.user;
    socket.join('user:' + u._id);
    socket.join('program:' + u.program);
    socket.join('psem:' + u.program + ':' + u.semester);
  });

  return io;
}

// Push an event to one or more specific students.
function notifyStudents(studentIds, event, payload) {
  if (!io) return;
  for (const id of studentIds) io.to('user:' + id).emit(event, payload || {});
}

// Push an announcement to a program cohort. A null semester reaches the whole
// program; a specific semester reaches only that semester's room.
function notifyProgram(program, semester, event, payload) {
  if (!io) return;
  const room = semester == null ? 'program:' + program : 'psem:' + program + ':' + semester;
  io.to(room).emit(event, payload || {});
}

module.exports = { init, notifyStudents, notifyProgram };
