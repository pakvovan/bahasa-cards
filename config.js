/* НАСТРОЙКА ПОДКЛЮЧЕНИЯ К SUPABASE
   Project URL и anon public key (Project Settings → API). Ключ публичный. */
window.SUPABASE_CONFIG = {
  url: "https://qflmamnlggofsowioorc.supabase.co",
  anonKey:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmbG1hbW5sZ2dvZnNvd2lvb3JjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1NDY4OTUsImV4cCI6MjA5NjEyMjg5NX0.illdk5hrOtrVIbFAKiofKL38XwrdyRIHIjNgMcHxRuY",
};

/* Кнопка «Донат». Поддерживает ссылку (url) и/или крипто-адрес (crypto). */
window.DONATE = {
  note: "Если приложение полезно — буду рад любой поддержке 🙏",
  url: "",
  crypto: {
    coin: "USDT",
    network: "TRC20 · TRON",
    address: "TQ7NvYtKg2oyDgkE3FQnaWiDMp3pbxgDag",
  },
};
