const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const Star = require("../models/Star");
const User = require("../models/User");
const { linkPreview } = require("../services/linkPreview");
const Scheduled = require("../models/Scheduled");
const scheduler = require("../services/scheduler");
const realtime = require("../services/realtime");
const validate = require("../utils/validate");
const { httpError } = require("../middleware/errorHandler");

const EDIT_WINDOW = 15 * 60 * 1000; // 15 minutos, como WhatsApp
// Cualquier emoji sirve como reacción (como en WhatsApp): solo pictogramas, banderas, tonos de piel y uniones
const EMOJI = /^(?=.*[\p{Extended_Pictographic}\p{Regional_Indicator}])[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\u200d\ufe0f\u20e3#*0-9]{1,16}$/u;

/** Carga el mensaje y comprueba que el usuario pertenece a su conversación. */
exports.load = async (req, res, next) => {
  const id = validate.toId(req.params.id);
  const message = id && (await Message.findRaw(id));
  if (!message || !(await Conversation.getMember(message.conversation_id, req.user.id))) {
    throw httpError(404, "Mensaje no encontrado.");
  }
  req.message = message;
  next();
};

function assertOwnLiveMessage(req) {
  if (req.message.sender_id !== req.user.id) throw httpError(403, "Solo puedes modificar tus propios mensajes.");
  if (req.message.deleted_at) throw httpError(410, "El mensaje ya fue eliminado.");
}

exports.edit = async (req, res) => {
  assertOwnLiveMessage(req);
  if (req.message.type !== "text") throw httpError(400, "Solo se pueden editar mensajes de texto.");
  if (Date.now() - req.message.created_at > EDIT_WINDOW) throw httpError(403, "Solo puedes editar un mensaje durante 15 minutos.");
  const text = validate.str(req.body.text, 4000);
  if (!text) throw httpError(422, "El mensaje no puede quedar vacío.");

  const message = await Message.edit(req.message.id, text);
  await realtime.messageUpdated(message);
  res.json({ message });
};

/** Eliminar para todos. */
exports.remove = async (req, res) => {
  assertOwnLiveMessage(req);
  const message = await Message.remove(req.message.id);
  await realtime.messageUpdated(message);
  res.json({ message });
};

exports.react = async (req, res) => {
  if (req.message.deleted_at || req.message.type === "system") throw httpError(400, "No se puede reaccionar a este mensaje.");
  const emoji = validate.str(req.body.emoji, 16);
  if (!EMOJI.test(emoji)) throw httpError(422, "Reacción no válida.");
  const message = await Message.react(req.message.id, req.user.id, emoji);
  await realtime.messageUpdated(message);
  res.json({ message });
};

// ==========================================================================
// Destacar (estrella): lista personal de cada usuario
// ==========================================================================
exports.star = async (req, res) => {
  if (req.message.deleted_at || req.message.type === "system") throw httpError(400, "No se puede destacar este mensaje.");
  const starred = await Star.toggle(req.user.id, req.message.id);
  // Sus otras pestañas y dispositivos también se actualizan
  realtime.toUsers([req.user.id], "star:update", { messageId: req.message.id, starred });
  res.json({ starred });
};

exports.starred = async (req, res) => {
  res.json({ messages: await Star.list(req.user.id) });
};

/** Búsqueda en todos los chats (buscador de la barra lateral). Mínimo 2 caracteres. */
exports.search = async (req, res) => {
  const q = validate.str(req.query.q, 100);
  res.json({ messages: q && q.length >= 2 ? await Message.search(req.user.id, q) : [] });
};

// ==========================================================================
// Reenviar a uno o varios chats (máx. 5 a la vez, como WhatsApp)
// ==========================================================================
const FORWARDABLE = ["text", "image", "video", "file", "audio", "sticker"];
const MAX_FORWARD = 5;

exports.forward = async (req, res) => {
  const original = req.message;
  const viewOnce = JSON.parse(original.meta || "{}").viewOnce;
  if (original.deleted_at || !FORWARDABLE.includes(original.type) || viewOnce) throw httpError(400, "Este mensaje no se puede reenviar.");
  const targets = validate.idList(req.body.conversationIds).slice(0, MAX_FORWARD);
  if (!targets.length) throw httpError(422, "Elige al menos un chat.");

  const meta = { ...(JSON.parse(original.meta || "null") || {}), forwarded: true };
  delete meta.story;
  delete meta.mentions;
  delete meta.scheduled;

  const sent = [];
  for (const conversationId of targets) {
    const conversation = await Conversation.findById(conversationId);
    if (!conversation || !(await Conversation.getMember(conversationId, req.user.id))) continue;
    if (conversation.type === "direct") {
      const peerId = (await Conversation.memberIds(conversationId)).find((id) => id !== req.user.id);
      if (peerId && (await User.isBlocked(req.user.id, peerId))) continue;
    }
    const message = await Message.create({
      conversationId,
      senderId: req.user.id,
      type: original.type,
      body: original.body,
      mediaUrl: original.media_url,
      meta,
    });
    const member = await Conversation.updateReceipts(conversationId, req.user.id, { read: message.id });
    await realtime.message(message);
    await realtime.receipt(conversationId, req.user, member);
    sent.push(message);
  }
  if (!sent.length) throw httpError(403, "No se pudo reenviar a esos chats.");
  res.status(201).json({ messages: sent });
};

// ==========================================================================
// Vista previa de enlaces
// ==========================================================================
exports.linkPreview = async (req, res) => {
  const url = validate.str(req.query.url, 2000);
  if (!/^https?:\/\//i.test(url)) throw httpError(422, "Enlace no válido.");
  res.set("Cache-Control", "private, max-age=3600");
  res.json({ preview: await linkPreview(url) });
};

// ==========================================================================
// Fijar mensajes (máx. 3 por chat, visibles para todos)
// ==========================================================================
exports.pin = async (req, res) => {
  const m = req.message;
  if (m.deleted_at || m.type === "system") throw httpError(400, "No se puede fijar este mensaje.");
  const result = await Conversation.togglePin(m.conversation_id, m.id, req.user.id);
  if (result === "full") throw httpError(422, "Solo puedes fijar 3 mensajes. Desfija uno primero.");
  if (result === "pinned") {
    const notice = await Message.create({ conversationId: m.conversation_id, senderId: req.user.id, type: "system", meta: { action: "pinned", messageId: m.id } });
    await realtime.message(notice);
  }
  await realtime.conversation(m.conversation_id, undefined, "conversation:update");
  res.json({ pinned: result === "pinned" });
};

// ==========================================================================
// Info del mensaje: cuándo lo recibió y lo leyó cada persona
// ==========================================================================
exports.info = async (req, res) => {
  const m = req.message;
  if (m.sender_id !== req.user.id) throw httpError(403, "Solo puedes ver la info de tus mensajes.");
  const [members, times] = await Promise.all([Conversation.members(m.conversation_id, req.user), Message.receiptTimes(m.conversation_id, m.id)]);
  // members ya respeta la privacidad: lastReadId = 0 si alguno desactivó las confirmaciones
  const recipients = members
    .filter((u) => u.id !== req.user.id)
    .map((u) => {
      const t = times.get(u.id) || {};
      const read = u.lastReadId >= m.id;
      const delivered = u.lastDeliveredId >= m.id;
      return {
        user: { id: u.id, name: u.name, avatar: u.avatar, username: u.username },
        readAt: read ? t.readAt || null : null,
        deliveredAt: delivered ? t.deliveredAt || t.readAt || null : null,
        read,
        delivered,
      };
    });
  res.json({ message: (await Message.hydrate([m]))[0], recipients });
};

// ==========================================================================
// Eliminar para mí (uno o varios)
// ==========================================================================
exports.hide = async (req, res) => {
  const ids = validate.idList(req.body.ids).slice(0, 200);
  if (!ids.length) throw httpError(422, "No hay mensajes que eliminar.");
  const rows = await Promise.all(ids.map((id) => Message.findRaw(id)));
  const allowed = [];
  for (const row of rows) {
    if (row && (await Conversation.getMember(row.conversation_id, req.user.id))) allowed.push(row);
  }
  await Message.hideFor(req.user.id, allowed.map((r) => r.id));
  // Las otras pestañas o dispositivos del usuario también los quitan
  const byConv = new Map();
  allowed.forEach((r) => byConv.set(r.conversation_id, [...(byConv.get(r.conversation_id) || []), r.id]));
  byConv.forEach((list, conversationId) => realtime.toUsers([req.user.id], "message:hidden", { conversationId, ids: list }));
  res.json({ hidden: allowed.map((r) => r.id) });
};

// ==========================================================================
// Mensajes programados: cancelar o enviar ya
// ==========================================================================
async function takeScheduled(req) {
  const id = validate.toId(req.params.id);
  const row = id && (await Scheduled.take(id, req.user.id));
  if (!row) throw httpError(404, "Ese mensaje programado ya no existe.");
  return row;
}

exports.cancelScheduled = async (req, res) => {
  const row = await takeScheduled(req);
  realtime.toUsers([req.user.id], "conversation:update", await Conversation.getForUser(row.conversation_id, req.user));
  res.json({ ok: true });
};

exports.sendScheduledNow = async (req, res) => {
  const row = await takeScheduled(req);
  const message = await scheduler.deliver(row);
  if (!message) throw httpError(403, "No se pudo enviar el mensaje.");
  res.json({ message });
};
