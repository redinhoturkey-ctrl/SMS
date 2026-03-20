// send-sms.js — tourne dans GitHub Actions toutes les minutes
const fs   = require('fs');
const https = require('https');

const SMS_USER = process.env.SMS_USER;
const SMS_PASS = process.env.SMS_PASS;
const SMS_HOST = 'smsapi.free-mobile.fr';
const FILE     = 'reminders.json';

// ── Lire les rappels ──────────────────────────────────────────
let reminders = [];
try {
  const raw = fs.readFileSync(FILE, 'utf8').trim();
  reminders = JSON.parse(raw || '[]');
} catch (e) {
  console.log('reminders.json vide ou inexistant, rien à faire.');
  process.exit(0);
}

if (!Array.isArray(reminders) || reminders.length === 0) {
  console.log('Aucun rappel en attente.');
  process.exit(0);
}

const now = Date.now();
let changed = false;

// ── Envoyer un SMS via HTTPS ──────────────────────────────────
function sendSMS(message) {
  return new Promise((resolve, reject) => {
    const path = `/sendmsg?user=${encodeURIComponent(SMS_USER)}&pass=${encodeURIComponent(SMS_PASS)}&msg=${encodeURIComponent(message)}`;
    const options = { hostname: SMS_HOST, path, method: 'GET' };
    const req = https.request(options, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        // Free Mobile renvoie 200 si OK
        if (res.statusCode === 200) {
          console.log(`✅ SMS envoyé (HTTP ${res.statusCode})`);
          resolve(true);
        } else {
          console.warn(`⚠️ SMS échoué (HTTP ${res.statusCode}): ${body}`);
          resolve(false);
        }
      });
    });
    req.on('error', err => {
      console.error('❌ Erreur réseau SMS:', err.message);
      reject(err);
    });
    req.end();
  });
}

// ── Vérifier chaque rappel ────────────────────────────────────
async function main() {
  for (const r of reminders) {
    // Ignorer : déjà envoyé, marqué done, ou heure pas encore atteinte
    if (r.smsSent || r.done) continue;

    const triggerTime = new Date(r.dt).getTime();

    // Fenêtre : entre -2 min et maintenant (tolérance si job a du retard)
    if (triggerTime <= now && triggerTime > now - 2 * 60 * 1000) {
      console.log(`🔔 Rappel déclenché : "${r.title}" (prévu ${r.dt})`);
      try {
        const ok = await sendSMS('⏰ Rappel : ' + r.title);
        if (ok) {
          r.smsSent = true;
          r.smsSentAt = new Date().toISOString();
          changed = true;
        }
      } catch (e) {
        console.error('Erreur envoi SMS:', e.message);
      }
    } else if (triggerTime <= now - 2 * 60 * 1000) {
      // Rappel très en retard (> 2 min) — on le marque quand même pour éviter le spam
      console.log(`⏭️ Rappel expiré (trop vieux) : "${r.title}"`);
      r.smsSent = true;
      r.smsSentAt = 'expired-' + new Date().toISOString();
      changed = true;
    }
  }

  // ── Réécrire reminders.json si modifié ──────────────────────
  if (changed) {
    fs.writeFileSync(FILE, JSON.stringify(reminders, null, 2));
    console.log('📝 reminders.json mis à jour.');
  } else {
    console.log('Aucun rappel à déclencher maintenant.');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
