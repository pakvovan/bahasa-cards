/* Service worker: офлайн-режим.
   Стратегия network-first — онлайн всегда свежие файлы (кэш-бастинг ?v работает),
   офлайн отдаёт последнюю сохранённую версию из кеша.
   GET-запросы (файлы приложения, словарь, чтение из Supabase) кэшируются.
   POST/PATCH/DELETE (запись прогресса, отзыв) — только сеть. */
const CACHE = "bahasa-cache-v1";

self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return; // запись идёт только по сети
  e.respondWith(
    fetch(req)
      .then((res) => {
        // сохраняем копию успешного ответа в кеш
        if (res && (res.ok || res.type === "opaque")) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((r) => {
          if (r) return r;
          // для перехода по адресу — отдать сохранённую главную
          if (req.mode === "navigate") return caches.match("./");
          return Response.error();
        })
      )
  );
});
