// send-sms.js — tourne dans GitHub Actions toutes les minutes
const fs    = require('fs');
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
  console.log('reminders.json vide ou inexistant.');
  process.exit(0);
}

if (!Array.isArray(reminders) || reminders.length === 0) {
  console.log('Aucun rappel en attente.');
  process.exit(0);
}

const now = Date.now();
console.log(`🕐 Heure actuelle : ${new Date(now).toISOString()}`);
console.log(`📋 ${reminders.length} rappel(s) trouvé(s) dans le fichier`);

let changed = false;

// ── Envoi SMS ─────────────────────────────────────────────────
function sendSMS(message) {
  return new Promise((resolve, reject) => {
    const path = `/sendmsg?user=${encodeURIComponent(SMS_USER)}&pass=${encodeURIComponent(SMS_PASS)}&msg=${encodeURIComponent(message)}`;
    const options = { hostname: SMS_HOST, path, method: 'GET' };
    console.log(`📡 Appel API : https://${SMS_HOST}${path.replace(SMS_PASS, '***')}`);
    const req = https.request(options, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        console.log(`📨 Réponse HTTP ${res.statusCode} : ${body.trim()}`);
        if (res.statusCode === 200) resolve(true);
        else resolve(false);
      });
    });
    req.on('error', err => { console.error('❌ Erreur réseau:', err.message); reject(err); });
    req.end();
  });
}

// ── Vérifier chaque rappel ────────────────────────────────────
async function main() {
  for (const r of reminders) {
    console.log(`\n--- Rappel : "${r.title}" | dt: ${r.dt} | done: ${r.done} | smsSent: ${r.smsSent}`);

    if (r.smsSent) { console.log('⏭️  Déjà envoyé, on passe.'); continue; }
    if (r.done)    { console.log('⏭️  Marqué done, on passe.'); continue; }

    const triggerTime = new Date(r.dt).getTime();
    const diffMin = (now - triggerTime) / 60000;
    console.log(`⏱️  Différence : ${diffMin.toFixed(1)} minutes (positif = dans le passé)`);

    // Envoyer si le rappel est passé (même depuis longtemps) et pas encore envoyé
    if (triggerTime <= now) {
      console.log(`🔔 Déclenchement du rappel : "${r.title}"`);
      try {
        const ok = await sendSMS('⏰ Rappel : ' + r.title);
        if (ok) {
          r.smsSent = true;
          r.smsSentAt = new Date().toISOString();
          changed = true;
          console.log('✅ SMS envoyé avec succès !');
        } else {
          console.log('⚠️ SMS échoué (réponse non-200).');
        }
      } catch (e) {
        console.error('❌ Exception lors de l\'envoi:', e.message);
      }
    } else {
      const waitMin = (triggerTime - now) / 60000;
      console.log(`⏳ Pas encore l'heure (dans ${waitMin.toFixed(1)} min).`);
    }
  }

  if (changed) {
    fs.writeFileSync(FILE, JSON.stringify(reminders, null, 2));
    console.log('\n📝 reminders.json mis à jour (smsSent = true).');
  } else {
    console.log('\nAucun changement dans reminders.json.');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
