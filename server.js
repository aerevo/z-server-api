/**
 * Z-KINETIC AUTHORITY SERVER - SECURE MODE
 * Production-ready Express.js with Server-Side Challenge
 * 
 * Features:
 * - Server-side challenge generation (Simon Says)
 * - Nonce generation (anti-replay)
 * - Session management (stateless)
 * - Panic mode detection (reverse code)
 * - Risk scoring (biometric analysis)
 * - Rate limiting (abuse prevention)
 * - Auto-cleanup (memory management)
 * 
 * Deploy to: Render.com (FREE tier)
 * Keep-alive: UptimeRobot (external, FREE)
 */

const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// ============================================
// IN-MEMORY STORAGE
// ============================================

const activeChallenges = new Map(); // Server-generated challenges
const sessions = new Map();

const stats = {
  totalChallenges: 0,
  totalAttestations: 0,
  successfulAttestations: 0,
  failedAttestations: 0,
  panicModeActivations: 0,
  totalVerifications: 0,
  serverStartTime: Date.now(),
};

// ============================================
// AUTO-CLEANUP (Every minute)
// ============================================

setInterval(() => {
  const now = Date.now();
  let deletedChallenges = 0;
  let deletedSessions = 0;
  
  // Clean expired challenges
  for (const [nonce, data] of activeChallenges.entries()) {
    if (data.expiry < now) {
      activeChallenges.delete(nonce);
      deletedChallenges++;
    }
  }
  
  // Clean expired sessions
  for (const [token, data] of sessions.entries()) {
    if (data.expiry < now) {
      sessions.delete(token);
      deletedSessions++;
    }
  }
  
  if (deletedChallenges > 0 || deletedSessions > 0) {
    console.log(`🧹 Cleanup: ${deletedChallenges} challenges, ${deletedSessions} sessions deleted`);
  }
}, 60 * 1000);

// ============================================
// RATE LIMITING
// ============================================

const challengeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many challenge requests' },
});

const attestLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Too many attestation requests' },
});

const verifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Too many verification requests' },
});

// ============================================
// ENDPOINT 1: GET CHALLENGE (Server-Side Generation!)
// ============================================

app.post('/getChallenge', challengeLimiter, (req, res) => {
  try {
    // 1. Generate 5-digit random code (0-9)
    const secretCode = Array.from({length: 3}, () => Math.floor(Math.random() * 10));
    
    // 2. Generate unique nonce
    const nonce = crypto.randomBytes(16).toString('hex');
    const now = Date.now();
    const expiry = now + (60 * 1000); // 60 seconds TTL
    
    // 3. Store challenge on server (Server holds the answer!)
    activeChallenges.set(nonce, {
      code: secretCode,
      expiry: expiry,
      used: false,
      createdAt: now,
    });
    
    stats.totalChallenges++;
    
    console.log(`🔑 Challenge Generated: ${nonce.substring(0, 16)}... | Code: ${secretCode.join('')}`);
    
    // 4. Send challenge to app (App only displays, cannot modify!)
    res.json({
      success: true,
      nonce: nonce,
      challengeCode: secretCode,
      expiry: expiry,
      serverTime: now,
    });
    
  } catch (error) {
    console.error('❌ getChallenge error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// ============================================
// ENDPOINT 2: ATTEST (Verify User Response)
// ============================================

app.post('/attest', attestLimiter, (req, res) => {
  try {
    const { nonce, deviceId, userResponse, biometricData } = req.body;
    
    // A. Validate required fields
    if (!nonce || !deviceId || !userResponse || !biometricData) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
      });
    }
    
    // B. Retrieve challenge from server
    const challengeData = activeChallenges.get(nonce);
    
    if (!challengeData) {
      return res.status(403).json({
        success: false,
        error: 'Invalid or expired nonce',
      });
    }
    
    // C. Check if already used (prevent replay attacks)
    if (challengeData.used) {
      console.log(`🚨 REPLAY ATTACK detected: ${nonce.substring(0, 16)}...`);
      stats.failedAttestations++;
      return res.status(403).json({
        success: false,
        error: 'Nonce already used (replay attack detected)',
      });
    }
    
    // D. Check expiry
    const now = Date.now();
    if (challengeData.expiry < now) {
      activeChallenges.delete(nonce);
      stats.failedAttestations++;
      return res.status(403).json({
        success: false,
        error: 'Challenge expired',
      });
    }
    
    // E. Mark as used (one-time use)
    challengeData.used = true;
    activeChallenges.delete(nonce);
    
    // F. Prepare codes for comparison
    const serverCode = challengeData.code.join('');
    const userCode = Array.isArray(userResponse) ? userResponse.join('') : '';
    const panicCode = challengeData.code.slice().reverse().join('');
    
    console.log(`📡 Attestation: ${deviceId}`);
    console.log(`   Expected: ${serverCode} | Got: ${userCode}`);
    
    // G. PANIC MODE CHECK (Reverse code)
    if (userCode === panicCode) {
      const panicToken = `DURESS_${crypto.randomBytes(24).toString('hex')}`;
      stats.panicModeActivations++;
      
      console.log(`🚨 PANIC MODE TRIGGERED!`);
      
      return res.json({
        success: true,
        sessionToken: panicToken,
        verdict: 'APPROVED_SILENT_ALARM',
        riskScore: 'CRITICAL',
      });
    }
    
    // H. NORMAL MODE CHECK
    const codeMatch = userCode === serverCode;
    const { motion, touch, pattern } = biometricData || {};
    
    // Validate biometric data types
    if (typeof motion !== 'number' || typeof touch !== 'number' || typeof pattern !== 'number') {
      stats.failedAttestations++;
      return res.status(400).json({
        success: false,
        error: 'Invalid biometric data format',
      });
    }
    
    // Biometric thresholds
    const motionOK = motion > 0.15;
    const touchOK = touch > 0.15;
    const patternOK = pattern > 0.10;
    const sensorsActive = [motionOK, touchOK, patternOK].filter(Boolean).length;
    
    // I. Final verification
    if (codeMatch && sensorsActive >= 2) {
      const validToken = `VALID_${crypto.randomBytes(24).toString('hex')}`;
      const tokenExpiry = now + (5 * 60 * 1000); // 5 minutes
      
      // Calculate risk score
      const avgScore = (motion + touch + pattern) / 3;
      let riskScore;
      if (avgScore > 0.7) riskScore = 'LOW';
      else if (avgScore > 0.4) riskScore = 'MEDIUM';
      else riskScore = 'HIGH';
      
      // Store session
      sessions.set(validToken, {
        deviceId: deviceId,
        status: 'VERIFIED',
        riskScore: riskScore,
        biometricScores: { motion, touch, pattern },
        expiry: tokenExpiry,
        createdAt: now,
        nonce: nonce,
      });
      
      stats.totalAttestations++;
      stats.successfulAttestations++;
      
      console.log(`✅ ACCESS GRANTED | Token=${validToken.substring(0, 16)}..., Risk=${riskScore}`);
      
      return res.json({
        success: true,
        sessionToken: validToken,
        verdict: 'APPROVED',
        riskScore: riskScore,
        expiry: tokenExpiry,
      });
      
    } else {
      // J. Verification failed
      const reasons = [];
      if (!codeMatch) reasons.push('Wrong code');
      if (!motionOK) reasons.push('No motion');
      if (!touchOK) reasons.push('No touch');
      if (!patternOK) reasons.push('No pattern');
      
      console.log(`❌ ACCESS DENIED: ${reasons.join(', ')}`);
      stats.failedAttestations++;
      
      return res.status(401).json({
        success: false,
        error: 'Verification failed',
        reasons: reasons,
      });
    }
    
  } catch (error) {
    console.error('❌ attest error:', error);
    stats.failedAttestations++;
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// ============================================
// ENDPOINT 3: VERIFY SESSION TOKEN
// ============================================

app.post('/verify', verifyLimiter, (req, res) => {
  try {
    const { sessionToken } = req.body;
    
    if (!sessionToken) {
      return res.status(400).json({
        valid: false,
        error: 'Missing sessionToken',
      });
    }
    
    const session = sessions.get(sessionToken);
    
    if (!session) {
      stats.totalVerifications++;
      return res.json({
        valid: false,
        status: 'INVALID',
      });
    }
    
    const now = Date.now();
    if (session.expiry < now) {
      sessions.delete(sessionToken);
      stats.totalVerifications++;
      return res.json({
        valid: false,
        status: 'EXPIRED',
      });
    }
    
    console.log(`✅ Token VERIFIED: Risk=${session.riskScore}`);
    stats.totalVerifications++;
    
    res.json({
      valid: true,
      status: 'VALID',
      riskScore: session.riskScore,
      deviceId: session.deviceId,
      verifiedAt: session.createdAt,
      expiresAt: session.expiry,
    });
    
  } catch (error) {
    console.error('❌ verify error:', error);
    res.status(500).json({
      valid: false,
      error: 'Internal server error',
    });
  }
});

// ============================================
// HEALTH CHECK
// ============================================

app.get('/health', (req, res) => {
  const now = Date.now();
  const uptime = now - stats.serverStartTime;
  
  res.json({
    status: 'OK',
    server: 'Z-Kinetic Authority (Secure Mode)',
    version: '2.0.0',
    timestamp: now,
    uptime: uptime,
    storage: {
      activeChallenges: activeChallenges.size,
      sessions: sessions.size,
    },
    stats: stats,
  });
});

// ============================================
// DOCS
// ============================================

app.get('/docs', (req, res) => {
  res.json({
    name: 'Z-Kinetic Authority API (Secure)',
    version: '2.0.0',
    endpoints: [
      {
        path: '/getChallenge',
        method: 'POST',
        description: 'Generate server-side challenge code',
        response: {
          nonce: 'string',
          challengeCode: '[number]',
          expiry: 'timestamp',
        },
      },
      {
        path: '/attest',
        method: 'POST',
        description: 'Verify user response and biometric data',
        body: {
          nonce: 'string',
          deviceId: 'string',
          userResponse: '[number]',
          biometricData: { motion: 'number', touch: 'number', pattern: 'number' },
        },
        response: {
          sessionToken: 'string',
          verdict: 'APPROVED | APPROVED_SILENT_ALARM',
          riskScore: 'LOW | MEDIUM | HIGH | CRITICAL',
        },
      },
      {
        path: '/verify',
        method: 'POST',
        description: 'Validate session token',
        body: {
          sessionToken: 'string',
        },
        response: {
          valid: 'boolean',
          status: 'VALID | INVALID | EXPIRED',
        },
      },
    ],
  });
});

// ============================================
// START SERVER
// ============================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log('═══════════════════════════════════════════');
  console.log('  Z-KINETIC AUTHORITY SERVER (SECURE)');
  console.log('═══════════════════════════════════════════');
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🌐 Health: http://localhost:${PORT}/health`);
  console.log(`📚 Docs: http://localhost:${PORT}/docs`);
  console.log('═══════════════════════════════════════════');
});
