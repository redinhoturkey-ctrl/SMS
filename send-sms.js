// send-sms.js — tourne dans GitHub Actions
// Les dates sont stockées au format "2026-03-20T21:27" (heure locale France)
// GitHub Actions tourne en UTC — on ajoute le bon offset

const fs    = require('fs');
const https = require('https');

const SMS_USER = process.env.SMS_USER;
const SMS_PASS = process.env.SMS_PASS;
const SMS_HOST = 'smsapi.free-mobile.fr';
const FILE     = 'reminders.json';

// ── Fuseau horaire France ─────────────────────────────────────
// Europe/Paris : UTC+1 en hiver, UTC+2 en été (DST)
// On détecte automatiquement si on est en heure d'été ou d'hiver
function getFranceOffsetMs() {
  const now = new Date();
  const year = now.getUTCFullYear();

  // Dernier dimanche de mars à 2h UTC → début heure d'été
  const lastSundayMarch = getLastSunday(year, 2); // mois 2 = mars (0-indexé)
  // Dernier dimanche d'octobre à 1h UTC → fin heure d'été
  const lastSundayOctober = getLastSunday(year, 9); // mois 9 = octobre

  const isDST = now >= lastSundayMarch && now < lastSundayOctober;
  const offsetH = isDST ? 2 : 1;
  console.log(`🌍 Fuseau France : UTC+${offsetH} (${isDST ? 'heure d\'été' : 'heure d\'hiver'})`);
  return offsetH * 60 * 60 * 1000;
}

function getLastSunday(year, month) {
  // Dernier dimanche du mois
  const d = new Date(Date.UTC(year, month + 1, 0)); // dernier jour du mois
  d.setUTCDate(d.getUTCDate() - d.getUTCDay()); // recule au dimanche
  return d;
}

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

const nowUTC   = Date.now();
const offsetMs = getFranceOffsetMs();

console.log(`🕐 Heure UTC actuelle   : ${new Date(nowUTC).toISOString()}`);
console.log(`🕐 Heure France actuelle : ${new Date(nowUTC + offsetMs).toISOString().replace('T',' ').slice(0,16)}`);
console.log(`📋 ${reminders.length} rappel(s) trouvé(s)`);

let changed = false;

// ── Envoi SMS ─────────────────────────────────────────────────
function sendSMS(message) {
  return new Promise((resolve, reject) => {
    const path = `/sendmsg?user=${encodeURIComponent(SMS_USER)}&pass=${encodeURIComponent(SMS_PASS)}&msg=${encodeURIComponent(message)}`;
    const options = { hostname: SMS_HOST, path, method: 'GET' };
    console.log(`📡 Appel API Free Mobile…`);
    const req = https.request(options, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        console.log(`📨 Réponse HTTP ${res.statusCode} : "${body.trim()}"`);
        resolve(res.statusCode === 200);
      });
    });
    req.on('error', err => { console.error('❌ Erreur réseau:', err.message); reject(err); });
    req.end();
  });
}

// ── Vérifier chaque rappel ────────────────────────────────────
async function main() {
  for (const r of reminders) {
    console.log(`\n--- "${r.title}" | dt: ${r.dt} | smsSent: ${r.smsSent} | done: ${r.done}`);

    if (r.smsSent) { console.log('⏭️  Déjà envoyé.'); continue; }
    if (r.done)    { console.log('⏭️  Marqué done.'); continue; }

    // dt est en heure locale France (ex: "2026-03-20T21:27")
    // On le convertit en UTC en soustrayant l'offset
    const triggerLocal = new Date(r.dt).getTime(); // JS parse sans timezone = heure locale du serveur (UTC)
    // Donc on doit ajouter l'offset pour obtenir le vrai timestamp UTC correspondant à l'heure France
    const triggerUTC = triggerLocal - offsetMs;

    const diffMin = (nowUTC - triggerUTC) / 60000;
    console.log(`⏱️  Heure du rappel (France) : ${r.dt}`);
    console.log(`⏱️  Heure du rappel (UTC)    : ${new Date(triggerUTC).toISOString()}`);
    console.log(`⏱️  Différence : ${diffMin.toFixed(1)} min (positif = passé)`);

    if (triggerUTC <= nowUTC) {
      console.log(`🔔 C'est l'heure ! Envoi du SMS…`);
      try {
        const ok = await sendSMS('⏰ Rappel : ' + r.title);
        if (ok) {
          r.smsSent = true;
          r.smsSentAt = new Date().toISOString();
          changed = true;
          console.log('✅ SMS envoyé !');
        } else {
          console.log('⚠️ Échec envoi SMS (non-200).');
        }
      } catch(e) {
        console.error('❌ Exception:', e.message);
      }
    } else {
      const waitMin = (triggerUTC - nowUTC) / 60000;
      console.log(`⏳ Pas encore l'heure (dans ${waitMin.toFixed(1)} min).`);
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
