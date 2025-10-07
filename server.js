require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const path = require('path');

const app = express();
const port = 5000; // backend running on 5000

// ------------------------
// MIDDLEWARE
// ------------------------
app.use(bodyParser.urlencoded({ extended: true })); // for form submission
app.use(bodyParser.json());

// Serve static files (HTML, CSS, JS, images) from 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// ------------------------
// POSTGRESQL CONNECTION
// ------------------------
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// Create 'users' table if it doesn't exist
// Create 'users' table if it doesn't exist
pool.query(`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL
  );
`, async (err, res) => {
  if (err) console.error('Error creating users table', err);
  else {
    console.log('Users table is ready');

    // Fetch all users and display them
    try {
      const result = await pool.query('SELECT id, name, email FROM users ORDER BY id ASC');
      console.log('Existing users in the table:');
      console.table(result.rows); // logs in a nice table format
    } catch (fetchError) {
      console.error('Error fetching users', fetchError);
    }
  }
});


// Test DB connection route
app.get('/test-db', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ message: 'DB connection successful!', time: result.rows[0] });
  } catch (error) {
    console.error('DB connection error', error);
    res.status(500).json({ error: 'Database connection failed' });
  }
});

// ------------------------
// ROUTES
// ------------------------

// Serve main page (index.html)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// SIGNUP - normal form submission
app.post('/signup', async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).send('All fields are required');
  }

  try {
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user into DB
    await pool.query(
      'INSERT INTO users (name, email, password) VALUES ($1, $2, $3)',
      [name, email, hashedPassword]
    );

    // Redirect to login page after signup
    res.redirect('/login');
  } catch (error) {
    console.error('Error during signup', error);
    if (error.code === '23505') { // Unique email violation
      return res.status(409).send('Email already exists');
    }
    res.status(500).send('Server error');
  }
});

// LOGIN - normal form submission
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) return res.status(400).send('Email and password are required');

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    if (!user) return res.status(401).send('Invalid credentials');

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) return res.status(401).send('Invalid credentials');

    // Redirect to dashboard/homepage after login
    res.redirect('/dashboard.html');
  } catch (error) {
    console.error('Error during login', error);
    res.status(500).send('Server error');
  }
});

// ------------------------
// START SERVER
// ------------------------
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
