const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

// Aktifkan Stealth Plugin — bypass deteksi bot secara otomatis
// (webdriver, chrome.runtime, navigator.plugins, WebGL, canvas fingerprint, dll.)
puppeteer.use(StealthPlugin());
const fs = require("fs");
const path = require("path");

const CONFIG = {
  headless: false,
  timeout: 90000,
  consoleUrl: "https://api.atria-asi.ai/console",
  keyName: "satu",
  akunFile: path.join(__dirname, "akun.txt"),
  resultFile: path.join(__dirname, "api_keys.txt"),
  delayBetweenAccounts: 5000,

  // ==========================================
  // Vercel Relay & Proxy Configuration
  // ==========================================
  useRelay: false, // Set ke true untuk menggunakan Vercel Relay
  relayUrl: "https://vercel-relay-chi-lake.vercel.app/", // URL Vercel Relay Anda
  proxyServer: "", // Opsional: proxy IP (contoh: "http://127.0.0.1:8080")
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Tunggu halaman benar-benar selesai di-load:
 * 1. document.readyState === 'complete'
 * 2. Tidak ada network request pending (networkidle)
 * 3. DOM stabil (tidak ada perubahan selama 500ms)
 */
async function waitForPageFullyLoaded(page, tag = "", timeout = 30000) {
  try {
    // Tunggu document.readyState === 'complete'
    await page.waitForFunction(
      () => document.readyState === 'complete',
      { timeout }
    );

    // Tunggu tidak ada network activity (networkidle0 = 0 koneksi selama 500ms)
    await page.waitForNetworkIdle({ idleTime: 500, timeout: Math.min(timeout, 15000) }).catch(() => null);

    // Tunggu DOM stabil (tidak ada mutasi selama 500ms)
    await page.evaluate(() => {
      return new Promise((resolve) => {
        let timer = null;
        const observer = new MutationObserver(() => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            observer.disconnect();
            resolve();
          }, 500);
        });
        observer.observe(document.body, { childList: true, subtree: true });
        // Fallback: jika tidak ada mutasi dalam 1 detik, anggap stabil
        timer = setTimeout(() => {
          observer.disconnect();
          resolve();
        }, 1000);
      });
    });

    if (tag) console.log(`${tag}     ✓ Halaman fully loaded (${page.url().substring(0, 60)})`);
  } catch (err) {
    if (tag) console.log(`${tag}     [WARN] waitForPageFullyLoaded timeout, melanjutkan... (${err.message})`);
  }
}

/**
 * Bersihkan semua cache, cookies, localStorage, sessionStorage, IndexedDB
 * agar browser benar-benar bersih sebelum registrasi akun baru.
 */
async function clearBrowserData(page, tag = "") {
  try {
    const client = await page.createCDPSession();

    // Hapus semua cache browser
    await client.send('Network.clearBrowserCache');

    // Hapus semua cookies
    await client.send('Network.clearBrowserCookies');

    // Hapus localStorage, sessionStorage, IndexedDB, WebSQL, CacheStorage
    await client.send('Storage.clearDataForOrigin', {
      origin: '*',
      storageTypes: 'all',
    }).catch(() => null);

    // Juga bersihkan via JS untuk memastikan
    await page.evaluate(() => {
      try { localStorage.clear(); } catch (_) { }
      try { sessionStorage.clear(); } catch (_) { }
    }).catch(() => null);

    await client.detach();

    if (tag) console.log(`${tag}     🧹 Cache, cookies, & storage dibersihkan.`);
  } catch (err) {
    if (tag) console.log(`${tag}     [WARN] Gagal membersihkan data browser: ${err.message}`);
  }
}

function getTargetUrl(rawUrl) {
  if (CONFIG.useRelay && CONFIG.relayUrl) {
    const cleanRelay = CONFIG.relayUrl.replace(/\/+$/, "");
    try {
      const parsed = new URL(rawUrl);
      return `${cleanRelay}${parsed.pathname || ""}${parsed.search || ""}`;
    } catch (_) {
      return `${cleanRelay}/console`;
    }
  }
  return rawUrl;
}

function readAccounts() {
  if (!fs.existsSync(CONFIG.akunFile)) {
    console.error("Error: akun.txt tidak ditemukan!");
    console.error(`Buat file: ${CONFIG.akunFile}`);
    console.error("Format: email|password (satu akun per baris)");
    process.exit(1);
  }

  const lines = fs.readFileSync(CONFIG.akunFile, "utf-8").split("\n");
  const accounts = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;

    const parts = line.split("|");
    if (parts.length < 2) {
      console.error(`Baris ${i + 1}: format salah, gunakan email|password`);
      continue;
    }

    accounts.push({
      email: parts[0].trim(),
      password: parts[1].trim(),
    });
  }

  if (accounts.length === 0) {
    console.error("Error: tidak ada akun valid di akun.txt");
    process.exit(1);
  }

  return accounts;
}

function appendResult(email, apiKey, status) {
  const timestamp = new Date().toISOString();
  const line = `${timestamp} | ${email} | ${status} | ${apiKey || "-"}\n`;
  fs.appendFileSync(CONFIG.resultFile, line, "utf-8");
}

/**
 * Hapus akun yang sukses dari akun.txt secara real-time
 */
function removeAccount(email) {
  try {
    if (!fs.existsSync(CONFIG.akunFile)) return;
    const content = fs.readFileSync(CONFIG.akunFile, "utf-8");
    const lines = content.split("\n");
    const updatedLines = lines.filter((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return true; // Pertahankan komentar / baris kosong
      const parts = trimmed.split("|");
      const accountEmail = parts[0].trim();
      return accountEmail.toLowerCase() !== email.toLowerCase();
    });
    fs.writeFileSync(CONFIG.akunFile, updatedLines.join("\n"), "utf-8");
    console.log(`     🗑️ Akun ${email} berhasil dihapus dari ${path.basename(CONFIG.akunFile)}`);
  } catch (err) {
    console.error(`     [WARN] Gagal menghapus akun dari ${path.basename(CONFIG.akunFile)}: ${err.message}`);
  }
}

async function waitAndType(page, selector, text, timeout = 15000) {
  await page.waitForSelector(selector, { visible: true, timeout });
  await sleep(400);
  await page.click(selector, { clickCount: 3 });
  await page.type(selector, text, { delay: 40 });
}

async function clickByText(page, texts, tag = "*") {
  const textArray = Array.isArray(texts) ? texts : [texts];
  return await page.evaluate(({ tag, textArray }) => {
    const elements = Array.from(document.querySelectorAll(tag));
    for (const text of textArray) {
      const lower = text.toLowerCase();
      for (const el of elements) {
        const t = (el.innerText || el.textContent || el.value || "").trim().toLowerCase();
        if (t === lower || (t.includes(lower) && t.length < 60)) {
          el.click();
          return true;
        }
      }
    }
    return false;
  }, { tag, textArray });
}

async function registerOne(browser, account, index, total) {
  const tag = `[${index}/${total}] ${account.email}`;
  console.log(`\n${"=".repeat(60)}`);
  console.log(`${tag} - Memulai proses registrasi via Google...`);
  if (CONFIG.useRelay && CONFIG.relayUrl) {
    console.log(`${tag} [Relay] Menggunakan Vercel Relay: ${CONFIG.relayUrl}`);
  }
  console.log(`${"=".repeat(60)}\n`);

  const context = await browser.createBrowserContext();
  try {
    await context.overridePermissions("https://api.atria-asi.ai", [
      "clipboard-read",
      "clipboard-write",
      "clipboard-sanitized-write",
    ]);
  } catch (_) { }
  const page = await context.newPage();
  page.setDefaultTimeout(CONFIG.timeout);

  // Hook penangkap clipboard agar seluruh karakter/simbol API Key tertangkap utuh
  try {
    await page.evaluateOnNewDocument(() => {
      window.__lastCopiedText = "";
      if (navigator.clipboard) {
        const origWrite = navigator.clipboard.writeText;
        navigator.clipboard.writeText = async function (text) {
          window.__lastCopiedText = String(text);
          try {
            if (origWrite) return await origWrite.apply(this, arguments);
          } catch (_) { }
          return Promise.resolve();
        };
      }
    });
  } catch (_) { }

  // ====================================================================
  // Step 0: Bersihkan cache & data browser sebelum mulai
  // ====================================================================
  console.log(`${tag} [0] Membersihkan cache & data browser...`);
  await clearBrowserData(page, tag);

  // Stealth plugin sudah menangani bypass deteksi automasi secara otomatis.

  let apiKey = null;

  try {
    // ====================================================================
    // FASE 1: LOGIN KE GOOGLE TERLEBIH DAHULU
    // ====================================================================

    // Step 1: Buka halaman login Google langsung
    // ====================================================================
    console.log(`${tag} [1] Membuka halaman login Google...`);
    await page.goto("https://accounts.google.com/signin/v2/identifier?flowName=GlifWebSignIn&flowEntry=ServiceLogin", {
      waitUntil: "networkidle2",
      timeout: 30000,
    });
    await waitForPageFullyLoaded(page, tag);
    console.log(`${tag}     URL: ${page.url()}`);

    // Cek apakah sudah login (redirect ke myaccount)
    const alreadyLoggedIn = page.url().includes("myaccount.google.com") || page.url().includes("accounts.google.com/Default");
    if (alreadyLoggedIn) {
      console.log(`${tag}     ✅ Sudah login ke Google! Skip input credentials.`);
    } else {
      // ------------------------------------------------------------------
      // Step 2: Input Email Google
      // ------------------------------------------------------------------
      console.log(`${tag} [2] Input email Google...`);

      let emailField = null;
      const emailSelectors = ['#identifierId', 'input[type="email"]', 'input[name="identifier"]'];
      for (let attempt = 0; attempt < 12 && !emailField; attempt++) {
        for (const sel of emailSelectors) {
          try {
            emailField = await page.waitForSelector(sel, { visible: true, timeout: 3000 });
            if (emailField) break;
          } catch (_) { }
        }
        if (!emailField && attempt < 11) {
          console.log(`${tag}     Mencari input email... (percobaan ${attempt + 1})`);
          await sleep(2000);
        }
      }

      if (!emailField) {
        throw new Error("Input email Google tidak ditemukan setelah 12 percobaan.");
      }

      await emailField.click({ clickCount: 3 });
      await sleep(200);
      await emailField.type(account.email, { delay: 50 });
      await sleep(500);

      // Klik Next (email)
      console.log(`${tag}     Klik Next (email)...`);
      const nextEmailBtn = await page.$('#identifierNext');
      if (nextEmailBtn) {
        await Promise.all([
          page.waitForNavigation({ waitUntil: "networkidle0", timeout: 15000 }).catch(() => null),
          nextEmailBtn.click(),
        ]);
      } else {
        await clickByText(page, ["Next", "Berikutnya", "Selanjutnya", "下一步"], "button");
      }
      await waitForPageFullyLoaded(page, tag);

      // Deteksi error email
      const emailError = await page.evaluate(() => {
        const errEl = document.querySelector('[class*="error"], [role="alert"], .o6cuMc');
        return errEl ? errEl.innerText : null;
      });
      if (emailError) {
        console.log(`${tag}     [ERROR Google] ${emailError}`);
        throw new Error(`Google error pada email: ${emailError}`);
      }

      // ------------------------------------------------------------------
      // Step 3: Input Password Google
      // ------------------------------------------------------------------
      console.log(`${tag} [3] Input password Google...`);

      let passField = null;
      const passSelectors = ['input[type="password"][name="Passwd"]', 'input[type="password"]', 'input[name="password"]'];
      for (let attempt = 0; attempt < 12 && !passField; attempt++) {
        for (const sel of passSelectors) {
          try {
            passField = await page.waitForSelector(sel, { visible: true, timeout: 3000 });
            if (passField) break;
          } catch (_) { }
        }
        if (!passField && attempt < 11) {
          console.log(`${tag}     Mencari input password... (percobaan ${attempt + 1})`);
          await sleep(2000);

          // Cek 2FA
          const currentText = await page.evaluate(() => document.body.innerText).catch(() => "");
          if (currentText.includes("2-Step Verification") || currentText.includes("Verifikasi 2 Langkah")) {
            console.log(`${tag}     [INFO] Terdeteksi 2FA. Silakan selesaikan manual di browser.`);
            for (let w = 0; w < 30; w++) {
              const pf = await page.$('input[type="password"]');
              if (pf) { passField = pf; break; }
              if (!page.url().includes("accounts.google.com")) break;
              await sleep(2000);
            }
            break;
          }
        }
      }

      if (passField) {
        await passField.click({ clickCount: 3 });
        await sleep(200);
        await passField.type(account.password, { delay: 60 });
        await sleep(500);

        // Klik Next (password)
        console.log(`${tag}     Klik Next (password)...`);
        const nextPassBtn = await page.$('#passwordNext');
        if (nextPassBtn) {
          await Promise.all([
            page.waitForNavigation({ waitUntil: "networkidle0", timeout: 20000 }).catch(() => null),
            nextPassBtn.click(),
          ]);
        } else {
          await clickByText(page, ["Next", "Berikutnya", "Selanjutnya", "下一步"], "button");
        }
        await waitForPageFullyLoaded(page, tag);

        // Deteksi error password salah
        const passError = await page.evaluate(() => {
          const errEl = document.querySelector('[class*="error"], [role="alert"], .o6cuMc, .OyEIQ');
          return errEl ? errEl.innerText : null;
        });
        if (passError && (passError.includes("Wrong password") || passError.includes("password") || passError.includes("salah"))) {
          console.log(`${tag}     [ERROR Google] ${passError}`);
          throw new Error(`Google error pada password: ${passError}`);
        }
      } else if (page.url().includes("accounts.google.com")) {
        throw new Error("Input password Google tidak ditemukan setelah 12 percobaan.");
      }
    }

    // ------------------------------------------------------------------
    // Step 4: Verifikasi login Google berhasil
    // ------------------------------------------------------------------
    console.log(`${tag} [4] Memverifikasi sesi login Google...`);

    // Tunggu redirect setelah login (biasanya ke myaccount atau halaman utama)
    for (let i = 0; i < 15; i++) {
      const currentUrl = page.url();
      if (
        currentUrl.includes("myaccount.google.com") ||
        currentUrl.includes("accounts.google.com/Default") ||
        currentUrl.includes("google.com/intl") ||
        !currentUrl.includes("signin")
      ) {
        break;
      }

      // Handle consent/agreement Google jika muncul
      await clickByText(page, [
        "I agree", "Saya setuju", "Continue", "Lanjutkan",
        "Accept", "Terima", "Not now", "Tidak sekarang"
      ], "button, div[role='button']");

      await sleep(2000);
    }

    // Buka halaman myaccount untuk verifikasi login
    await page.goto("https://myaccount.google.com/", { waitUntil: "networkidle2", timeout: 20000 });
    await waitForPageFullyLoaded(page, tag);

    const googleLoggedIn = !page.url().includes("signin") && !page.url().includes("ServiceLogin");
    if (googleLoggedIn) {
      console.log(`${tag}     ✅ Login Google BERHASIL! Sesi aktif untuk: ${account.email}`);
    } else {
      console.log(`${tag}     [WARN] Login Google mungkin belum berhasil. URL: ${page.url()}`);
      console.log(`${tag}     Melanjutkan proses (mungkin perlu 2FA manual)...`);
    }

    // ====================================================================
    // FASE 2: BUKA ATRIA CONSOLE (Google session sudah aktif)
    // ====================================================================

    // Step 5: Buka Atria Console
    // ====================================================================
    console.log(`${tag} [5] Membuka Atria Console...`);

    // Jika relay aktif, pasang header
    if (CONFIG.useRelay) {
      await page.setExtraHTTPHeaders({
        "x-relay-target": "https://api.atria-asi.ai",
      });
    }

    const targetUrl = getTargetUrl(CONFIG.consoleUrl);
    await page.goto(targetUrl, { waitUntil: "networkidle2", timeout: 30000 });
    await waitForPageFullyLoaded(page, tag);
    console.log(`${tag}     URL: ${page.url()}`);

    // ------------------------------------------------------------------
    // Step 6: Klik "Continue with Google" (auto-login karena sesi sudah ada)
    // ------------------------------------------------------------------
    console.log(`${tag} [6] Klik Continue with Google (auto-login)...`);

    // Cek apakah sudah langsung masuk dashboard (redirect otomatis)
    const alreadyInDashboard = page.url().includes("api.atria-asi.ai") && !page.url().includes("sign-in");
    if (alreadyInDashboard) {
      console.log(`${tag}     ✅ Sudah langsung masuk dashboard!`);
    } else {
      // Klik tombol Google Sign-in
      let clickedGoogle = false;
      for (let attempt = 0; attempt < 10 && !clickedGoogle; attempt++) {
        const googleBtn = await page.$('button[class*="socialButton"], button[class*="socialLinkButton"]');
        if (googleBtn) {
          await Promise.all([
            page.waitForNavigation({ waitUntil: "networkidle0", timeout: 20000 }).catch(() => null),
            googleBtn.click(),
          ]);
          clickedGoogle = true;
          break;
        }

        clickedGoogle = await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll("button, a"));
          for (const b of btns) {
            const txt = (b.innerText || b.textContent || "").trim();
            if (txt.includes("Google")) { b.click(); return true; }
          }
          return false;
        });

        if (!clickedGoogle && attempt < 9) await sleep(1500);
      }

      if (!clickedGoogle) {
        throw new Error("Tombol 'Continue with Google' di Atria tidak ditemukan.");
      }

      console.log(`${tag}     Tombol Google diklik, menunggu auto-login...`);

      // Karena sesi Google sudah aktif, seharusnya langsung redirect
      // Tapi handle juga jika Google minta konfirmasi akun
      await sleep(3000);
      await waitForPageFullyLoaded(page, tag);

      // Jika Google meminta pilih akun, pilih akun yang benar
      if (page.url().includes("accounts.google.com")) {
        console.log(`${tag}     Google meminta pilih akun...`);

        // Coba klik akun yang sesuai berdasarkan email (dengan retry)
        let clickedAccount = false;
        for (let pickAttempt = 0; pickAttempt < 5 && !clickedAccount; pickAttempt++) {
          clickedAccount = await page.evaluate((email) => {
            const emailLower = email.toLowerCase();

            // Prioritas 1: elemen dengan atribut data-email yang cocok
            const byDataEmail = document.querySelectorAll('[data-email]');
            for (const el of byDataEmail) {
              if (el.getAttribute('data-email').toLowerCase() === emailLower) {
                el.click();
                return true;
              }
            }

            // Prioritas 2: elemen dengan data-identifier yang cocok
            const byIdentifier = document.querySelectorAll('[data-identifier]');
            for (const el of byIdentifier) {
              if (el.getAttribute('data-identifier').toLowerCase() === emailLower) {
                el.click();
                return true;
              }
            }

            // Prioritas 3: cari dari teks yang mengandung email
            const allClickable = document.querySelectorAll('li, div[role="link"], div[data-authuser], a');
            for (const el of allClickable) {
              const text = (el.innerText || el.textContent || "").toLowerCase();
              if (text.includes(emailLower)) {
                el.click();
                return true;
              }
            }

            return false;
          }, account.email);

          if (!clickedAccount) {
            console.log(`${tag}     Mencari akun ${account.email}... (percobaan ${pickAttempt + 1})`);
            await sleep(2000);
          }
        }

        if (clickedAccount) {
          console.log(`${tag}     ✅ Akun ${account.email} berhasil dipilih.`);
        } else {
          console.log(`${tag}     [WARN] Akun ${account.email} tidak ditemukan di daftar. Proses mungkin gagal.`);
          // Jangan klik akun sembarangan — biarkan user yang pilih
        }

        await sleep(3000);
        await waitForPageFullyLoaded(page, tag);

        // Handle consent Google OAuth
        for (let attempt = 0; attempt < 3; attempt++) {
          if (!page.url().includes("accounts.google.com") && !page.url().includes("consent")) break;

          const consentClicked = await clickByText(page, [
            "Continue", "Allow", "Lanjutkan", "Izinkan",
            "I agree", "Saya setuju", "Confirm", "Select all",
            "Accept", "Terima", "Grant access"
          ], "button, div[role='button'], span[role='button']");

          if (consentClicked) {
            console.log(`${tag}     Consent diklik (percobaan ${attempt + 1}).`);
            await waitForPageFullyLoaded(page, tag);
          }
          await sleep(2000);
        }
      }

      // Handle consent Logto
      if (page.url().includes("auth.atria-asi.ai") && !page.url().includes("sign-in")) {
        await clickByText(page, ["Authorize", "Continue", "Allow", "Lanjutkan"], "button");
        await waitForPageFullyLoaded(page, tag);
      }
    }

    // ------------------------------------------------------------------
    // Step 7: Tunggu sampai masuk Dashboard Atria
    // ------------------------------------------------------------------
    console.log(`${tag} [7] Menunggu masuk Dashboard Atria...`);
    const maxWaitTime = Date.now() + 75000;
    let redirected = false;
    let lastLoggedUrl = "";

    while (Date.now() < maxWaitTime) {
      const currentUrl = page.url();

      if (currentUrl !== lastLoggedUrl) {
        console.log(`${tag}     URL: ${currentUrl.substring(0, 80)}...`);
        lastLoggedUrl = currentUrl;
      }

      const isAtria = currentUrl.includes("api.atria-asi.ai") && !currentUrl.includes("sign-in");
      const isRelay = CONFIG.relayUrl && currentUrl.includes(new URL(CONFIG.relayUrl).hostname) && !currentUrl.includes("sign-in");

      if ((isAtria || isRelay) && !currentUrl.includes("accounts.google.com")) {
        redirected = true;
        console.log(`${tag}     ✅ Masuk Dashboard berhasil! URL: ${currentUrl}`);
        await waitForPageFullyLoaded(page, tag);
        break;
      }

      // Handle consent Logto yang mungkin muncul
      if (currentUrl.includes("auth.atria-asi.ai") && !currentUrl.includes("sign-in")) {
        await clickByText(page, ["Authorize", "Continue", "Allow", "Lanjutkan"], "button");
      }

      // Handle Google consent yang mungkin muncul lagi
      if (currentUrl.includes("accounts.google.com")) {
        await clickByText(page, ["Continue", "Allow", "Lanjutkan", "Izinkan", "Accept"], "button");
      }

      await sleep(2000);
    }

    if (!redirected) {
      const finalUrl = page.url();
      console.log(`${tag}     [PERINGATAN] Belum masuk Dashboard setelah timeout.`);
      console.log(`${tag}     URL saat ini: ${finalUrl}`);
    }
    await sleep(2000);

    // Step 8: Cari halaman API Keys di Atria Console
    console.log(`${tag} [8] Mencari menu API Keys...`);
    await waitForPageFullyLoaded(page, tag);

    const keyLinks = [
      'a[href*="key"]',
      'a[href*="api-key"]',
      'a[href*="console/key"]',
      'button[id*="key"]',
    ];

    let navigatedToKeys = false;
    for (const sel of keyLinks) {
      try {
        const el = await page.$(sel);
        if (el) {
          await el.click();
          navigatedToKeys = true;
          console.log(`${tag}     Klik link: ${sel}`);
          break;
        }
      } catch (_) { }
    }

    if (!navigatedToKeys) {
      await clickByText(
        page,
        ["API keys", "API Keys", "API key", "API Key", "API 密钥", "Keys", "密钥管理"],
        "a, button, div"
      );
    }

    await waitForPageFullyLoaded(page, tag);
    console.log(`${tag}     Menunggu halaman API Keys stabil...`);
    await sleep(3500);

    // Step 9: Buat API Key Baru
    console.log(`${tag} [9] Membuat API Key dengan nama "${CONFIG.keyName}"...`);

    // === Sub-step 9.1: Klik tombol Create Key PERTAMA di halaman ===
    console.log(`${tag}     [9.1] Mencari tombol Create Key pertama...`);
    await sleep(2000); // Jeda santai sebelum mengklik tombol pertama
    let firstCreateClicked = false;

    // 1. Coba cari tombol/link dengan teks "create key" atau variasinya di halaman
    firstCreateClicked = await page.evaluate(() => {
      const isVisible = (el) => {
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && el.offsetParent !== null;
      };

      const elements = Array.from(document.querySelectorAll("button, a, div[role='button']"));
      for (const el of elements) {
        if (!isVisible(el)) continue;
        const text = (el.innerText || el.textContent || "").trim().toLowerCase();
        if (
          text === "create key" ||
          text === "+ create key" ||
          text === "create new key" ||
          text === "create api key" ||
          text.includes("create key") ||
          text.includes("new key") ||
          text.includes("add key") ||
          text === "create" ||
          text === "创建密钥"
        ) {
          el.scrollIntoView({ behavior: "instant", block: "center" });
          el.click();
          return true;
        }
      }
      return false;
    });

    // 2. Fallback selector jika evaluasi teks belum menemukan
    if (!firstCreateClicked) {
      const createBtnSelectors = [
        'button[class*="create" i]',
        'button[data-action*="create" i]',
        'a[class*="create" i]',
        'button[id*="create" i]',
        'a[href*="create" i]',
      ];
      for (const sel of createBtnSelectors) {
        try {
          const btn = await page.$(sel);
          if (btn) {
            await btn.click();
            firstCreateClicked = true;
            console.log(`${tag}     Klik tombol Create Key pertama via selector: ${sel}`);
            break;
          }
        } catch (_) { }
      }
    }

    if (!firstCreateClicked) {
      console.log(`${tag}     [WARN] Tombol Create Key pertama tidak ditemukan.`);
    } else {
      console.log(`${tag}     ✅ Tombol Create Key pertama berhasil diklik.`);
      console.log(`${tag}     Memberi jeda agar animasi dialog mulai terbuka...`);
      await sleep(2500);

      // === Sub-step 9.2: Tunggu dialog / modal Create Key muncul ===
      console.log(`${tag}     [9.2] Menunggu dialog Create Key muncul...`);
      let dialogDetected = false;

      for (let attempt = 0; attempt < 12; attempt++) {
        await sleep(1200);
        dialogDetected = await page.evaluate(() => {
          const isVisible = (el) => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
          };

          // Cari dialog / modal container
          const dialogContainers = Array.from(document.querySelectorAll(
            'dialog, [role="dialog"], [aria-modal="true"], [class*="modal" i], [class*="Modal"], [class*="dialog" i], [class*="Dialog"], [class*="popup" i]'
          )).filter(isVisible);

          if (dialogContainers.length > 0) return true;

          // Atau cari input dengan placeholder yang terlihat
          const inputs = Array.from(document.querySelectorAll('input[placeholder], input[type="text"]')).filter(el => {
            return isVisible(el) && el.offsetParent !== null;
          });
          return inputs.length > 0;
        });

        if (dialogDetected) {
          console.log(`${tag}     ✅ Dialog Create Key terdeteksi.`);
          break;
        }
      }

      // Jeda tenang agar dialog & animasi selesai sepenuhnya sebelum berinteraksi
      console.log(`${tag}     Menunggu dialog selesai render dan stabil...`);
      await sleep(3000);

      // === Sub-step 9.3: Masukkan nama apikey di placeholder dialog ===
      console.log(`${tag}     [9.3] Memasukkan nama API key "${CONFIG.keyName}" di placeholder dialog...`);
      let nameInputFilled = false;

      for (let attempt = 0; attempt < 6 && !nameInputFilled; attempt++) {
        // Cari elemen input di dalam dialog
        const inputHandle = await page.evaluateHandle(() => {
          const isVisible = (el) => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && el.offsetParent !== null;
          };

          // Cari container dialog/modal terlebih dahulu
          const dialogContainers = Array.from(document.querySelectorAll(
            'dialog, [role="dialog"], [aria-modal="true"], [class*="modal" i], [class*="Modal"], [class*="dialog" i], [class*="Dialog"], [class*="popup" i]'
          )).filter(isVisible);

          for (const d of dialogContainers) {
            const inputs = Array.from(d.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])')).filter(isVisible);
            if (inputs.length > 0) {
              const withPh = inputs.find(i => i.placeholder && i.placeholder.trim().length > 0);
              return withPh || inputs[0];
            }
          }

          // Fallback: cari input visible di halaman dengan placeholder
          const allInputs = Array.from(document.querySelectorAll('input[type="text"], input[placeholder], input:not([type])')).filter(isVisible);
          const withPh = allInputs.find(i => i.placeholder && i.placeholder.trim().length > 0);
          if (withPh) return withPh;

          return allInputs[0] || null;
        });

        const inputEl = inputHandle.asElement();
        if (inputEl) {
          try {
            await inputEl.click();
            await sleep(500);

            // Bersihkan field yang ada secara tenang
            await page.keyboard.down('Control');
            await page.keyboard.press('a');
            await page.keyboard.up('Control');
            await sleep(300);
            await page.keyboard.press('Backspace');
            await sleep(500);

            // Ketik nama key dengan kecepatan wajar
            await inputEl.type(CONFIG.keyName, { delay: 100 });
            await sleep(1000);

            // Cek apakah teks berhasil terisi
            const currentVal = await page.evaluate(el => el.value, inputEl);
            if (currentVal === CONFIG.keyName) {
              console.log(`${tag}     ✅ Nama API key "${CONFIG.keyName}" berhasil diisi.`);
              nameInputFilled = true;
              break;
            } else {
              // Fallback set value via JS
              await page.evaluate((el, val) => {
                el.value = val;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
              }, inputEl, CONFIG.keyName);
              console.log(`${tag}     ✅ Nama API key "${CONFIG.keyName}" diset via event.`);
              nameInputFilled = true;
              break;
            }
          } catch (err) {
            console.log(`${tag}     Percobaan input nama gagal: ${err.message}`);
          }
        }

        if (!nameInputFilled) {
          await sleep(1500);
        }
      }

      if (!nameInputFilled) {
        console.log(`${tag}     [WARN] Input placeholder di dialog belum berhasil diisi.`);
      }

      // JEDA PENTING: Tunggu 3 detik setelah input agar validasi form aktif dan tombol Create Key tidak disabled
      console.log(`${tag}     Menunggu validasi form dan tombol aktif...`);
      await sleep(3000);

      // === Sub-step 9.4: Klik Create Key yang ada di dialog ===
      console.log(`${tag}     [9.4] Mengklik tombol Create Key yang ada di dalam dialog...`);
      await sleep(1000);

      const dialogClickResult = await page.evaluate(() => {
        const isVisible = (el) => {
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && el.offsetParent !== null;
        };

        // Cari dialog/modal aktif
        const dialogContainers = Array.from(document.querySelectorAll(
          'dialog, [role="dialog"], [aria-modal="true"], [class*="modal" i], [class*="Modal"], [class*="dialog" i], [class*="Dialog"], [class*="popup" i]'
        )).filter(isVisible);

        const targetKeywords = [
          "create key",
          "create",
          "confirm",
          "save",
          "submit",
          "ok",
          "generate",
          "创建密钥",
          "新建密钥",
          "创建"
        ];

        // 1. Cari tombol di dalam dialog/modal
        for (const d of dialogContainers) {
          const buttons = Array.from(d.querySelectorAll("button, a, input[type='submit'], div[role='button']")).filter(isVisible);

          // Prioritas 1: Exact / includes "create key"
          for (const btn of buttons) {
            const txt = (btn.innerText || btn.textContent || btn.value || "").trim().toLowerCase();
            if (txt === "create key" || txt.includes("create key")) {
              btn.scrollIntoView({ behavior: "instant", block: "center" });
              btn.click();
              return { success: true, text: txt, location: "dialog-create-key" };
            }
          }

          // Prioritas 2: targetKeywords lainnya (create, confirm, save, dll.)
          for (const kw of targetKeywords) {
            for (const btn of buttons) {
              const txt = (btn.innerText || btn.textContent || btn.value || "").trim().toLowerCase();
              if (txt === kw || (txt.includes(kw) && txt.length < 25 && !txt.includes("cancel") && !txt.includes("batal"))) {
                btn.scrollIntoView({ behavior: "instant", block: "center" });
                btn.click();
                return { success: true, text: txt, location: "dialog-keyword" };
              }
            }
          }

          // Prioritas 3: Button type="submit" atau button dengan class primary
          for (const btn of buttons) {
            const txt = (btn.innerText || btn.textContent || btn.value || "").trim().toLowerCase();
            const cls = (btn.className || "").toLowerCase();
            if (!txt.includes("cancel") && !txt.includes("batal") && !txt.includes("close")) {
              if (btn.type === "submit" || cls.includes("primary") || cls.includes("submit") || cls.includes("confirm")) {
                btn.scrollIntoView({ behavior: "instant", block: "center" });
                btn.click();
                return { success: true, text: txt || "submit-button", location: "dialog-primary" };
              }
            }
          }
        }

        // 2. Fallback jika container dialog tidak terisolasi: cari tombol visible terdepan dengan teks "create key"
        const allButtons = Array.from(document.querySelectorAll("button, div[role='button']")).filter(isVisible);
        for (const btn of allButtons) {
          const txt = (btn.innerText || btn.textContent || "").trim().toLowerCase();
          if (txt === "create key" || txt.includes("create key") || txt === "create") {
            btn.scrollIntoView({ behavior: "instant", block: "center" });
            btn.click();
            return { success: true, text: txt, location: "page-fallback" };
          }
        }

        return { success: false };
      });

      if (dialogClickResult && dialogClickResult.success) {
        console.log(`${tag}     ✅ Tombol "${dialogClickResult.text}" di dialog berhasil diklik! (${dialogClickResult.location})`);
      } else {
        console.log(`${tag}     [WARN] Tombol Create Key di dialog belum ditemukan, coba tekan tombol Enter...`);
        await sleep(1000);
        await page.keyboard.press('Enter');
      }

      // Beri jeda 5 detik agar request pembuatan key selesai diproses oleh server Atria
      console.log(`${tag}     Menunggu proses pembuatan API Key oleh server Atria...`);
      await sleep(5000);
      await waitForPageFullyLoaded(page, tag);
      await sleep(2000);
    }

    // ====================================================================
    // Step 10: Ekstrak API Key HANYA Menggunakan Aksi Copy
    // ====================================================================
    console.log(`${tag} [10] Mengekstrak API Key HANYA menggunakan aksi COPY...`);
    await sleep(3000); // Beri jeda santai sebelum mencari tombol copy

    // Pastikan hook clipboard juga terpasang pada konteks halaman saat ini
    try {
      await page.evaluate(() => {
        if (!window.__lastCopiedText) window.__lastCopiedText = "";
        if (navigator.clipboard && !navigator.clipboard.__customHooked) {
          const origWrite = navigator.clipboard.writeText;
          navigator.clipboard.writeText = async function (text) {
            window.__lastCopiedText = String(text);
            try {
              if (origWrite) return await origWrite.apply(this, arguments);
            } catch (_) { }
            return Promise.resolve();
          };
          navigator.clipboard.__customHooked = true;
        }
      });
    } catch (_) { }

    // Retry pencarian tombol Copy sampai 12 kali (dengan jeda 2 detik per iterasi)
    for (let extractAttempt = 0; extractAttempt < 12 && !apiKey; extractAttempt++) {
      console.log(`${tag}     [10.1] Mencari dan mengklik tombol/aksi Copy (percobaan ${extractAttempt + 1})...`);

      const copyClickResult = await page.evaluate(() => {
        const isVisible = (el) => {
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && el.offsetParent !== null;
        };

        const isCopyElement = (el) => {
          const txt = (el.innerText || el.textContent || el.value || "").trim().toLowerCase();
          const aria = (el.getAttribute("aria-label") || "").toLowerCase();
          const title = (el.getAttribute("title") || "").toLowerCase();
          const cls = (el.className || "").toString().toLowerCase();
          const dataAction = (el.getAttribute("data-action") || "").toLowerCase();

          return (
            txt === "copy" ||
            txt === "copy key" ||
            txt === "copy api key" ||
            txt === "copy token" ||
            txt.includes("copy") ||
            txt.includes("salin") ||
            txt.includes("复制") ||
            aria.includes("copy") ||
            aria.includes("salin") ||
            title.includes("copy") ||
            title.includes("salin") ||
            cls.includes("copy") ||
            dataAction.includes("copy")
          );
        };

        // 1. Prioritas Utama: Cari tombol Copy di dalam dialog/modal hasil create key
        const dialogs = Array.from(document.querySelectorAll(
          'dialog, [role="dialog"], [aria-modal="true"], [class*="modal" i], [class*="Modal"], [class*="dialog" i], [class*="Dialog"], [class*="popup" i]'
        )).filter(isVisible);

        for (const d of dialogs) {
          const candidates = Array.from(d.querySelectorAll("button, a, div[role='button'], svg, span")).filter(isVisible);
          for (const el of candidates) {
            if (isCopyElement(el)) {
              const targetBtn = el.closest("button, a, div[role='button']") || el;
              targetBtn.scrollIntoView({ behavior: "instant", block: "center" });
              targetBtn.click();
              return { clicked: true, location: "dialog-copy-btn" };
            }
          }

          // Cek jika elemen di modal memiliki data-clipboard-text
          const clipEls = Array.from(d.querySelectorAll("[data-clipboard-text]")).filter(isVisible);
          if (clipEls.length > 0) {
            clipEls[0].click();
            return { clicked: true, location: "dialog-data-clipboard", rawAttr: clipEls[0].getAttribute("data-clipboard-text") };
          }
        }

        // 2. Cari di baris tabel/list yang memuat key "satukey"
        const rows = Array.from(document.querySelectorAll("tr, div[role='row'], li")).filter(isVisible);
        for (const row of rows) {
          const rowText = (row.innerText || row.textContent || "").toLowerCase();
          if (rowText.includes("satukey")) {
            const buttons = Array.from(row.querySelectorAll("button, a, div[role='button'], svg")).filter(isVisible);
            for (const btn of buttons) {
              if (isCopyElement(btn)) {
                const targetBtn = btn.closest("button, a, div[role='button']") || btn;
                targetBtn.scrollIntoView({ behavior: "instant", block: "center" });
                targetBtn.click();
                return { clicked: true, location: "table-row-copy-btn" };
              }
            }
          }
        }

        // 3. Fallback: Cari tombol Copy manapun yang terlihat di halaman
        const allButtons = Array.from(document.querySelectorAll("button, a, div[role='button']")).filter(isVisible);
        for (const btn of allButtons) {
          if (isCopyElement(btn)) {
            btn.scrollIntoView({ behavior: "instant", block: "center" });
            btn.click();
            return { clicked: true, location: "page-copy-btn" };
          }
        }

        return { clicked: false };
      });

      // Tunggu aksi copy memproses teks ke clipboard
      await sleep(1500);

      // Ambil teks hasil aksi copy
      let copiedText = "";

      // A. Ambil dari hook navigator.clipboard.writeText
      try {
        const hooked = await page.evaluate(() => window.__lastCopiedText || "");
        if (hooked && hooked.trim().length > 0) {
          copiedText = hooked;
          console.log(`${tag}     Teks tertangkap via clipboard hook.`);
        }
      } catch (_) { }

      // B. Ambil dari navigator.clipboard.readText()
      if (!copiedText) {
        try {
          const readResult = await page.evaluate(() => navigator.clipboard.readText());
          if (readResult && readResult.trim().length > 0) {
            copiedText = readResult;
            console.log(`${tag}     Teks terbaca via navigator.clipboard.readText().`);
          }
        } catch (_) { }
      }

      // C. Ambil dari atribut data-clipboard-text jika ada
      if (!copiedText && copyClickResult && copyClickResult.rawAttr) {
        copiedText = copyClickResult.rawAttr;
        console.log(`${tag}     Teks terbaca via data-clipboard-text.`);
      }

      if (copiedText) {
        const trimmed = copiedText.trim();
        // Validasi: pastikan bukan teks label tombol ("copy", "copied", "salin", dll.) dan memiliki panjang > 6
        if (
          trimmed.length >= 6 &&
          !["copy", "copied", "salin", "tersalin", "copy key", "copy api key"].includes(trimmed.toLowerCase())
        ) {
          // TANDA APAPUN TETAP DIIKUTSERTAKAN 100% (tidak menggunakan regex yang memotong simbol khusus)
          apiKey = trimmed;
          console.log(`${tag}     ✅ Berhasil menyalin API Key melalui aksi Copy dengan semua tanda utuh!`);
          break;
        }
      }

      await sleep(2000);
    }

    // Hasil
    if (apiKey) {
      console.log(`\n${tag} ✅ API KEY: ${apiKey}\n`);
      appendResult(account.email, apiKey, "SUCCESS");
      removeAccount(account.email); // Hapus akun yang sukses dari akun.txt
    } else {
      console.log(`${tag} ❌ Gagal mengekstrak API Key`);
      appendResult(account.email, null, "FAILED");
    }
  } catch (err) {
    console.error(`${tag} ❌ Error: ${err.message}`);
    appendResult(account.email, null, "ERROR");
  } finally {
    await context.close();
    console.log(`${tag} Selesai.`);
  }

  return apiKey;
}

async function main() {
  const accounts = readAccounts();
  console.log(`\nTotal akun: ${accounts.length}`);
  console.log(`Results akan disimpan di: ${CONFIG.resultFile}\n`);
  if (CONFIG.useRelay && CONFIG.relayUrl) {
    console.log(`Mode Relay: AKTIF ⚡ (${CONFIG.relayUrl})`);
  } else {
    console.log(`Mode Relay: NON-AKTIF (Direct Connection)`);
  }

  // Buat file result dengan header jika belum ada
  if (!fs.existsSync(CONFIG.resultFile)) {
    fs.writeFileSync(
      CONFIG.resultFile,
      `Timestamp | Email | Status | API Key\n${"=".repeat(80)}\n`,
      "utf-8"
    );
  }

  console.log("Membuka browser Puppeteer (dengan Stealth Plugin + Turbo Mode)...");
  const launchArgs = [
    // === Keamanan sandbox ===
    "--no-sandbox",
    "--disable-setuid-sandbox",

    // === Anti-deteksi ===
    "--disable-blink-features=AutomationControlled",

    // === Window ===
    "--window-size=1280,850",

    // === Performa: Disable GPU & rendering berat ===
    "--disable-gpu",
    "--disable-software-rasterizer",
    "--disable-dev-shm-usage",             // Hindari /dev/shm penuh
    "--disable-accelerated-2d-canvas",

    // === Performa: Disable fitur berat ===
    "--disable-extensions",                 // Tidak perlu extensions
    "--disable-component-extensions-with-background-pages",
    "--disable-default-apps",               // Tidak perlu default apps
    "--disable-translate",                  // Tidak perlu translate
    "--disable-sync",                       // Tidak perlu sync akun Chrome
    "--disable-background-networking",      // Tidak perlu update di background
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-hang-monitor",
    "--disable-prompt-on-repost",
    "--disable-domain-reliability",
    "--disable-client-side-phishing-detection",
    "--disable-ipc-flooding-protection",

    // === Performa: Disable notifikasi & popup ===
    "--disable-notifications",
    "--disable-popup-blocking",
    "--no-default-browser-check",
    "--no-first-run",

    // === Performa: Network optimisasi ===
    "--disable-features=IsolateOrigins,site-per-process,TranslateUI",
    "--enable-features=NetworkService,NetworkServiceInProcess",

    // === Performa: Reduce memory ===
    "--js-flags=--max-old-space-size=512",
    "--disable-logging",
    "--disable-breakpad",                   // Disable crash reporting

    // === Performa: Disable media berat ===
    "--autoplay-policy=no-user-gesture-required",
    "--disable-component-update",
  ];

  if (CONFIG.proxyServer) {
    launchArgs.push(`--proxy-server=${CONFIG.proxyServer}`);
    console.log(`Proxy server diterapkan: ${CONFIG.proxyServer}`);
  }

  const browser = await puppeteer.launch({
    headless: CONFIG.headless,
    args: launchArgs,
    defaultViewport: { width: 1280, height: 850 },
    ignoreDefaultArgs: ["--enable-automation"],
  });

  const results = [];

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    const apiKey = await registerOne(browser, account, i + 1, accounts.length);
    results.push({ email: account.email, apiKey });

    if (i < accounts.length - 1) {
      console.log(`\nMenunggu ${CONFIG.delayBetweenAccounts / 1000} detik sebelum akun berikutnya...\n`);
      await sleep(CONFIG.delayBetweenAccounts);
    }
  }

  await browser.close();

  // Ringkasan
  console.log(`\n${"=".repeat(60)}`);
  console.log("RINGKASAN HASIL");
  console.log(`${"=".repeat(60)}`);
  const success = results.filter((r) => r.apiKey);
  const failed = results.filter((r) => !r.apiKey);
  console.log(`Total  : ${results.length}`);
  console.log(`Sukses : ${success.length}`);
  console.log(`Gagal  : ${failed.length}`);

  if (success.length > 0) {
    console.log(`\nAPI Keys yang didapat:`);
    success.forEach((r) => console.log(`  ${r.email} -> ${r.apiKey}`));
  }

  if (failed.length > 0) {
    console.log(`\nAkun yang belum berhasil:`);
    failed.forEach((r) => console.log(`  ${r.email}`));
  }

  console.log(`\nDetail hasil tersimpan di: ${CONFIG.resultFile}`);
}

main();
