// Notificaciones push (Web Push con claves VAPID): llegan aunque Yabla esté cerrada.
//
// Cuándo se envían: a cada participante (menos quien escribe) que NO tenga Yabla a la
// vista en ningún dispositivo; si la tiene abierta, ya recibe el aviso y el sonido en la app.
// Se respetan los chats silenciados (salvo @menciones) y el estado «No molestar».
//
// Claves: VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY del entorno; si no están, se generan una vez
// y se guardan en la base de datos (tabla app_settings) para que sobrevivan a los reinicios.
const webpush = require("web-push");
const db = require("../config/database");
const config = require("../config");
const User = require("../models/User");
const Conversation = require("../models/Conversation");
const PushSubscription = require("../models/PushSubscription");
const presence = require("./presence");

let keys = null;

async function setting(key) {
  return (await db.get("SELECT value FROM app_settings WHERE key = ?", [key]))?.value || null;
}

/** Prepara las claves VAPID. Se llama una vez al arrancar el servidor. */
async function init() {
  let publicKey = process.env.VAPID_PUBLIC_KEY;
  let privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    publicKey = await setting("vapid_public_key");
    privateKey = await setting("vapid_private_key");
    if (!publicKey || !privateKey) {
      ({ publicKey, privateKey } = webpush.generateVAPIDKeys());
      await db.batch([
        ["INSERT OR REPLACE INTO app_settings (key, value) VALUES ('vapid_public_key', ?)", [publicKey]],
        ["INSERT OR REPLACE INTO app_settings (key, value) VALUES ('vapid_private_key', ?)", [privateKey]],
      ]);
      console.log("Notificaciones push: claves VAPID generadas y guardadas en la base de datos.");
    }
  }
  webpush.setVapidDetails(config.vapidSubject, publicKey, privateKey);
  keys = { publicKey, privateKey };
}

const publicKey = () => keys?.publicKey || null;

/** Envía un aviso a todos los dispositivos de los usuarios. Borra las suscripciones caducadas. */
async function sendToUsers(userIds, build, { urgency = "high", ttl = 60 * 60 * 24, topic } = {}) {
  if (!keys) return 0;
  const subs = await PushSubscription.forUsers(userIds);
  let sent = 0;
  await Promise.all(
    subs.map(async (sub) => {
      const payload = typeof build === "function" ? build(sub) : build;
      if (!payload) return;
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), {
          TTL: ttl,
          urgency,
          ...(topic ? { topic } : {}),
        });
        sent++;
        PushSubscription.touch(sub.id).catch(() => {});
      } catch (err) {
        // 404/410: el navegador anuló la suscripción (desinstaló la app, borró datos…)
        if (err.statusCode === 404 || err.statusCode === 410) await PushSubscription.removeEndpoint(sub.endpoint);
        else console.error("[push]", err.statusCode || "", err.body || err.message);
      }
    })
  );
  return sent;
}

// --- Texto del aviso -----------------------------------------------------------
const clip = (text, n = 140) => {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

function messageText(msg) {
  const meta = msg.meta || {};
  switch (msg.type) {
    case "text":
      return clip(msg.body);
    case "image":
      if (meta.viewOnce) return "📷 Foto de ver una vez";
      return msg.body ? `📷 ${clip(msg.body)}` : "📷 Foto";
    case "video":
      if (meta.viewOnce) return "🎥 Video de ver una vez";
      return msg.body ? `🎥 ${clip(msg.body)}` : "🎥 Video";
    case "poll":
      return `📊 Encuesta: ${clip(msg.body, 80)}`;
    case "location":
      return msg.body ? `📍 ${clip(msg.body, 60)}` : "📍 Ubicación";
    case "audio":
      return "🎤 Nota de voz";
    case "file":
      return `📄 ${clip(meta.name || "Documento", 60)}`;
    case "sticker":
      return "Sticker";
    case "payment":
      return "💸 Te envió dinero";
    case "call":
      return meta.status === "completed" ? `${meta.callType === "video" ? "📹 Videollamada" : "📞 Llamada"}` : `${meta.callType === "video" ? "📹 Videollamada perdida" : "📞 Llamada perdida"}`;
    case "game":
      return `🎲 Esto o aquello: ${(meta.options || []).map((o) => clip(o, 30)).join(" o ")}`;
    case "date":
      return `📅 Te propuso una cita${meta.kind === "place" && meta.place ? `: ${clip(meta.place, 40)}` : ""}`;
    case "system":
      return meta.action === "matched" ? "¡Hicieron match en «Conocer»! 💞" : null;
    default:
      return null;
  }
}

/** Mensajes sin leer (no silenciados) de un usuario: número del icono de la app. */
async function unreadTotal(userId) {
  const row = await db.get(
    `SELECT COUNT(*) AS n FROM messages x
     JOIN conversation_members m ON m.conversation_id = x.conversation_id AND m.user_id = ?
     WHERE m.muted = 0 AND m.hidden = 0
       AND x.id > m.last_read_id AND x.id > m.cleared_id
       AND x.deleted_at IS NULL AND x.type <> 'system'
       AND (x.expires_at IS NULL OR x.expires_at > ?)
       AND (x.sender_id IS NULL OR x.sender_id <> m.user_id)`,
    [userId, Date.now()]
  );
  return row?.n || 0;
}

/** Aviso de un mensaje nuevo a quien no está mirando Yabla. */
async function notifyMessage(message) {
  if (!keys || message.deletedAt) return;
  const text = messageText(message);
  if (!text) return;

  const [conversation, members] = await Promise.all([
    Conversation.findById(message.conversationId),
    db.all("SELECT user_id, muted FROM conversation_members WHERE conversation_id = ?", [message.conversationId]),
  ]);
  if (!conversation) return;

  const mentions = new Set(message.meta?.mentions || []);
  const listeners = members.filter((m) => m.user_id !== message.senderId && (!m.muted || mentions.has(m.user_id)));
  if (!listeners.length) return;

  const users = await User.findMany([...listeners.map((m) => m.user_id), message.senderId]);
  const candidates = listeners.filter((m) => !presence.isActive(users.get(m.user_id)));
  if (!candidates.length) return;
  const sender = users.get(message.senderId);
  const isGroup = conversation.type === "group";

  await Promise.all(
    candidates.map(async ({ user_id: userId }) => {
      const user = users.get(userId);
      if (!user || user.presence_status === "dnd" || user.username === User.OFFICIAL_USERNAME) return;
      const unread = await unreadTotal(userId);
      const senderName = sender?.name || "Yabla";
      const title = isGroup ? conversation.name || "Grupo" : senderName;
      const body = isGroup && sender ? `${senderName.split(" ")[0]}: ${text}` : text;
      await sendToUsers([userId], (sub) => ({
        kind: "message",
        conversationId: conversation.id,
        messageId: message.id,
        // Sin vista previa: no se muestra quién ni qué (privacidad en la pantalla de bloqueo)
        title: sub.preview ? title : "Yabla",
        body: sub.preview ? body : "Tienes un mensaje nuevo",
        icon: sub.preview ? (isGroup ? conversation.avatar : sender?.avatar) || User.DEFAULT_AVATAR : "/assets/images/pwa/icon-192.png",
        mention: mentions.has(userId),
        unread,
        timestamp: message.createdAt,
        url: `/chat?c=${conversation.id}`,
      }));
    })
  );
}

/** Llamada entrante para quien tiene Yabla en segundo plano o cerrada. */
async function notifyCall({ callId, conversationId, type, caller, calleeId }) {
  if (!keys) return;
  const callee = await User.findById(calleeId);
  if (!callee || presence.isActive(callee) || callee.presence_status === "dnd") return;
  await sendToUsers(
    [calleeId],
    (sub) => ({
      kind: "call",
      callId,
      conversationId,
      title: sub.preview ? caller.name : "Yabla",
      body: type === "video" ? "📹 Videollamada entrante" : "📞 Llamada entrante",
      icon: sub.preview ? caller.avatar || User.DEFAULT_AVATAR : "/assets/images/pwa/icon-192.png",
      timestamp: Date.now(),
      url: `/chat?c=${conversationId}`,
    }),
    { urgency: "high", ttl: 30, topic: `call-${conversationId}` }
  );
}

/** Notificación de prueba desde Ajustes. */
function sendTest(user) {
  return sendToUsers([user.id], {
    kind: "test",
    title: "¡Las notificaciones funcionan! 🎉",
    body: `Hola ${user.name.split(" ")[0]}, así te avisaremos de tus mensajes nuevos.`,
    icon: "/assets/images/pwa/icon-192.png",
    timestamp: Date.now(),
    url: "/chat",
  });
}

module.exports = { init, publicKey, sendToUsers, notifyMessage, notifyCall, sendTest, messageText };
