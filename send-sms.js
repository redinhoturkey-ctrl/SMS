// send-sms.js — tourne dans GitHub Actions
// Les dates sont stockées en UTC ISO par l'app (ex: "2026-03-21T19:55:00.000Z")
// Pas besoin de conversion de fuseau horaire

const fs    = require('fs');
const https = require('https');

const SMS_USER = process.env.SMS_USER;
const SMS_PASS = process.env.SMS_PASS;
const SMS_HOST = 'smsapi.free-mobile.fr';
const FILE     = 'reminders.json';

// ── Lire les rappels ──────────────────────────────
let reminders = [];
try {
  const raw = fs.readFileSync(FILE, 'utf8').trim();
  reminders = JSON.parse(raw || '[]');
} catch (e) {
  console.log('reminders.json vide ou inexistant.');
  process.exit(0);
}

if (!Array.isArray(reminders) || reminders.length === 0) {
  console.log('Aucun rappel en attente.');
  process.exit(0);
}

const nowUTC = Date.now();
console.log(`🕐 Heure UTC : ${new Date(nowUTC).toISOString()}`);
console.log(`📋 ${reminders.length} rappel(s) trouvé(s)`);

let changed = false;

// ── Envoi SMS ─────────────────────────────────────
function sendSMS(message) {
  return new Promise((resolve, reject) => {
    const path = `/sendmsg?user=${encodeURIComponent(SMS_USER)}&pass=${encodeURIComponent(SMS_PASS)}&msg=${encodeURIComponent(message)}`;
    const req = https.request({ hostname: SMS_HOST, path, method: 'GET' }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        console.log(`📨 HTTP ${res.statusCode} : "${body.trim()}"`);
        resolve(res.statusCode === 200);
      });
    });
    req.on('error', err => { console.error('❌ Réseau:', err.message); reject(err); });
    req.end();
  });
}

// ── Vérifier chaque rappel ────────────────────────
async function main() {
  for (const r of reminders) {
    console.log(`\n--- "${r.title}" | dt: ${r.dt} | smsSent: ${r.smsSent} | done: ${r.done}`);

    if (r.smsSent) { console.log('⏭️  Déjà envoyé.'); continue; }
    if (r.done)    { console.log('⏭️  Done.'); continue; }

    // dt est en UTC ISO → comparaison directe, pas de conversion
    const triggerUTC = new Date(r.dt).getTime();
    const diffMin    = (nowUTC - triggerUTC) / 60000;

    console.log(`⏱️  Différence : ${diffMin.toFixed(1)} min (positif = passé)`);

    if (triggerUTC <= nowUTC) {
      console.log(`🔔 Déclenchement : "${r.title}"`);
      try {
        const ok = await sendSMS('⏰ Rappel : ' + r.title);
        if (ok) {
          r.smsSent  = true;
          r.smsSentAt = new Date().toISOString();
          changed    = true;
          console.log('✅ SMS envoyé !');
        } else {
          console.log('⚠️ Échec SMS.');
        }
      } catch(e) {
        console.error('❌', e.message);
      }
    } else {
      console.log(`⏳ Dans ${((triggerUTC - nowUTC)/60000).toFixed(1)} min.`);
    }
  }

  if (changed) {
    fs.writeFileSync(FILE, JSON.stringify(reminders, null, 2));
    console.log('\n📝 reminders.json mis à jour.');
  } else {
    console.log('\nAucun changement.');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
