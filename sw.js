// ─── SERVICE WORKER — Moi App ───────────────────────────────
const SMS_BASE = 'https://smsapi.free-mobile.fr/sendmsg';
const SMS_USER = '39023030';
const SMS_PASS = '49aavAblDPIaTP';
const CACHE_NAME = 'moi-v2';
const BASE = '/SMS/';

const CACHE_FILES = [
  BASE,
  BASE + 'index.html',
  BASE + 'manifest.json'
];

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
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ─── FETCH ──────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  if (e.request.url.includes('smsapi.free-mobile.fr')) return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

// ─── RAPPELS EN ARRIÈRE-PLAN ────────────────────────────────
let scheduledReminders = [];
let checkTimer = null;

function startLoop() {
  if (checkTimer) return;
  checkTimer = setInterval(checkReminders, 30000);
  checkReminders();
}

function stopLoop() {
  if (scheduledReminders.length === 0 && checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
}

async function checkReminders() {
  const now = Date.now();
  const toFire   = scheduledReminders.filter(r => new Date(r.dt).getTime() <= now);
  scheduledReminders = scheduledReminders.filter(r => new Date(r.dt).getTime() > now);
  for (const r of toFire) await fireReminder(r);
  stopLoop();
}

async function fireReminder(r) {
  // Notification push
  try {
    await self.registration.showNotification('⏰ Rappel — Moi', {
      body: r.title,
      tag: 'reminder-' + r.id,
      requireInteraction: true,
      data: { id: r.id }
    });
  } catch(e) {}

  // SMS
  let smsSent = false;
  try {
    const url = `${SMS_BASE}?user=${SMS_USER}&pass=${encodeURIComponent(SMS_PASS)}&msg=${encodeURIComponent('⏰ Rappel : ' + r.title)}`;
    await fetch(url, { mode: 'no-cors' });
    smsSent = true;
  } catch(e) {}

  // Informer l'app si elle est ouverte
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  clients.forEach(c => c.postMessage({ type: 'REMINDER_FIRED', id: r.id, smsSent }));
}

// ─── MESSAGES DEPUIS L'APP ──────────────────────────────────
self.addEventListener('message', e => {
  const { type } = e.data || {};

  if (type === 'SCHEDULE_REMINDER') {
    scheduledReminders = scheduledReminders.filter(r => r.id !== e.data.reminder.id);
    scheduledReminders.push(e.data.reminder);
    startLoop();
  }

  if (type === 'CANCEL_REMINDER') {
    scheduledReminders = scheduledReminders.filter(r => r.id !== e.data.id);
    stopLoop();
  }

  if (type === 'PING') {
    e.source && e.source.postMessage({ type: 'PONG', count: scheduledReminders.length });
  }
});

// ─── CLIC NOTIFICATION ──────────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clients => {
      if (clients.length > 0) return clients[0].focus();
      return self.clients.openWindow(BASE);
    })
  );
});
