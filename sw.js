// ─── SERVICE WORKER — Moi App ───────────────────────────────
// Tourne en arrière-plan, vérifie les rappels et envoie les SMS

const SMS_BASE = 'https://smsapi.free-mobile.fr/sendmsg';
const SMS_USER = '39023030';
const SMS_PASS = '49aavAblDPIaTP';
const CACHE_NAME = 'moi-v1';
const CHECK_INTERVAL = 30000; // 30 secondes

// Fichiers à mettre en cache pour fonctionner hors-ligne
const CACHE_FILES = ['/', '/index.html', '/manifest.json'];

// ─── INSTALL ────────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CACHE_FILES))
      .then(() => self.skipWaiting())
  );
});

// ─── ACTIVATE ───────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ─── FETCH (cache first pour les assets) ────────────────────
self.addEventListener('fetch', e => {
  // Ne pas intercepter les appels SMS
  if (e.request.url.includes('smsapi.free-mobile.fr')) return;

  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

// ─── RAPPELS PLANIFIÉS (stockés en mémoire SW) ──────────────
let scheduledReminders = [];
let checkTimer = null;

function startCheckLoop() {
  if (checkTimer) return; // déjà lancé
  checkTimer = setInterval(checkReminders, CHECK_INTERVAL);
  checkReminders(); // vérification immédiate
}

function stopCheckLoop() {
  if (scheduledReminders.length === 0 && checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
}

async function checkReminders() {
  const now = Date.now();
  const toFire = scheduledReminders.filter(r => new Date(r.dt).getTime() <= now);
  const remaining = scheduledReminders.filter(r => new Date(r.dt).getTime() > now);
  scheduledReminders = remaining;

  for (const r of toFire) {
    await fireReminder(r);
  }

  stopCheckLoop();
}

async function fireReminder(r) {
  // 1) Notification push (visible même app fermée)
  try {
    await self.registration.showNotification('⏰ Rappel — Moi', {
      body: r.title,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'reminder-' + r.id,
      requireInteraction: true,
      data: { id: r.id }
    });
  } catch (e) {
    console.warn('Notification SW échouée:', e);
  }

  // 2) Envoi SMS via Free Mobile
  const smsText = encodeURIComponent('⏰ Rappel : ' + r.title);
  const smsUrl = `${SMS_BASE}?user=${SMS_USER}&pass=${encodeURIComponent(SMS_PASS)}&msg=${smsText}`;

  let smsSent = false;
  try {
    await fetch(smsUrl, { mode: 'no-cors' });
    smsSent = true;
  } catch (e) {
    console.warn('SMS SW échoué:', e);
  }

  // 3) Informer tous les onglets ouverts
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  clients.forEach(client => {
    client.postMessage({ type: 'REMINDER_FIRED', id: r.id, smsSent });
  });
}

// ─── MESSAGES DEPUIS L'APP ──────────────────────────────────
self.addEventListener('message', e => {
  const { type, reminder } = e.data || {};

  if (type === 'SCHEDULE_REMINDER' && reminder) {
    // Dédoublonnage
    scheduledReminders = scheduledReminders.filter(r => r.id !== reminder.id);
    scheduledReminders.push(reminder);
    startCheckLoop();
    e.source && e.source.postMessage({ type: 'SCHEDULED_OK', id: reminder.id });
  }

  if (type === 'CANCEL_REMINDER' && e.data.id) {
    scheduledReminders = scheduledReminders.filter(r => r.id !== e.data.id);
    stopCheckLoop();
  }

  if (type === 'PING') {
    // Permet à l'app de vérifier que le SW est vivant
    e.source && e.source.postMessage({ type: 'PONG', count: scheduledReminders.length });
  }
});

// ─── CLIC SUR NOTIFICATION ──────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clients => {
      if (clients.length > 0) {
        clients[0].focus();
      } else {
        self.clients.openWindow('/');
      }
    })
  );
});
