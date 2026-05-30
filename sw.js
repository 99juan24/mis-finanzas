const CACHE = 'mis-finanzas-v2';
const FILES = ['./index.html', './manifest.json'];

// ── Instalación y caché ──────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(cached =>
      cached || fetch(e.request).catch(() => caches.match('./index.html'))
    )
  );
});

// ── Lógica de recordatorios ──────────────────────────────────────
function getDeudas() {
  // Los datos se guardan en localStorage por la app principal.
  // El SW no tiene acceso a localStorage, así que la app
  // los sincroniza al SW a través de mensajes postMessage.
  return self.__deudas__ || [];
}

function diffDays(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((d - now) / 86400000);
}

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('es-MX', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
}

function checkAndNotify(deudas) {
  if (!deudas || deudas.length === 0) return;

  deudas.forEach(d => {
    if (d.estado === 'pagada' || !d.vencimiento) return;

    const days = diffDays(d.vencimiento);
    const restante = d.monto - d.pagado;
    let title = '';
    let body = '';
    let tag = `deuda-${d.id}`;

    if (days < 0) {
      title = '⚠️ Deuda vencida';
      body = `${d.acreedor} — ${fmt(restante)} (venció hace ${Math.abs(days)} día${Math.abs(days) !== 1 ? 's' : ''})`;
    } else if (days === 0) {
      title = '🚨 Deuda vence HOY';
      body = `${d.acreedor} — ${fmt(restante)}`;
    } else if (days <= d.recordatorio) {
      title = `🔔 Deuda próxima a vencer`;
      body = `${d.acreedor} — ${fmt(restante)} (vence en ${days} día${days !== 1 ? 's' : ''})`;
    }

    if (title) {
      self.registration.showNotification(title, {
        body,
        tag,          // evita duplicados
        renotify: false,
        icon: './icon-192.png',
        badge: './icon-192.png',
        vibrate: [200, 100, 200],
        data: { url: self.registration.scope },
        actions: [
          { action: 'ver', title: 'Ver deuda' },
          { action: 'ok',  title: 'Entendido' }
        ]
      });
    }
  });
}

// ── Recibir deudas desde la app (postMessage) ────────────────────
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SYNC_DEUDAS') {
    self.__deudas__ = e.data.deudas;
    checkAndNotify(e.data.deudas);
  }
});

// ── Periodic Background Sync (Android Chrome) ───────────────────
self.addEventListener('periodicsync', e => {
  if (e.tag === 'check-deudas') {
    e.waitUntil(
      // Pedir los datos a la app si está abierta, o usar los últimos recibidos
      self.clients.matchAll().then(clients => {
        if (clients.length > 0) {
          clients[0].postMessage({ type: 'REQUEST_DEUDAS' });
        } else {
          // App cerrada: usar datos cacheados en el SW
          checkAndNotify(getDeudas());
        }
      })
    );
  }
});

// ── Click en notificación ────────────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'ok') return;

  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const existing = clients.find(c => c.url.includes(self.registration.scope));
      if (existing) return existing.focus();
      return self.clients.openWindow(e.notification.data?.url || self.registration.scope);
    })
  );
});
