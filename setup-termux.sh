#!/data/data/com.termux/files/usr/bin/bash
# ============================================
# WHATSAPP BOT - ONE COMMAND SETUP FOR TERMUX
# ============================================
# Jalankan: bash setup-termux.sh
# Atau: curl -fsSL https://raw.githubusercontent.com/RaviOppo/wa-bot/main/setup-termux.sh | bash

set -e  # Stop on error

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

log() { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err() { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# ============================================
# STEP 1: Update & Install Dependencies
# ============================================
log "Step 1/8: Update packages & install dependencies..."
pkg update -y && pkg upgrade -y
pkg install -y nodejs-lts git python build-essential termux-api

# ============================================
# STEP 2: Storage Permission
# ============================================
log "Step 2/8: Request storage permission..."
termux-setup-storage
sleep 2

# ============================================
# STEP 3: Clone Repository
# ============================================
log "Step 3/8: Clone repository..."
cd ~
if [ -d "wa-bot" ]; then
    warn "Folder wa-bot sudah ada, update..."
    cd wa-bot
    git pull
else
    git clone https://github.com/RaviOppo/wa-bot.git
    cd wa-bot
fi

# ============================================
# STEP 4: Install NPM Dependencies
# ============================================
log "Step 4/8: Install npm dependencies..."
npm install
npm install -g pm2

# ============================================
# STEP 5: Setup PM2 Startup
# ============================================
log "Step 5/8: Setup PM2 startup..."
pm2 start index.js --name wa-bot
pm2 save

# Get startup command and run it
STARTUP_CMD=$(pm2 startup | grep -o 'sudo.*' | head -1 | sed 's/sudo //')
if [ ! -z "$STARTUP_CMD" ]; then
    eval "$STARTUP_CMD"
    log "PM2 startup configured"
else
    warn "PM2 startup command tidak terdeteksi, jalankan manual: pm2 startup"
fi

# ============================================
# STEP 6: Wake Lock (Anti-Sleep)
# ============================================
log "Step 6/8: Setup wake lock (anti-sleep)..."
termux-wake-lock

mkdir -p ~/.termux/boot
cat > ~/.termux/boot/wake-lock << 'BOOTEOF'
#!/data/data/com.termux/files/usr/bin/bash
termux-wake-lock
BOOTEOF
chmod +x ~/.termux/boot/wake-lock

# ============================================
# STEP 7: Verify Owner Number
# ============================================
log "Step 7/8: Verify owner number..."
OWNER=$(grep -o "OWNER_NUMBER = '[^']*'" index.js | cut -d"'" -f2)
if [ "$OWNER" = "6289628044141@s.whatsapp.net" ]; then
    log "Owner number OK: $OWNER"
else
    warn "Owner number: $OWNER (cek index.js jika salah)"
fi

# ============================================
# STEP 8: Run First Time (QR Scan)
# ============================================
log "Step 8/8: Running bot for QR scan..."
warn "============================================"
warn "  SCAN QR CODE YANG MUNCUL DI BAWAH"
warn "  Buka WhatsApp > Linked Devices > Link a Device"
warn "  Tunggu 'Bot connected!' lalu tekan Ctrl+C (Vol Down + C)"
warn "============================================"
echo ""
node index.js

# ============================================
# DONE
# ============================================
echo ""
log "============================================"
log "  SETUP SELESAI!"
log "============================================"
echo ""
echo "Bot sudah jalan di background via PM2."
echo ""
echo "Command berguna:"
echo "  pm2 status          # Cek status"
echo "  pm2 logs wa-bot     # Lihat log (Ctrl+C keluar)"
echo "  pm2 restart wa-bot  # Restart"
echo "  pm2 stop wa-bot     # Stop"
echo ""
echo "Update bot nanti:"
echo "  cd ~/wa-bot && git pull && npm install && pm2 restart wa-bot"
echo ""
warn "JANGAN LUPA SETTING HP:"
warn "1. Battery > App power management > Termux > Unrestricted"
warn "2. Developer options > Stay awake ON"
warn "3. Buka app Termux:API sekali (allow permission)"
warn "4. HP tetap di charger / power bank"