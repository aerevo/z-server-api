# 🚀 PANDUAN DEPLOY KE RENDER.COM

============================================================
STEP-BY-STEP GUIDE - DARI MULA HINGGA SIAP
============================================================

## PREP WORK (5 minit)

### 1. BUAT AKAUN RENDER.COM

→ Pergi: https://render.com
→ Klik "Get Started"
→ Sign up dengan GitHub (RECOMMENDED) atau Email
→ Free tier - no credit card needed!

### 2. SETUP GITHUB REPO

Pilih salah satu:

OPTION A - Guna z-server-api sedia ada:
```bash
cd ~/z-server-api
# Copy fail-fail baru ke sini
cp /path/to/server_production.js ./server.js
cp /path/to/package.json ./package.json
cp /path/to/.gitignore ./

# Commit & push
git add .
git commit -m "Add SQLite database + API key system"
git push origin main
```

OPTION B - Buat repo baru:
```bash
# Dari phone/Termux
cd ~
mkdir z-kinetic-production
cd z-kinetic-production

# Copy 3 fail penting
cp /path/to/server_production.js ./server.js
cp /path/to/package.json ./
cp /path/to/.gitignore ./

# Init git
git init
git add .
git commit -m "Initial commit - Z-Kinetic Authority Server v3.0"

# Push ke GitHub (kena buat repo dulu di github.com)
git remote add origin https://github.com/YOUR_USERNAME/z-kinetic-production.git
git branch -M main
git push -u origin main
```

============================================================
## DEPLOY KE RENDER (10 minit)
============================================================

### STEP 1: CREATE NEW WEB SERVICE

1. Login ke Render Dashboard: https://dashboard.render.com
2. Klik **"New +"** (top right)
3. Pilih **"Web Service"**

### STEP 2: CONNECT GITHUB REPO

1. Kalau first time, klik "Connect GitHub"
2. Authorize Render untuk access GitHub
3. Pilih repo: **z-server-api** atau **z-kinetic-production**
4. Klik "Connect"

### STEP 3: CONFIGURE SERVICE

Isi maklumat ini:

```
Name: z-kinetic-api
     (atau nama lain yang Captain suka)

Region: Singapore
     (pilih yang dekat dengan Captain)

Branch: main
     (atau master, ikut nama branch)

Root Directory: (leave blank)

Runtime: Node

Build Command: npm install

Start Command: npm start

Instance Type: Free
     (cukup untuk start!)
```

### STEP 4: ENVIRONMENT VARIABLES (OPTIONAL)

Klik "Add Environment Variable"

```
Key: ADMIN_PASSWORD
Value: <password-captain-sendiri-yang-kuat>

Key: PORT
Value: 3000
     (Render auto-set, tapi tambah untuk safety)
```

### STEP 5: CREATE WEB SERVICE

1. Klik "Create Web Service" (button bawah)
2. Tunggu deploy (3-5 minit)
3. Nampak logs building...
4. Bila siap, status jadi "Live" 🟢

### STEP 6: GET YOUR URL

Render akan bagi URL macam ni:
```
https://z-kinetic-api.onrender.com
```

atau
```
https://z-kinetic-api-abcd123.onrender.com
```

**COPY URL NI!** Ini URL tetap Captain untuk SDK!

============================================================
## TEST SERVER DEPLOYMENT
============================================================

### Test 1: Health Check

```bash
curl https://YOUR-URL.onrender.com/health
```

Should return:
```json
{
  "status": "OK",
  "server": "Z-Kinetic Authority v3.0",
  "uptime": 123,
  "clients": 0,
  "database": "SQLite (persistent)"
}
```

### Test 2: Add First Client

```bash
curl -X POST https://YOUR-URL.onrender.com/admin/clients/add \
  -H "x-admin-password: YOUR_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Client",
    "plan": "starter",
    "durationDays": 30
  }'
```

Should return API Key:
```json
{
  "success": true,
  "apiKey": "zk_live_abc123...",
  "plan": "starter",
  "monthlyLimit": 5000
}
```

### Test 3: List Clients

```bash
curl https://YOUR-URL.onrender.com/admin/clients \
  -H "x-admin-password: YOUR_PASSWORD"
```

============================================================
## UPDATE SDK DENGAN URL BARU
============================================================

Sekarang update SDK Captain dengan URL tetap!

### File: z_kinetic_sdk.dart

```dart
class WidgetController {
  // ✅ URL TETAP dari Render.com!
  static const String _serverUrl = 'https://YOUR-URL.onrender.com';
  
  // Rest of code...
}
```

**GANTI `YOUR-URL` dengan URL sebenar dari Render!**

Save, rebuild app, SIAP! 🎉

============================================================
## IMPORTANT NOTES
============================================================

### 📊 Free Tier Limits:
- 750 hours/month (cukup untuk 24/7!)
- Auto-sleep after 15 min idle
- First request lepas sleep ambik 30-60 saat
- Unlimited bandwidth

### 🔄 Auto-Deploy:
Every time Captain push ke GitHub, Render auto-deploy!
```bash
git add .
git commit -m "Update server"
git push
# Render auto-detect & redeploy!
```

### 💾 Database Persistence:
SQLite file (`zkinetic.db`) akan persist!
Data tak hilang bila redeploy.

### 🚨 Cold Start Issue:
Free tier sleep after 15 min idle.
Solution nanti:
1. Upgrade ke paid ($7/month - no sleep)
2. Atau guna UptimeRobot ping every 14 min

### 📈 Monitoring:
Render Dashboard shows:
- Logs (real-time)
- Metrics (CPU, Memory)
- Deploy history
- Health status

============================================================
## TROUBLESHOOTING
============================================================

### ❌ Build Failed

Check logs di Render Dashboard.
Common issues:
1. package.json salah format
2. Node version mismatch
3. Missing dependencies

Fix: Update package.json, push lagi.

### ❌ Deploy Success tapi Error 500

Check logs:
```
Render Dashboard → Logs tab → Check errors
```

Usually:
- Database permission issue
- Missing env variables
- Code error

### ❌ Can't access /admin endpoints

Make sure header betul:
```bash
-H "x-admin-password: YOUR_PASSWORD"
```

Password must match ADMIN_PASSWORD env variable!

============================================================
## NEXT STEPS SELEPAS DEPLOY
============================================================

✅ Update SDK dengan URL Render
✅ Test SDK dengan server baru
✅ Tambah 2-3 test clients
✅ Test dari phone sebenar
✅ Setup UptimeRobot monitoring
✅ Backup database (download from Render)

============================================================
## USEFUL COMMANDS
============================================================

### View Logs (dari Render Dashboard):
Render Dashboard → Service → Logs (real-time!)

### Manual Redeploy:
Render Dashboard → Service → Manual Deploy → Deploy latest commit

### Download Database Backup:
Render Dashboard → Service → Shell
```bash
cat zkinetic.db > backup.db
# Copy content manually
```

Or use Render Disk (paid feature) for persistent storage.

============================================================

🎉 SELESAI! Server Captain dah di cloud!

URL tetap, data persist, 24/7 uptime (with occasional cold starts).

Bila dah test OK semua, boleh proceed ke dashboard web! 🚀
