# Atria Auto Register (Multi-Account)

Script Puppeteer untuk membuat banyak akun Atria API sekaligus.

## Setup

```bash
# Install dependencies (sudah terinstall)
cd /root/atria
npm install
```

## Cara Pakai

### 1. Buat file `akun.txt`

Format: `email|password` (satu akun per baris)

```
email1@gmail.com|password1
email2@gmail.com|password2
email3@gmail.com|password3
```

Baris dengan `#` di awal = komentar (diabaikan).

### 2. Jalankan script

```bash
node register.js
```

## Output

- **api_keys.txt** - Semua API key yang berhasil dibuat
- **error-X.png** - Screenshot jika ada akun yang gagal (X = nomor urut)

## Format Hasil (api_keys.txt)

```
Timestamp | Email | Status | API Key
==================================================
2026-09-18T... | email1@gmail.com | SUCCESS | atr_xxxxx
2026-09-18T... | email2@gmail.com | FAILED | -
```

## Konfigurasi

Edit `register.js` bagian `CONFIG`:

```javascript
const CONFIG = {
  headless: false,              // true = tanpa UI browser
  timeout: 60000,               // timeout per step (ms)
  delayBetweenAccounts: 5000,   // jeda antar akun (ms)
  keyName: "auto-key",          // nama API key
};
```

## Troubleshooting

**Google Captcha/2FA**
- Script akan stuck jika Google minta verifikasi
- Gunakan akun tanpa 2FA atau solve manual di browser

**Login gagal**
- Pastikan email/password benar
- Google mungkin block automation → coba reduce speed atau gunakan delay lebih lama

**UI Atria berubah**
- Selector mungkin perlu update di script
- Lihat screenshot error untuk debug

**Browser tidak muncul**
- Set `headless: false` untuk lihat proses
- Pastikan Chrome/Chromium terinstall

## Cara Pakai API Key

```bash
export ATRIA_API_KEY="atr_xxxxx"

curl -X POST https://api.atria-asi.ai/v1/chat/completions \
  -H "Authorization: Bearer $ATRIA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "Atria-Dawn-Preview", "messages": [{"role": "user", "content": "hi"}]}'
```
# atriagen git init git add README.md git commit -m first commit git branch -M main git remote add origin git@github.com:zahirnurdin1/atriagen.git git push -u origin main
