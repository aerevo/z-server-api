const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// DATABASE MEMORY (Hilang bila restart - OK untuk Demo/Free Tier)
let challenges = {}; 
let sessions = {};

// 1. HEALTH CHECK (Wajib untuk Keep-Alive 10 minit Captain)
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'OK', 
        server: 'Z-Kinetic Render Node', 
        time: new Date().toISOString() 
    });
});

// 2. GET CHALLENGE (Minta Nonce)
app.post('/getChallenge', (req, res) => {
    const nonce = crypto.randomBytes(32).toString('hex');
    const expiry = Date.now() + 60000; // 60 saat
    
    challenges[nonce] = { expiry: expiry, used: false };
    
    // Cuci challenge lama sikit
    const now = Date.now();
    Object.keys(challenges).forEach(k => {
        if (challenges[k].expiry < now) delete challenges[k];
    });

    console.log(`✅ Nonce: ${nonce.substring(0, 10)}...`);
    res.json({ success: true, nonce: nonce });
});

// 3. ATTEST (Sahkan Biometrik)
app.post('/attest', (req, res) => {
    const { nonce, biometricData, deviceId } = req.body;
    
    // Check Nonce
    if (!challenges[nonce] || challenges[nonce].used) {
        return res.status(400).json({ error: "Invalid/Expired nonce" });
    }
    challenges[nonce].used = true;

    // Logic Biometrik Mudah
    const { motion, touch, pattern } = biometricData || { motion: 0, touch: 0, pattern: 0 };
    const avg = (motion + touch + pattern) / 3;
    
    // Tolak kalau skor terlalu rendah (Bot)
    if (avg < 0.1) {
        return res.status(403).json({ error: "Bot detected" });
    }

    // Issue Token
    const token = crypto.randomBytes(32).toString('hex');
    sessions[token] = {
        deviceId,
        riskScore: avg > 0.7 ? "LOW" : "MEDIUM",
        expiry: Date.now() + 300000 // 5 minit
    };

    console.log(`✅ Attest OK: ${deviceId} (Score: ${avg.toFixed(2)})`);
    res.json({ success: true, sessionToken: token });
});

// START SERVER
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server Z-Kinetic live on port ${PORT}`);
});
