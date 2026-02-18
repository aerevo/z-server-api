/**
 * Z-KINETIC AUTHORITY SERVER v3.0 - PRODUCTION
 * ============================================================
 * With SQLite Database - Data persists across restarts!
 * ============================================================
 */

const express = require('express');
const crypto  = require('crypto');
const rateLimit = require('express-rate-limit');
const cors    = require('cors');
const Database = require('better-sqlite3');
const path    = require('path');

const app = express();
app.use(express.json());
app.use(cors());

// ============================================================
// SQLITE DATABASE SETUP
// ============================================================

const dbPath = path.join(__dirname, 'zkinetic.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL'); // Better performance

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS clients (
    api_key           TEXT PRIMARY KEY,
    name              TEXT NOT NULL,
    plan              TEXT NOT NULL DEFAULT 'starter',
    status            TEXT NOT NULL DEFAULT 'active',
    created_at        INTEGER NOT NULL,
    expires_at        INTEGER,
    monthly_limit     INTEGER NOT NULL DEFAULT 5000,
    used_this_month   INTEGER NOT NULL DEFAULT 0,
    last_reset_month  TEXT NOT NULL,
    total_verifications INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS usage_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp  INTEGER NOT NULL,
    api_key    TEXT NOT NULL,
    action     TEXT NOT NULL,
    result     TEXT NOT NULL,
    details    TEXT,
    FOREIGN KEY (api_key) REFERENCES clients(api_key)
  );

  CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON usage_logs(timestamp);
  CREATE INDEX IF NOT EXISTS idx_usage_apikey ON usage_logs(api_key);
`);

console.log('âœ… Database initialized:', dbPath);

// Prepared statements for performance
const stmtGetClient = db.prepare('SELECT * FROM clients WHERE api_key = ?');
const stmtAddClient = db.prepare(`
  INSERT INTO clients (api_key, name, plan, status, created_at, expires_at, monthly_limit, used_this_month, last_reset_month, total_verifications)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const stmtUpdateClient = db.prepare(`
  UPDATE clients SET status = ?, expires_at = ?, used_this_month = ?, last_reset_month = ?, total_verifications = ?
  WHERE api_key = ?
`);
const stmtDeleteClient = db.prepare('DELETE FROM clients WHERE api_key = ?');
const stmtLogUsage = db.prepare(`
  INSERT INTO usage_logs (timestamp, api_key, action, result, details)
  VALUES (?, ?, ?, ?, ?)
`);

// ============================================================
// ADMIN PASSWORD
// ============================================================

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'zkinetic-admin-2026';

// ============================================================
// IN-MEMORY (TEMPORARY DATA)
// ============================================================

const activeChallenges = new Map(); // Challenges (expires in 60s)
const sessions         = new Map(); // Sessions (expires in 5min)

const stats = {
  totalChallenges         : 0,
  totalVerifications      : 0,
  successfulVerifications : 0,
  failedVerifications     : 0,
  blockedRequests         : 0,
  serverStartTime         : Date.now(),
};

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function generateApiKey() {
  return `zk_live_${crypto.randomBytes(16).toString('hex')}`;
}

function logUsage(apiKey, action, result, details = {}) {
  try {
    stmtLogUsage.run(
      Date.now(),
      apiKey || 'UNKNOWN',
      action,
      result,
      JSON.stringify(details)
    );
  } catch (err) {
    console.error('Log error:', err);
  }
}

function checkMonthlyReset(client) {
  const now       = new Date();
  const thisMonth = `${now.getFullYear()}-${now.getMonth()}`;
  if (client.last_reset_month !== thisMonth) {
    client.used_this_month  = 0;
    client.last_reset_month = thisMonth;
    // Update in database
    stmtUpdateClient.run(
      client.status,
      client.expires_at,
      0, // Reset usage
      thisMonth,
      client.total_verifications,
      client.api_key
    );
  }
}

// ============================================================
// MIDDLEWARE: VALIDATE API KEY
// ============================================================

function validateApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.body?.apiKey;

  if (!apiKey) {
    stats.blockedRequests++;
    return res.status(401).json({
      success : false,
      error   : 'Missing API Key',
      code    : 'NO_API_KEY',
    });
  }

  const client = stmtGetClient.get(apiKey);

  if (!client) {
    stats.blockedRequests++;
    logUsage(apiKey, 'challenge', 'BLOCKED', { reason: 'Invalid key' });
    return res.status(401).json({
      success : false,
      error   : 'Invalid API Key',
      code    : 'INVALID_KEY',
    });
  }

  // Check status
  if (client.status !== 'active') {
    stats.blockedRequests++;
    logUsage(apiKey, 'challenge', 'BLOCKED', { reason: `Status: ${client.status}` });
    return res.status(403).json({
      success : false,
      error   : `Account ${client.status}`,
      code    : 'ACCOUNT_' + client.status.toUpperCase(),
    });
  }

  // Check expiry
  if (client.expires_at && Date.now() > client.expires_at) {
    // Auto-mark as expired
    stmtUpdateClient.run('expired', client.expires_at, client.used_this_month, client.last_reset_month, client.total_verifications, client.api_key);
    stats.blockedRequests++;
    return res.status(403).json({
      success : false,
      error   : 'Subscription expired',
      code    : 'SUBSCRIPTION_EXPIRED',
    });
  }

  // Check monthly limit
  checkMonthlyReset(client);
  if (client.monthly_limit > 0 && client.used_this_month >= client.monthly_limit) {
    stats.blockedRequests++;
    return res.status(429).json({
      success : false,
      error   : 'Monthly limit reached',
      code    : 'LIMIT_REACHED',
      used    : client.used_this_month,
      limit   : client.monthly_limit,
    });
  }

  req.client = client;
  next();
}

// ============================================================
// MIDDLEWARE: VALIDATE ADMIN
// ============================================================

function validateAdmin(req, res, next) {
  const password = req.headers['x-admin-password'] || req.body?.adminPassword;
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, error: 'Invalid admin password' });
  }
  next();
}

// ============================================================
// AUTO-CLEANUP
// ============================================================

setInterval(() => {
  const now = Date.now();
  let deletedChallenges = 0;
  let deletedSessions   = 0;

  for (const [nonce, data] of activeChallenges.entries()) {
    if (data.expiry < now) { activeChallenges.delete(nonce); deletedChallenges++; }
  }
  for (const [token, data] of sessions.entries()) {
    if (data.expiry < now) { sessions.delete(token); deletedSessions++; }
  }

  if (deletedChallenges > 0 || deletedSessions > 0) {
    console.log(`ðŸ§¹ Cleanup: ${deletedChallenges} challenges, ${deletedSessions} sessions`);
  }
}, 60 * 1000);

// ============================================================
// RATE LIMITING
// ============================================================

const challengeLimiter = rateLimit({ windowMs: 60 * 1000, max: 30 });
const verifyLimiter    = rateLimit({ windowMs: 60 * 1000, max: 30 });
const adminLimiter     = rateLimit({ windowMs: 60 * 1000, max: 60 });

// ============================================================
// API ENDPOINTS
// ============================================================

app.post('/api/v1/challenge', challengeLimiter, validateApiKey, (req, res) => {
  try {
    const client = req.client;
    const secretCode = Array.from({ length: 3 }, () => Math.floor(Math.random() * 10));
    const nonce      = crypto.randomBytes(16).toString('hex');
    const now        = Date.now();
    const expiry     = now + 60000;

    activeChallenges.set(nonce, {
      code       : secretCode,
      expiry,
      used       : false,
      createdAt  : now,
      apiKey     : client.api_key,
      clientName : client.name,
    });

    stats.totalChallenges++;
    console.log(`ðŸ”‘ [${client.name}] Challenge: ${secretCode.join('-')}`);

    res.json({ success: true, nonce, challengeCode: secretCode, expiry });
  } catch (error) {
    console.error('âŒ challenge error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.post('/api/v1/verify', verifyLimiter, validateApiKey, (req, res) => {
  try {
    const { nonce, userResponse, biometricData } = req.body;
    const client = req.client;

    if (!nonce || !userResponse || !biometricData) {
      return res.status(400).json({ success: false, error: 'Missing fields' });
    }

    const challengeData = activeChallenges.get(nonce);
    if (!challengeData) {
      return res.status(403).json({ success: false, error: 'Invalid or expired nonce' });
    }
    if (challengeData.apiKey !== client.api_key) {
      return res.status(403).json({ success: false, error: 'API key mismatch' });
    }
    if (challengeData.used) {
      stats.failedVerifications++;
      return res.status(403).json({ success: false, error: 'Nonce already used' });
    }

    const now = Date.now();
    if (challengeData.expiry < now) {
      activeChallenges.delete(nonce);
      stats.failedVerifications++;
      return res.status(403).json({ success: false, error: 'Challenge expired' });
    }

    challengeData.used = true;
    activeChallenges.delete(nonce);

    const serverCode = challengeData.code.join('');
    const userCode   = Array.isArray(userResponse) ? userResponse.join('') : '';

    const { motion = 0, touch = 0, pattern = 0 } = biometricData || {};
    const motionOK  = motion  > 0.15;
    const touchOK   = touch   > 0.15;
    const patternOK = pattern > 0.10;
    const sensorsActive = [motionOK, touchOK, patternOK].filter(Boolean).length;
    const codeMatch = userCode === serverCode;

    if (!motionOK) console.log(`âš ï¸  [${client.name}] Suspicious: No motion`);

    if (codeMatch && sensorsActive >= 1) {
      // âœ… SUCCESS
      const avgScore  = (motion + touch + pattern) / 3;
      const riskScore = avgScore > 0.7 ? 'LOW' : avgScore > 0.4 ? 'MEDIUM' : 'HIGH';

      checkMonthlyReset(client);

      // Update database
      stmtUpdateClient.run(
        client.status,
        client.expires_at,
        client.used_this_month + 1,
        client.last_reset_month,
        client.total_verifications + 1,
        client.api_key
      );

      stats.totalVerifications++;
      stats.successfulVerifications++;
      logUsage(client.api_key, 'verify', 'SUCCESS', { clientName: client.name, riskScore });

      console.log(`âœ… HUMAN VERIFIED | [${client.name}] | Risk=${riskScore} | Monthly=${client.used_this_month + 1}/${client.monthly_limit || 'âˆž'}`);

      return res.json({ success: true, allowed: true, riskScore, clientName: client.name });

    } else {
      // âŒ FAILED
      const reasons = [];
      if (!codeMatch)   reasons.push('Wrong code');
      if (!motionOK)    reasons.push('No motion');
      if (!touchOK)     reasons.push('No touch');
      if (!patternOK)   reasons.push('No pattern');

      stats.totalVerifications++;
      stats.failedVerifications++;
      logUsage(client.api_key, 'verify', 'FAILED', { clientName: client.name, reasons });

      console.log(`âŒ FAILED | [${client.name}] | ${reasons.join(', ')}`);

      return res.status(401).json({ success: false, allowed: false, error: 'Verification failed', reasons });
    }

  } catch (error) {
    console.error('âŒ verify error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// ADMIN ENDPOINTS
// ============================================================

app.get('/admin/clients', adminLimiter, validateAdmin, (req, res) => {
  const clients = db.prepare('SELECT * FROM clients ORDER BY created_at DESC').all();
  clients.forEach(c => {
    checkMonthlyReset(c);
    c.daysLeft = c.expires_at ? Math.max(0, Math.ceil((c.expires_at - Date.now()) / 86400000)) : null;
  });
  res.json({ success: true, total: clients.length, clients });
});

app.post('/admin/clients/add', adminLimiter, validateAdmin, (req, res) => {
  try {
    const { name, plan, monthlyLimit, durationDays } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'name required' });

    const PLANS = {
      starter   : 5000,
      business  : 20000,
      enterprise: 100000,
      unlimited : 0,
    };

    const apiKey    = generateApiKey();
    const now       = Date.now();
    const days      = durationDays || 30;
    const now_date  = new Date();
    const thisMonth = `${now_date.getFullYear()}-${now_date.getMonth()}`;

    stmtAddClient.run(
      apiKey,
      name,
      plan || 'starter',
      'active',
      now,
      now + (days * 86400000),
      monthlyLimit || PLANS[plan] || 5000,
      0,
      thisMonth,
      0
    );

    console.log(`âž• NEW CLIENT: ${name} | Plan: ${plan} | Key: ${apiKey.substring(0, 20)}...`);

    res.json({
      success      : true,
      message      : `Client "${name}" created!`,
      apiKey,
      plan         : plan || 'starter',
      monthlyLimit : monthlyLimit || PLANS[plan] || 5000,
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/admin/clients/block', adminLimiter, validateAdmin, (req, res) => {
  const { apiKey } = req.body;
  const client = stmtGetClient.get(apiKey);
  if (!client) return res.status(404).json({ success: false, error: 'Client not found' });
  
  stmtUpdateClient.run('blocked', client.expires_at, client.used_this_month, client.last_reset_month, client.total_verifications, apiKey);
  console.log(`ðŸš« BLOCKED: ${client.name}`);
  res.json({ success: true, message: `Client "${client.name}" blocked.` });
});

app.post('/admin/clients/unblock', adminLimiter, validateAdmin, (req, res) => {
  const { apiKey } = req.body;
  const client = stmtGetClient.get(apiKey);
  if (!client) return res.status(404).json({ success: false, error: 'Client not found' });
  
  stmtUpdateClient.run('active', client.expires_at, client.used_this_month, client.last_reset_month, client.total_verifications, apiKey);
  console.log(`âœ… UNBLOCKED: ${client.name}`);
  res.json({ success: true, message: `Client "${client.name}" unblocked.` });
});

app.post('/admin/clients/renew', adminLimiter, validateAdmin, (req, res) => {
  const { apiKey, durationDays } = req.body;
  const client = stmtGetClient.get(apiKey);
  if (!client) return res.status(404).json({ success: false, error: 'Client not found' });

  const days     = durationDays || 30;
  const now      = Date.now();
  const baseTime = client.expires_at > now ? client.expires_at : now;
  const newExpiry = baseTime + (days * 86400000);

  stmtUpdateClient.run('active', newExpiry, client.used_this_month, client.last_reset_month, client.total_verifications, apiKey);

  console.log(`ðŸ”„ RENEWED: ${client.name} | +${days} days`);
  res.json({
    success   : true,
    message   : `Client "${client.name}" renewed for ${days} days.`,
    newExpiry,
    daysLeft  : Math.ceil((newExpiry - now) / 86400000),
  });
});

app.post('/admin/clients/delete', adminLimiter, validateAdmin, (req, res) => {
  const { apiKey } = req.body;
  const client = stmtGetClient.get(apiKey);
  if (!client) return res.status(404).json({ success: false, error: 'Client not found' });

  stmtDeleteClient.run(apiKey);
  console.log(`ðŸ—‘ï¸  DELETED: ${client.name}`);
  res.json({ success: true, message: `Client "${client.name}" deleted.` });
});

app.get('/admin/logs', adminLimiter, validateAdmin, (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const logs  = db.prepare('SELECT * FROM usage_logs ORDER BY timestamp DESC LIMIT ?').all(limit);
  res.json({ success: true, total: logs.length, logs });
});

app.get('/admin/stats', adminLimiter, validateAdmin, (req, res) => {
  const now           = Date.now();
  const clients       = db.prepare('SELECT * FROM clients').all();
  const activeClients = clients.filter(c => c.status === 'active').length;
  const expired       = clients.filter(c => c.status === 'expired' || (c.expires_at && c.expires_at < now)).length;
  const blocked       = clients.filter(c => c.status === 'blocked').length;
  const totalUsage    = clients.reduce((sum, c) => sum + c.used_this_month, 0);

  res.json({
    success: true,
    server : { uptime: Math.floor((now - stats.serverStartTime) / 1000), version: '3.0.0' },
    clients: { total: clients.length, active: activeClients, expired, blocked },
    verifications: {
      total      : stats.totalVerifications,
      successful : stats.successfulVerifications,
      failed     : stats.failedVerifications,
      blocked    : stats.blockedRequests,
    },
    usageThisMonth: totalUsage,
  });
});

// ============================================================
// HEALTH CHECK
// ============================================================

app.get('/health', (req, res) => {
  res.json({
    status   : 'OK',
    server   : 'Z-Kinetic Authority v3.0',
    uptime   : Math.floor((Date.now() - stats.serverStartTime) / 1000),
    clients  : db.prepare('SELECT COUNT(*) as count FROM clients').get().count,
    database : 'SQLite (persistent)',
  });
});

// ============================================================
// START SERVER
// ============================================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log('============================================================');
  console.log('ðŸš€ Z-KINETIC AUTHORITY SERVER v3.0 (PRODUCTION)');
  console.log('============================================================');
  console.log(`ðŸ“¡ Server   : http://localhost:${PORT}`);
  console.log(`ðŸ’¾ Database : ${dbPath}`);
  console.log(`ðŸ”§ Health   : http://localhost:${PORT}/health`);
  console.log(`ðŸ“Š Stats    : http://localhost:${PORT}/admin/stats`);
  console.log('============================================================');
  console.log('ðŸ”‘ Admin endpoints: x-admin-password header');
  console.log('ðŸ” SDK endpoints  : x-api-key header');
  console.log('============================================================');
});
