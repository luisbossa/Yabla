// Punto único para emitir eventos en vivo desde controladores y servicios (Pusher Channels).
// Cada usuario tiene el canal privado `private-user-<id>` (todas sus pestañas y dispositivos).
const Pusher = require("pusher");
const config = require("../config");
const User = require("../models/User");
const Conversation = require("../models/Conversation");
const background = require("../utils/background");

const enabled = Boolean(config.pusher.appId && config.pusher.key && config.pusher.secret);
if (!enabled) console.warn("⚠️  Sin PUSHER_APP_ID / PUSHER_KEY / PUSHER_SECRET: no habrá eventos en tiempo real.");

const { prefix, ...credentials } = config.pusher;
const pusher = enabled ? new Pusher({ ...credentials, useTLS: true }) : null;

const channel = (userId) => `private-${prefix}user-${userId}`;
const callChannel = (callId) => `presence-${prefix}call-${callId}`;

// Pusher rechaza eventos de más de 10 KB y admite hasta 100 canales por llamada
const MAX_PAYLOAD = 9500;
const MAX_CHANNELS = 100;

/** Envía el evento; si no cabe, el cliente recibe "sync" y recarga su estado desde la API. */
async function trigger(channels, event, payload, socketId) {
  if (!pusher || !channels.length) return;
  let data = payload;
  if (Buffer.byteLength(JSON.stringify(payload ?? null)) > MAX_PAYLOAD) {
    data = { event };
    event = "sync";
  }
  const options = socketId ? { socket_id: socketId } : undefined;
  for (let i = 0; i < channels.length; i += MAX_CHANNELS) {
    await pusher.trigger(channels.slice(i, i + MAX_CHANNELS), event, data, options);
  }
}

const realtime = {
  pusher,
  enabled,
  channel,
  callChannel,

  /** No hace falta await: la entrega sigue en segundo plano aunque ya se haya respondido. */
  toUsers(userIds, event, payload, { exceptSocket } = {}) {
    if (!userIds.length) return Promise.resolve();
    return background(trigger([...new Set(userIds)].map(channel), event, payload, exceptSocket), "tiempo real");
  },

  toCall(callId, event, payload, { exceptSocket } = {}) {
    return background(trigger([callChannel(callId)], event, payload, exceptSocket), "tiempo real");
  },

  async toConversation(conversationId, event, payload) {
    await realtime.toUsers(await Conversation.memberIds(conversationId), event, payload);
  },

  async message(message) {
    await realtime.toConversation(message.conversationId, "message:new", message);
    // Aviso push a quien no tiene Yabla a la vista (no bloquea el envío)
    background(require("./push").notifyMessage(message), "push");
  },

  messageUpdated(message) {
    return realtime.toConversation(message.conversationId, "message:update", message);
  },

  /** Cada miembro recibe la conversación tal como él la ve (no leídos, silencio, etc.). */
  async conversation(conversationId, userIds, event = "conversation:new") {
    const ids = userIds || (await Conversation.memberIds(conversationId));
    const viewers = await User.findMany(ids);
    await Promise.all(
      ids.map(async (userId) => {
        const viewer = viewers.get(userId);
        const conversation = viewer && (await Conversation.getForUser(conversationId, viewer));
        if (conversation) await realtime.toUsers([userId], event, conversation);
      })
    );
  },

  /** Avisa de lecturas/entregas respetando la privacidad de cada usuario. */
  async receipt(conversationId, reader, member) {
    const ids = await Conversation.memberIds(conversationId);
    const viewers = await User.findMany(ids);
    await Promise.all(
      ids.map((userId) => {
        const viewer = userId === reader.id ? reader : viewers.get(userId);
        const showRead = userId === reader.id || (reader.read_receipts && viewer?.read_receipts);
        return realtime.toUsers([userId], "receipt", {
          conversationId,
          userId: reader.id,
          lastReadId: showRead ? member.last_read_id : 0,
          lastDeliveredId: Math.max(member.last_delivered_id, showRead ? member.last_read_id : 0),
        });
      })
    );
  },

  /** `user` es la fila de la tabla users (con la columna online ya actualizada). */
  async presence(user) {
    await realtime.toUsers(await User.contactIds(user.id), "presence", {
      userId: user.id,
      online: Boolean(user.online),
      lastSeen: user.show_last_seen ? user.last_seen : null,
    });
  },

  /**
   * Cierra la app en los demás dispositivos del usuario. Sus sesiones ya se borraron de la
   * base de datos; la pestaña con `keepTag` (la que cambió la contraseña) ignora el aviso.
   */
  disconnectOtherSessions(userId, keepTag) {
    return realtime.toUsers([userId], "session:revoked", { reason: "password", keepTag: keepTag || null });
  },
};

module.exports = realtime;
