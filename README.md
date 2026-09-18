# Atria API Key Auto-Generator (`atriagen`)

Otomasi registrasi akun Atria API dan pembuatan API Key secara massal (*multi-account*) menggunakan **Puppeteer Extra** dengan **Stealth Plugin** dan **Turbo Mode**.

---

## 🚀 Fitur Utama

- **Google OAuth Langsung & Stabil**: Login ke `accounts.google.com` terlebih dahulu untuk memvalidasi session, sehingga proses masuk ke Atria Console berjalan mulus tanpa redirect berulang.
- **Stealth Mode Anti-Deteksi**: Menggunakan `puppeteer-extra-plugin-stealth` untuk mem-bypass fingerprinting dan proteksi bot otomatis.
- **Turbo Mode**: Flag Chrome dioptimalkan untuk mematikan background process dan rendering berat (GPU, audio, unnecessary services) agar loading halaman jauh lebih cepat dan hemat memori.
- **Dialog Flow Akurat & Kalm**: Menangani popup modal *"Create key"* dengan jeda yang tenang (tidak terburu-buru), mengisi nama key pada placeholder, dan mengonfirmasi pembuatan key di dalam dialog.
- **Ekstraksi API Key via Clipboard**: Menggunakan aksi tombol **Copy** langsung dari browser sehingga seluruh token dan tanda baca (minus `-`, underscore `_`, titik `.`, dll.) tersimpan utuh 100%.
- **Auto-Remove Akun Sukses**: Akun yang berhasil membuat API Key langsung dihapus secara *real-time* dari `akun.txt`, mencegah duplikasi dan mempermudah melanjutkan proses jika terhenti.
- **Dukungan Vercel Relay / Proxy**: Mendukung bypass IP / rate-limit melalui reverse proxy Vercel Serverless Relay.

---

## 📋 Persyaratan Sistem

- **Node.js** v18.0.0 atau yang lebih baru
- **NPM** (bawaan Node.js)
- Browser Google Chrome / Chromium (otomatis terpasang saat `npm install`)
- Koneksi internet stabil

---

## 🛠️ Panduan Instalasi

### 1. Clone Repository

```bash
git clone https://github.com/zahirnurdin1/atriagen.git
cd atriagen
```

### 2. Install Dependensi

Jalankan perintah berikut di terminal:

```bash
npm install
```

Paket yang akan terpasang:
- `puppeteer`: Browser automation engine
- `puppeteer-extra`: Framework modular Puppeteer
- `puppeteer-extra-plugin-stealth`: Plugin anti-bot fingerprinting

---

## ⚙️ Konfigurasi (`register.js`)

Buka file `register.js` dan sesuaikan objek `CONFIG` sesuai kebutuhan Anda:

```javascript
const CONFIG = {
  headless: false,              // false = tampilkan jendela browser (disarankan)
  timeout: 90000,               // Timeout maksimal per step (ms)
  consoleUrl: "https://api.atria-asi.ai/console",
  keyName: "satu",              // Nama API Key yang akan dibuat di dialog
  akunFile: path.join(__dirname, "akun.txt"),
  resultFile: path.join(__dirname, "api_keys.txt"),
  delayBetweenAccounts: 5000,   // Jeda sebelum memproses akun berikutnya (ms)

  // Konfigurasi Vercel Relay (Opsional)
  useRelay: false,              // Ubah ke true jika menggunakan relay
  relayUrl: "https://your-relay.vercel.app/",
  proxyServer: "",              // Opsional: proxy IP (contoh: "http://127.0.0.1:8080")
};
```

---

## 📝 Menyiapkan Daftar Akun (`akun.txt`)

Buat atau edit file `akun.txt` di direktori yang sama dengan skrip.

**Format per baris:**
```text
email@gmail.com|password
```

**Contoh:**
```text
# Daftar Akun Google untuk Atria (Baris diawali # adalah komentar)
user1@gmail.com|PasswordUser123
user2@gmail.com|PasswordUser456
user3@gmail.com|PasswordUser789
```

> **Catatan Penting:** 
> Setiap akun yang **berhasil (`SUCCESS`)** membuat API Key akan **langsung otomatis dihapus** dari file `akun.txt`, sehingga daftar akun tetap bersih dan tidak terulang jika skrip dijalankan kembali.

---

## ▶️ Cara Menjalankan

Jalankan skrip menggunakan Node.js:

```bash
node register.js
```

Atau menggunakan npm script:

```bash
npm start
```

---

## 📄 Hasil Output (`api_keys.txt`)

Semua API Key yang berhasil dibuat akan disimpan di file `api_keys.txt` dengan format:

```text
Timestamp | Email | Status | API Key
================================================================================
2026-09-18T16:30:15.123Z | user1@gmail.com | SUCCESS | atr_xxxxxxxxxxxxxxxxxxxxxx
2026-09-18T16:32:45.456Z | user2@gmail.com | SUCCESS | atr_yyyyyyyyyyyyyyyyyyyyyy
```

---

## 💡 Menggunakan API Key yang Dihasilkan

Setelah mendapatkan API Key, Anda bisa menggunakannya untuk memanggil model AI Atria melalui cURL atau SDK OpenAI-compatible:

```bash
curl -X POST https://api.atria-asi.ai/v1/chat/completions \
  -H "Authorization: Bearer atr_xxxxxxxxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Atria-Dawn-Preview",
    "messages": [
      {"role": "user", "content": "Halo, siapa kamu?"}
    ]
  }'
```

---

## ⚠️ Troubleshooting

1. **Google Meminta Verifikasi 2FA / Phone Verification**:
   - Gunakan akun Google yang tidak mengaktifkan 2FA ketat. Jika verifikasi muncul di layar browser, Anda dapat menyelesaikannya secara manual di jendela browser karena browser berjalan dalam mode `headless: false`.
2. **Koneksi / IP Terblokir**:
   - Aktifkan opsi Vercel Relay pada `CONFIG.useRelay: true` atau isi `CONFIG.proxyServer` jika IP internet Anda terkena rate limit dari Atria atau Google.
3. **Akun Gagal / FAILED**:
   - Akun yang gagal tetap ada di dalam `akun.txt` dan tidak terhapus, sehingga Anda bisa memeriksa kembali kredensialnya.
