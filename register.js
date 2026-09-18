const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

const CONFIG = {
  headless: true,
  timeout: 60000,
  consoleUrl: "https://console.atria-asi.ai/",
  keyName: "auto-key",
  akunFile: path.join(__dirname, "akun.txt"),
  resultFile: path.join(__dirname, "api_keys.txt"),
  delayBetweenAccounts: 5000,
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function waitAndType(page, selector, text, timeout = 15000) {
  await page.waitForSelector(selector, { visible: true, timeout });
  await sleep(500);
  await page.click(selector, { clickCount: 3 });
  await page.type(selector, text, { delay: 50 });
}

async function registerOne(browser, account, index, total) {
  const tag = `[${index}/${total}] ${account.email}`;
  console.log(`\n${"=".repeat(60)}`);
  console.log(`${tag} - Memulai...`);
  console.log(`${"=".repeat(60)}\n`);

  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.setDefaultTimeout(CONFIG.timeout);

  let apiKey = null;

  try {
    // Step 1: Open Atria console
    console.log(`${tag} [1] Buka Atria console...`);
    await page.goto(CONFIG.consoleUrl, { waitUntil: "networkidle2" });
    await sleep(3000);

    // Step 2: Click sign in
    console.log(`${tag} [2] Cari tombol sign in...`);
    const signInSelectors = [
      'a[href*="login"]',
      'a[href*="auth"]',
      'a[href*="signin"]',
      'a:has-text("Sign in")',
      'a:has-text("Open console")',
      'button:has-text("Sign in")',
      'button:has-text("Open console")',
    ];

    for (const sel of signInSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          await el.click();
          console.log(`${tag}     Klik: ${sel}`);
          break;
        }
      } catch (_) {}
    }
    await sleep(3000);

    // Step 3: Google sign-in
    console.log(`${tag} [3] Cari tombol Google sign-in...`);
    const googleSelectors = [
      'button:has-text("Google")',
      'a:has-text("Google")',
      '[data-provider="google"]',
      'button:has-text("Sign in with Google")',
      'a:has-text("Sign in with Google")',
    ];

    for (const sel of googleSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          await el.click();
          console.log(`${tag}     Klik Google: ${sel}`);
          break;
        }
      } catch (_) {}
    }
    await sleep(3000);

    // Step 4: Google email
    console.log(`${tag} [4] Input email Google...`);
    try {
      await waitAndType(page, 'input[type="email"]', account.email);
      await sleep(500);

      const nextBtns = ['#identifierNext', 'button:has-text("Next")', 'button:has-text("Berikutnya")'];
      for (const sel of nextBtns) {
        const el = await page.$(sel);
        if (el) { await el.click(); break; }
      }
    } catch (e) {
      console.log(`${tag}     Email field tidak ditemukan: ${e.message}`);
    }
    await sleep(3000);

    // Step 5: Google password
    console.log(`${tag} [5] Input password Google...`);
    try {
      await waitAndType(page, 'input[type="password"]', account.password);
      await sleep(500);

      const nextBtns = ['#passwordNext', 'button:has-text("Next")', 'button:has-text("Berikutnya")'];
      for (const sel of nextBtns) {
        const el = await page.$(sel);
        if (el) { await el.click(); break; }
      }
    } catch (e) {
      console.log(`${tag}     Password field tidak ditemukan: ${e.message}`);
    }

    // Step 6: Wait redirect
    console.log(`${tag} [6] Tunggu redirect ke Atria...`);
    await sleep(8000);
    console.log(`${tag}     URL sekarang: ${page.url()}`);

    // Handle consent
    for (const sel of ['button:has-text("Allow")', 'button:has-text("Continue")', 'button:has-text("Lanjutkan")', 'button:has-text("Accept")']) {
      try {
        const el = await page.$(sel);
        if (el) { await el.click(); await sleep(3000); break; }
      } catch (_) {}
    }

    // Step 7: Navigate to API keys
    console.log(`${tag} [7] Cari halaman API keys...`);
    await sleep(3000);
    const keyPageSelectors = [
      'a:has-text("API keys")', 'a:has-text("API Keys")', 'a:has-text("Keys")',
      'button:has-text("API keys")', 'a[href*="keys"]', 'a[href*="api-key"]',
    ];
    for (const sel of keyPageSelectors) {
      try {
        const el = await page.$(sel);
        if (el) { await el.click(); console.log(`${tag}     Ke API keys: ${sel}`); await sleep(3000); break; }
      } catch (_) {}
    }

    // Step 8: Create key
    console.log(`${tag} [8] Buat API key...`);
    const createSelectors = [
      'button:has-text("Create key")', 'button:has-text("Create")',
      'button:has-text("New key")', 'button:has-text("Generate")',
    ];
    for (const sel of createSelectors) {
      try {
        const el = await page.$(sel);
        if (el) { await el.click(); console.log(`${tag}     Klik: ${sel}`); await sleep(2000); break; }
      } catch (_) {}
    }

    // Type key name
    try {
      const nameInput = await page.$('input[type="text"]');
      if (nameInput) {
        await nameInput.click({ clickCount: 3 });
        await nameInput.type(CONFIG.keyName, { delay: 50 });
        await sleep(500);
        for (const sel of ['button:has-text("Create")', 'button:has-text("Save")', 'button:has-text("Confirm")', 'button:has-text("OK")']) {
          const el = await page.$(sel);
          if (el) { await el.click(); break; }
        }
        await sleep(3000);
      }
    } catch (_) {}

    // Step 9: Extract API key
    console.log(`${tag} [9] Extract API key...`);

    // From page text
    try {
      const pageText = await page.evaluate(() => document.body.innerText);
      const match = pageText.match(/atr_[a-zA-Z0-9_-]+/);
      if (match) apiKey = match[0];
    } catch (_) {}

    // From input fields
    if (!apiKey) {
      try {
        const inputs = await page.$$('input[type="text"], input[readonly], textarea');
        for (const input of inputs) {
          const value = await input.evaluate((el) => el.value || el.textContent);
          if (value && value.startsWith("atr_")) { apiKey = value; break; }
        }
      } catch (_) {}
    }

    // From copy button
    if (!apiKey) {
      try {
        const copyBtn = await page.$('button:has-text("Copy")');
        if (copyBtn) {
          await copyBtn.click();
          await sleep(1000);
          apiKey = await page.evaluate(() => navigator.clipboard.readText());
        }
      } catch (_) {}
    }

    // Result
    if (apiKey) {
      console.log(`\n${tag} ✅ API KEY: ${apiKey}\n`);
      appendResult(account.email, apiKey, "SUCCESS");
    } else {
      console.log(`${tag} ❌ Gagal extract API key`);
      const screenshot = path.join(__dirname, `error-${index}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      console.log(`${tag}    Screenshot: ${screenshot}`);
      appendResult(account.email, null, "FAILED");
    }
  } catch (err) {
    console.error(`${tag} ❌ Error: ${err.message}`);
    const screenshot = path.join(__dirname, `error-${index}.png`);
    try { await page.screenshot({ path: screenshot, fullPage: true }); } catch (_) {}
    appendResult(account.email, null, "ERROR");
  } finally {
    await context.close();
    console.log(`${tag} Browser context ditutup.`);
  }

  return apiKey;
}

async function main() {
  const accounts = readAccounts();
  console.log(`\nTotal akun: ${accounts.length}`);
  console.log(`Results akan disimpan di: ${CONFIG.resultFile}\n`);

  // Write header to result file
  fs.writeFileSync(
    CONFIG.resultFile,
    `Timestamp | Email | Status | API Key\n${"=".repeat(80)}\n`,
    "utf-8"
  );

  console.log("Launching browser...");
  const browser = await puppeteer.launch({
    headless: CONFIG.headless,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
    defaultViewport: { width: 1280, height: 800 },
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

  // Summary
  console.log(`\n${"=".repeat(60)}`);
  console.log("RINGKASAN HASIL");
  console.log(`${"=".repeat(60)}`);
  const success = results.filter((r) => r.apiKey);
  const failed = results.filter((r) => !r.apiKey);
  console.log(`Total: ${results.length}`);
  console.log(`Sukses: ${success.length}`);
  console.log(`Gagal: ${failed.length}`);

  if (success.length > 0) {
    console.log(`\nAPI Keys yang didapat:`);
    success.forEach((r) => console.log(`  ${r.email} -> ${r.apiKey}`));
  }

  if (failed.length > 0) {
    console.log(`\nAkun yang gagal:`);
    failed.forEach((r) => console.log(`  ${r.email}`));
  }

  console.log(`\nDetail hasil: ${CONFIG.resultFile}`);
}

main();
