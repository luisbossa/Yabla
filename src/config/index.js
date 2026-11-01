require("dotenv").config();
const path = require("path");

const root = path.resolve(__dirname, "../..");
const resolve = (p) => path.resolve(root, p);

function parseIceServers(raw) {
  try {
    const servers = JSON.parse(raw);
    if (Array.isArray(servers)) return servers;
  } catch {
    /* se usa el valor por defecto */
  }
  return [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }];
}

const isProduction = process.env.NODE_ENV === "production";

if (isProduction && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
  throw new Error("Define SESSION_SECRET (mínimo 32 caracteres) en el entorno de producción.");
}

/** URL pública: BASE_URL, o la que asignan Vercel/Render/Railway automáticamente. */
function publicUrl() {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL;
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  return `http://localhost:${process.env.PORT || 3000}`;
}

module.exports = {
  root,
  isProduction,
  port: Number(process.env.PORT) || 3000,
  baseUrl: publicUrl(),
  seedDemo: process.env.SEED_DEMO === "true",
  sessionSecret: process.env.SESSION_SECRET || "yabla-dev-secret",
  // Turso en producción; archivo SQLite local si no se define TURSO_DATABASE_URL
  databaseUrl: process.env.TURSO_DATABASE_URL || `file:${resolve(process.env.DATABASE_PATH || "./data/yabla.db").replace(/\\/g, "/")}`,
  databaseAuthToken: process.env.TURSO_AUTH_TOKEN || undefined,
  iceServers: parseIceServers(process.env.ICE_SERVERS),
  // Tiempo real con Pusher Channels (sin estas variables no hay eventos en vivo)
  pusher: {
    appId: process.env.PUSHER_APP_ID,
    key: process.env.PUSHER_KEY,
    secret: process.env.PUSHER_SECRET,
    cluster: process.env.PUSHER_CLUSTER || "us2",
    // Fuera de producción los canales llevan "dev-": así se puede usar la misma app de Pusher
    // en local sin que los eventos lleguen a los usuarios de producción (que tienen los mismos ids)
    prefix: isProduction ? "" : "dev-",
  },
  // Vercel Blob para los archivos subidos. Dos formas de conectarlo: token fijo (BLOB_READ_WRITE_TOKEN)
  // o la conexión nueva de Vercel (BLOB_STORE_ID + credencial OIDC que Vercel da a cada función).
  // Sin ninguna, los archivos se guardan en la base de datos (desarrollo local).
  blobToken: process.env.BLOB_READ_WRITE_TOKEN || null,
  blobMode: process.env.BLOB_READ_WRITE_TOKEN ? "token" : process.env.BLOB_STORE_ID ? "oidc" : null,
  // Clave que debe enviar el cron externo a /api/cron/tick
  cronSecret: process.env.CRON_SECRET || null,
  // Contacto del emisor de notificaciones push (lo exige el estándar VAPID: mailto: o https:)
  vapidSubject: process.env.VAPID_SUBJECT || "mailto:hola@yabla.app",
  sessionMaxAge: 1000 * 60 * 60 * 24 * 30, // 30 días
  storyTtl: 1000 * 60 * 60 * 24, // 24 horas
  uploadLimit: 4 * 1024 * 1024, // 4 MB: Vercel no acepta peticiones de más de 4,5 MB
  videoUploadLimit: 16 * 1024 * 1024, // 16 MB solo para videos (≈ 1 minuto en calidad media)
  videoMaxSeconds: 60,
  initialBalanceCents: 50000, // $500 de saldo de demostración
  initialBalanceCrcCents: 25000000, // ₡250.000 de saldo de demostración
  // Solo para pruebas locales: permite vista previa de enlaces a direcciones internas (nunca en producción)
  linkPreviewAllowPrivate: !isProduction && process.env.LINK_PREVIEW_ALLOW_PRIVATE === "true",
};
