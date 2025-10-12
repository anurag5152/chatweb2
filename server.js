// server.js - robust minimal chat backend with Socket.IO
require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 5000;

// Basic middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Postgres pool (supports DATABASE_URL or individual vars)
let pool;
if (process.env.DATABASE_URL) {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
} else {
  const dbUser = process.env.DB_USER;
  const dbHost = process.env.DB_HOST || 'localhost';
  const dbName = process.env.DB_NAME;
  const dbPassword = process.env.DB_PASSWORD; // not logged
  const dbPort = Number(process.env.DB_PORT || 5432);

  // Fail fast if database is not configured
  if (!dbName || !dbUser) {
    console.error('[DB CONFIG] Missing DB_NAME or DB_USER. Please set env vars or DATABASE_URL.');
    process.exit(1);
  }

  // Log sanitized DB config for verification (no secrets)
  console.log('[DB CONFIG]', { host: dbHost, port: dbPort, database: dbName, user: dbUser });

  pool = new Pool({
    user: dbUser,
    host: dbHost,
    database: dbName,
    password: dbPassword,
    port: dbPort,
  });
}

// Robust DB init: create tables if missing, add missing columns/constraints if table exists
async function initDb() {
  try {
    // users
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    // friend_requests
    await pool.query(`
      CREATE TABLE IF NOT EXISTS friend_requests (
        id SERIAL PRIMARY KEY,
        requester_id INT NOT NULL,
        receiver_id INT NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (requester_id, receiver_id)
      );
    `);

    // add FK constraints for friend_requests if missing (best-effort)
    try {
      await pool.query(`
        ALTER TABLE friend_requests
        ADD CONSTRAINT fr_req_fk_requester FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE;
      `);
    } catch (e) { /* ignore if exists */ }

    try {
      await pool.query(`
        ALTER TABLE friend_requests
        ADD CONSTRAINT fr_req_fk_receiver FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE;
      `);
    } catch (e) { /* ignore if exists */ }

    // conversations table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id SERIAL PRIMARY KEY
        -- user_a, user_b, created_at may be added below if missing
      );
    `);

    // helper to check column existence
    const colCheck = async (col) => {
      const r = await pool.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name='conversations' AND column_name=$1`,
        [col]
      );
      return r.rowCount > 0;
    };

    if (!(await colCheck('user_a'))) {
      await pool.query(`ALTER TABLE conversations ADD COLUMN user_a INT;`);
    }
    if (!(await colCheck('user_b'))) {
      await pool.query(`ALTER TABLE conversations ADD COLUMN user_b INT;`);
    }
    if (!(await colCheck('created_at'))) {
      await pool.query(`ALTER TABLE conversations ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();`);
    }

    // add FK constraints for conversations if missing
    try {
      await pool.query(`
        ALTER TABLE conversations
        ADD CONSTRAINT conv_fk_usera FOREIGN KEY (user_a) REFERENCES users(id) ON DELETE CASCADE;
      `);
    } catch (e) { /* ignore if exists */ }

    try {
      await pool.query(`
        ALTER TABLE conversations
        ADD CONSTRAINT conv_fk_userb FOREIGN KEY (user_b) REFERENCES users(id) ON DELETE CASCADE;
      `);
    } catch (e) { /* ignore if exists */ }

    // create unique index on ordered pair to prevent duplicate 1:1 convs (LEAST/GREATEST)
    // Make sure user_a and user_b exist before creating the index
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_conversations_user_pair
      ON conversations (LEAST(user_a, user_b), GREATEST(user_a, user_b));
    `);

    // messages
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id BIGSERIAL PRIMARY KEY,
        conversation_id INT NOT NULL,
        sender_id INT NOT NULL,
        content TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    // add FK constraints for messages if missing
    try {
      await pool.query(`
        ALTER TABLE messages
        ADD CONSTRAINT msg_fk_conv FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;
      `);
    } catch (e) { /* ignore if exists */ }

    try {
      await pool.query(`
        ALTER TABLE messages
        ADD CONSTRAINT msg_fk_sender FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE;
      `);
    } catch (e) { /* ignore if exists */ }

    // index for fast message retrieval
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at DESC);`);

    console.log('DB init complete');
  } catch (err) {
    console.error('DB init error', err && err.stack ? err.stack : err);
    throw err;
  }
}

// run initDb robustly
initDb()
  .then(() => console.log('DB ready'))
  .catch((e) => {
    console.error('DB init failed, exiting', e && e.stack ? e.stack : e);
    process.exit(1);
  });

// JWT helpers
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_in_env';
function signToken(user) {
  return jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
}
function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); } catch (e) { return null; }
}

// helper: detect if client expects JSON (AJAX/SPAs)
function clientWantsJson(req) {
  const accept = (req.headers['accept'] || '').toLowerCase();
  const ct = (req.headers['content-type'] || '').toLowerCase();
  if (ct.includes('application/json')) return true;
  if (accept.includes('application/json')) return true;
  if (req.headers['x-requested-with'] === 'XMLHttpRequest') return true;
  return false;
}

// auth middleware for REST
async function authMiddleware(req, res, next) {
  try {
    const header = req.headers['authorization'];
    const token = header && header.startsWith('Bearer ') ? header.split(' ')[1] : (req.body?.token || req.query?.token);
    if (!token) return res.status(401).json({ error: 'No token' });
    const payload = verifyToken(token);
    if (!payload) return res.status(401).json({ error: 'Invalid token' });
    req.user = { id: payload.userId, email: payload.email };
    next();
  } catch (err) {
    console.error('auth middleware error', err && err.stack ? err.stack : err);
    return res.status(500).json({ error: 'Server error' });
  }
}

// Routes

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// SIGNUP - JSON or form
app.post('/signup', async (req, res) => {
  const { name, email, password } = req.body;
  const wantsJson = clientWantsJson(req);
  if (!name || !email || !password) {
    if (wantsJson) return res.status(400).json({ error: 'All fields required' });
    return res.status(400).send('All fields required');
  }
  try {
    const hashed = await bcrypt.hash(password, 10);
    const inserted = await pool.query('INSERT INTO users (name, email, password) VALUES ($1,$2,$3) RETURNING id, name, email', [name, email, hashed]);
    const user = inserted.rows[0];
    if (wantsJson) {
      const token = signToken(user);
      return res.json({ user, token });
    } else {
      return res.redirect('/login.html');
    }
  } catch (err) {
    console.error('signup error', err && err.stack ? err.stack : err);
    if (err.code === '23505') {
      if (wantsJson) return res.status(409).json({ error: 'Email already exists' });
      return res.status(409).send('Email already exists');
    }
    if (wantsJson) return res.status(500).json({ error: 'Server error' });
    return res.status(500).send('Server error');
  }
});

// LOGIN - JSON or form
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const wantsJson = clientWantsJson(req);
  if (!email || !password) {
    if (wantsJson) return res.status(400).json({ error: 'Email and password required' });
    return res.status(400).send('Email and password required');
  }
  try {
    const r = await pool.query('SELECT id, name, email, password FROM users WHERE email=$1', [email]);
    if (r.rowCount === 0) {
      if (wantsJson) return res.status(401).json({ error: 'Invalid credentials' });
      return res.status(401).send('Invalid credentials');
    }
    const user = r.rows[0];
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      if (wantsJson) return res.status(401).json({ error: 'Invalid credentials' });
      return res.status(401).send('Invalid credentials');
    }
    if (wantsJson) {
      const token = signToken(user);
      return res.json({ user: { id: user.id, name: user.name, email: user.email }, token });
    } else {
      return res.redirect('/dashboard.html');
    }
  } catch (err) {
    console.error('login error', err && err.stack ? err.stack : err);
    if (wantsJson) return res.status(500).json({ error: 'Server error' });
    return res.status(500).send('Server error');
  }
});

app.get('/me', authMiddleware, async (req, res) => {
  try {
    const r = await pool.query('SELECT id, name, email FROM users WHERE id=$1', [req.user.id]);
    if (r.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(r.rows[0]);
  } catch (err) {
    console.error('me error', err && err.stack ? err.stack : err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Search users by q (email or name)
app.get('/users/search', authMiddleware, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'q param required' });
  try {
    const emailResults = await pool.query('SELECT id, name, email FROM users WHERE email ILIKE $1 LIMIT 10', [`%${q}%`]);
    const nameResults = await pool.query('SELECT id, name, email FROM users WHERE name ILIKE $1 LIMIT 10', [`%${q}%`]);

    const combined = [...emailResults.rows, ...nameResults.rows];
    const uniqueUsers = Array.from(new Map(combined.map(user => [user.id, user])).values());

    res.json({ users: uniqueUsers });
  } catch (err) {
    console.error('search error', err && err.stack ? err.stack : err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Send friend request by receiverEmail
app.post('/friends/request', authMiddleware, async (req, res) => {
  const requesterId = req.user.id;
  const { receiverEmail } = req.body;
  if (!receiverEmail) return res.status(400).json({ error: 'receiverEmail required' });
  try {
    const r = await pool.query('SELECT id FROM users WHERE email=$1', [receiverEmail]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'User not found' });
    const receiverId = r.rows[0].id;
    if (receiverId === requesterId) return res.status(400).json({ error: 'Cannot friend yourself' });
    // Upsert into friend_requests to avoid 409s and make operation idempotent
    await pool.query(
      `INSERT INTO friend_requests (requester_id, receiver_id, status)
       VALUES ($1,$2,'pending')
       ON CONFLICT (requester_id, receiver_id)
       DO UPDATE SET status='pending'`,
      [requesterId, receiverId]
    );

    // Notify both parties
    try {
      io.to(`user:${receiverId}`).emit('friendUpdate');
      io.to(`user:${requesterId}`).emit('friendUpdate');
    } catch (e) { /* ignore */ }
    return res.json({ ok: true });
  } catch (err) {
    console.error('friend request error', err && err.stack ? err.stack : err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Respond to friend request (accept / reject). Body: { requestId, action }
app.post('/friends/respond', authMiddleware, async (req, res) => {
  // coerce & validate inputs immediately
  const userId = Number(req.user.id);
  const requestId = Number(req.body?.requestId);
  const action = (req.body?.action || '').toString();

  if (!Number.isFinite(requestId) || requestId <= 0) {
    return res.status(400).json({ error: 'invalid requestId' });
  }
  if (!Number.isFinite(userId) || userId <= 0) {
    return res.status(401).json({ error: 'invalid user' });
  }
  if (!action) return res.status(400).json({ error: 'requestId and action required' });
  if (!['accept', 'reject'].includes(action)) return res.status(400).json({ error: 'invalid action' });

  const client = await pool.connect();
  try {
    // make sure to pass integers into the query params
    const rq = await client.query('SELECT * FROM friend_requests WHERE id=$1 AND receiver_id=$2', [requestId, userId]);
    if (rq.rowCount === 0) {
      return res.status(404).json({ error: 'friend request not found' });
    }

    const requesterId = Number(rq.rows[0].requester_id);
    if (!Number.isFinite(requesterId)) {
      // defensive: unexpected DB state
      return res.status(500).json({ error: 'invalid requester id in DB' });
    }

    if (action === 'reject') {
      await client.query('UPDATE friend_requests SET status=$1 WHERE id=$2', ['rejected', requestId]);
      return res.json({ ok: true, status: 'rejected' });
    }

    // accept: mark accepted and create conversation if not exists
    await client.query('BEGIN');
    await client.query('UPDATE friend_requests SET status=$1 WHERE id=$2', ['accepted', requestId]);

    // find existing conversation (ordered pair) — ensure params are integers
    const convCheck = await client.query(
      `SELECT id FROM conversations
       WHERE LEAST(user_a, user_b) = LEAST($1::int,$2::int) AND GREATEST(user_a, user_b) = GREATEST($1::int,$2::int) LIMIT 1`,
      [requesterId, userId]
    );

    let conversationId;
    if (convCheck.rowCount > 0) {
      conversationId = convCheck.rows[0].id;
    } else {
      const conv = await client.query('INSERT INTO conversations (user_a, user_b) VALUES ($1,$2) RETURNING id', [requesterId, userId]);
      conversationId = conv.rows[0].id;
    }

    await client.query('COMMIT');

    // success — respond with conversation id if created/found
    try {
      io.to(`user:${requesterId}`).emit('friendUpdate');
      io.to(`user:${userId}`).emit('friendUpdate');
    } catch (e) { /* ignore */ }
    return res.json({ ok: true, status: 'accepted', conversationId });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    console.error('friends.respond error', err && err.stack ? err.stack : err);
    return res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// List incoming friend requests
app.get('/friends/requests', authMiddleware, async (req, res) => {
  const uid = req.user.id;
  try {
    const r = await pool.query(
      `SELECT fr.id, u.id as requester_id, u.name, u.email, fr.created_at
       FROM friend_requests fr
       JOIN users u ON u.id = fr.requester_id
       WHERE fr.receiver_id = $1 AND fr.status = 'pending' ORDER BY fr.created_at DESC`,
      [uid]
    );
    res.json({ requests: r.rows });
  } catch (err) {
    console.error('list requests error', err && err.stack ? err.stack : err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /friends/remove
app.post("/friends/remove", authMiddleware, async (req, res) => {
  const { friendId } = req.body;
  const userId = Number(req.user.id);
  const otherId = Number(friendId);

  if (!Number.isFinite(otherId)) return res.status(400).json({ error: "Missing friendId" });

  try {
    // Delete any pending friend_requests in either direction
    await pool.query(
      `DELETE FROM friend_requests WHERE (requester_id=$1 AND receiver_id=$2) OR (requester_id=$2 AND receiver_id=$1)`,
      [userId, otherId]
    );

    // Find the conversation between the two users
    const convoRes = await pool.query(
      `SELECT id FROM conversations 
       WHERE LEAST(user_a, user_b) = LEAST($1::int,$2::int) AND GREATEST(user_a, user_b) = GREATEST($1::int,$2::int)
       LIMIT 1`,
      [userId, otherId]
    );

    if (convoRes.rowCount > 0) {
      const convoId = convoRes.rows[0].id;
      // Defensive: delete messages explicitly, then conversation
      try { await pool.query(`DELETE FROM messages WHERE conversation_id = $1`, [convoId]); } catch (e) { /* ignore */ }
      await pool.query(`DELETE FROM conversations WHERE id = $1`, [convoId]);
    }

    // Notify both users via Socket.IO
    try {
      io.to(`user:${userId}`).emit('friendUpdate');
      io.to(`user:${otherId}`).emit('friendUpdate');
    } catch (e) { /* ignore */ }

    res.json({ success: true });
  } catch (err) {
    console.error("Remove friend + chat error:", err && err.stack ? err.stack : err);
    res.status(500).json({ error: "Internal server error" });
  }
});



// List user's 1:1 conversations and other participant info
app.get('/conversations', authMiddleware, async (req, res) => {
  const uid = req.user.id;
  try {
    const r = await pool.query(
      `SELECT c.id,
              CASE WHEN c.user_a = $1 THEN c.user_b ELSE c.user_a END AS other_user_id,
              u.name AS other_user_name, u.email AS other_user_email,
              c.created_at
       FROM conversations c
       JOIN users u ON u.id = CASE WHEN c.user_a = $1 THEN c.user_b ELSE c.user_a END
       WHERE c.user_a = $1 OR c.user_b = $1
       ORDER BY c.created_at DESC`,
      [uid]
    );
    res.json({ conversations: r.rows });
  } catch (err) {
    console.error('get conversations error', err && err.stack ? err.stack : err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Fetch messages for a conversation (newest first)
app.get('/conversations/:id/messages', authMiddleware, async (req, res) => {
  const convId = Number(req.params.id);
  const uid = req.user.id;
  const limit = Math.min(200, Number(req.query.limit || 50));
  try {
    const conv = await pool.query('SELECT * FROM conversations WHERE id=$1 AND (user_a=$2 OR user_b=$2)', [convId, uid]);
    if (conv.rowCount === 0) return res.status(403).json({ error: 'Not part of conversation' });

    const msgs = await pool.query(
      `SELECT id, sender_id, content, created_at
       FROM messages
       WHERE conversation_id=$1
       ORDER BY created_at DESC
       LIMIT $2`,
      [convId, limit]
    );
    res.json({ messages: msgs.rows });
  } catch (err) {
    console.error('fetch messages error', err && err.stack ? err.stack : err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Optional REST message post (socket is primary)
app.post('/conversations/:id/messages', authMiddleware, async (req, res) => {
  const convId = Number(req.params.id);
  const uid = req.user.id;
  const { content } = req.body;
  if (typeof content !== 'string' || content.trim() === '') return res.status(400).json({ error: 'content required' });

  try {
    const conv = await pool.query('SELECT * FROM conversations WHERE id=$1 AND (user_a=$2 OR user_b=$2)', [convId, uid]);
    if (conv.rowCount === 0) return res.status(403).json({ error: 'Not part of conversation' });

    const inserted = await pool.query('INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1,$2,$3) RETURNING id, created_at', [convId, uid, content]);
    const message = { id: inserted.rows[0].id, conversation_id: convId, sender_id: uid, content, created_at: inserted.rows[0].created_at };

    // broadcast to socket room
    io.to(`conversation:${convId}`).emit('message', message);

    return res.json({ message });
  } catch (err) {
    console.error('post message error', err && err.stack ? err.stack : err);
    res.status(500).json({ error: 'Server error' });
  }
});

// HTTP server + Socket.IO
const server = http.createServer(app);

// socket.io with permissive CORS for local dev
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// Socket auth via JWT in handshake.auth.token or Authorization header
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token || (socket.handshake.headers?.authorization ? socket.handshake.headers.authorization.split(' ')[1] : null);
    if (!token) return next(new Error('auth error: token missing'));
    const payload = verifyToken(token);
    if (!payload) return next(new Error('auth error: invalid token'));
    socket.userId = payload.userId;
    next();
  } catch (err) {
    console.error('socket auth error', err && err.stack ? err.stack : err);
    next(new Error('auth error'));
  }
});

io.on('connection', (socket) => {
  const uid = socket.userId;
  console.log(`socket connected ${socket.id} user ${uid}`);
  // Join a stable per-user room for targeted events
  try { socket.join(`user:${uid}`); } catch (e) { /* noop */ }

  // join conversation room
  socket.on('join', async ({ conversationId }) => {
    if (!conversationId) return;
    try {
      const conv = await pool.query('SELECT * FROM conversations WHERE id=$1 AND (user_a=$2 OR user_b=$2)', [conversationId, uid]);
      if (conv.rowCount === 0) {
        socket.emit('error', 'not in conversation');
        return;
      }
      socket.join(`conversation:${conversationId}`);
      socket.emit('joined', { conversationId });
    } catch (err) {
      console.error('join err', err && err.stack ? err.stack : err);
      socket.emit('error', 'join failed');
    }
  });

  // sendMessage
  socket.on('sendMessage', async ({ conversationId, content }) => {
    if (!conversationId || typeof content !== 'string' || content.trim() === '') {
      return socket.emit('error', 'invalid payload');
    }
    try {
      const conv = await pool.query('SELECT * FROM conversations WHERE id=$1 AND (user_a=$2 OR user_b=$2)', [conversationId, uid]);
      if (conv.rowCount === 0) {
        socket.emit('error', 'not in conversation');
        return;
      }

      const inserted = await pool.query('INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1,$2,$3) RETURNING id, created_at', [conversationId, uid, content]);

      const message = {
        id: inserted.rows[0].id,
        conversation_id: conversationId,
        sender_id: uid,
        content,
        created_at: inserted.rows[0].created_at
      };

      io.to(`conversation:${conversationId}`).emit('message', message);
    } catch (err) {
      console.error('socket sendMessage err', err && err.stack ? err.stack : err);
      socket.emit('error', 'send failed');
    }
  });

  socket.on('disconnect', () => {
    console.log(`socket disconnected ${socket.id}`);
  });
});

// Start server
server.listen(port, () => {
  console.log(`Server listening http://localhost:${port}`);
});

// catch unhandled rejections / exceptions for easier debugging in dev
process.on('unhandledRejection', (reason, p) => {
  console.error('Unhandled Rejection at Promise', p, 'reason:', reason && reason.stack ? reason.stack : reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception thrown', err && err.stack ? err.stack : err);
  // in production you might want to exit process; for dev we keep running for convenience
});
