/**
 * Z-KINETIC AUTHORITY SERVER
 * Production-ready Express.js implementation
 */
const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Limit spam (100 request per 15 minit)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 100 
});
app.use(limiter);

// STORAGE
const nonces = new Map();
const sessions = new Map();

// AUTO-CLEANUP (Setiap 5 minit buang data lama)
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of nonces.entries()) {
    if (value.expiry < now) nonces.delete(key);
  }
  for (const [key, value] of sessions.entries()) {
    if (value.expiry < now) sessions.delete(key);
  }
}, 5 * 60 * 1000);

// 1. HEALTH CHECK (Untuk UptimeRobot)
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    server: 'Z-Kinetic Authority',
    uptime: process.uptime()
  });
});

// 2. GENERATE NONCE (Cegah Replay Attack)
app.post('/getChallenge', (req, res) => {
  const nonce = crypto.randomBytes(16).toString('hex');
  const expiry = Date.now() + 60000; // 60 saat hayat
  nonces.set(nonce, { expiry, used: false });
  res.json({ success: true, nonce });
});

// 3. ATTESTATION (Hakim Menjatuhkan Hukuman)
app.post('/attest', (req, res) => {
  const { nonce, deviceId, biometricData } = req.body;

  // Check Nonce
  if (!nonces.has(nonce)) return res.status(400).json({ error: "Invalid Nonce" });
  const nonceData = nonces.get(nonce);
  if (nonceData.used) return res.status(403).json({ error: "Replay Attack!" });
  
  nonceData.used = true; // Matikan nonce

  // Check Data (Logic Mudah)
  if (!biometricData || biometricData.length === 0) {
     return res.status(403).json({ error: "No Data" });
  }

  // LULUS
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, {
    deviceId,
    expiry: Date.now() + (5 * 60 * 1000) // 5 minit
  });

  res.json({ success: true, sessionToken: token, riskScore: 0.1 });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server Z-Kinetic Authority running on port ${PORT}`);
});
