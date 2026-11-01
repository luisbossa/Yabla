// Lo que antes llegaba por Socket.IO desde el navegador, ahora por HTTP: autorización de
// canales de Pusher, webhooks de presencia, "escribiendo…", entregado/leído y visibilidad.
const config = require("../config");
const User = require("../models/User");
const Conversation = require("../models/Conversation");
const Call = require("../models/Call");
const presence = require("../services/presence");
const realtime = require("../services/realtime");
const calls = require("../services/calls");
const validate = require("../utils/validate");
const { httpError } = require("../middleware/errorHandler");

// Mismo prefijo que realtime.channel / realtime.callChannel ("dev-" fuera de producción)
const { prefix } = config.pusher;
const USER_CHANNEL = new RegExp(`^private-${prefix}user-(\\d+)$`);
const CALL_CHANNEL = new RegExp(`^presence-${prefix}call-([\\w-]+)$`);

/** pusher-js pide permiso para cada canal privado al que se suscribe. */
exports.auth = async (req, res) => {
  const socketId = String(req.body.socket_id || "");
  const channel = String(req.body.channel_name || "");
  if (!realtime.enabled || !/^\d+\.\d+$/.test(socketId)) throw httpError(400, "Petición no válida.");

  const userMatch = USER_CHANNEL.exec(channel);
  if (userMatch && Number(userMatch[1]) === req.user.id) {
    return res.json(realtime.pusher.authorizeChannel(socketId, channel));
  }
  const callMatch = CALL_CHANNEL.exec(channel);
  const call = callMatch && (await Call.findById(callMatch[1]));
  if (call && !call.ended_at && (call.caller_id === req.user.id || call.callee_id === req.user.id)) {
    return res.json(realtime.pusher.authorizeChannel(socketId, channel, { user_id: String(req.user.id) }));
  }
  throw httpError(403, "No tienes acceso a este canal.");
};

/** Al conectarse: en línea al instante y lo pendiente pasa a "entregado". */
exports.hello = async (req, res) => {
  const userId = req.user.id;
  if (await presence.setOnline(userId, true)) await realtime.presence(await User.findById(userId));
  const delivered = await Conversation.markAllDelivered(userId);
  for (const { conversationId } of delivered) {
    await realtime.receipt(conversationId, req.user, await Conversation.getMember(conversationId, userId));
  }
  res.json({ ok: true });
};

/** Pregunta a Pusher si el canal del usuario sigue abierto (los webhooks pueden llegar desordenados). */
async function syncOnline(userId) {
  const response = await realtime.pusher.get({ path: `/channels/${realtime.channel(userId)}` });
  const { occupied } = await response.json();
  if (!(await presence.setOnline(userId, occupied))) return;
  if (!occupied) await User.touchLastSeen(userId);
  await realtime.presence(await User.findById(userId));
}

/** Webhooks de Pusher: canales ocupados/vacíos (presencia) y miembros que salen de una llamada. */
exports.webhook = async (req, res) => {
  if (!realtime.enabled) return res.status(404).end();
  const webhook = realtime.pusher.webhook({ headers: req.headers, rawBody: req.rawBody?.toString("utf8") || "" });
  if (!webhook.isValid()) return res.status(401).end();

  for (const event of webhook.getEvents()) {
    const userMatch = USER_CHANNEL.exec(event.channel);
    const callMatch = CALL_CHANNEL.exec(event.channel);
    if (userMatch && (event.name === "channel_occupied" || event.name === "channel_vacated")) {
      await syncOnline(Number(userMatch[1]));
    } else if (callMatch && event.name === "member_removed") {
      await calls.disconnected(callMatch[1], Number(event.user_id));
    }
  }
  res.json({ ok: true });
};

exports.typing = async (req, res) => {
  const id = validate.toId(req.body.conversationId);
  const memberIds = id ? await Conversation.memberIds(id) : [];
  if (memberIds.includes(req.user.id)) {
    realtime.toUsers(memberIds.filter((uid) => uid !== req.user.id), "typing", { conversationId: id, userId: req.user.id, isTyping: validate.toBool(req.body.isTyping) });
  }
  res.json({ ok: true });
};

/** El cliente avisa cuando recibe (entregado) o ve (leído) mensajes. */
exports.receipt = async (req, res) => {
  const userId = req.user.id;
  const id = validate.toId(req.body.conversationId);
  const upTo = validate.toId(req.body.messageId);
  const before = id && upTo ? await Conversation.getMember(id, userId) : null;
  if (before) {
    const after = await Conversation.updateReceipts(id, userId, req.body.kind === "read" ? { read: upTo } : { delivered: upTo });
    if (after.last_read_id !== before.last_read_id || after.last_delivered_id !== before.last_delivered_id) {
      await realtime.receipt(id, req.user, after);
    }
  }
  res.json({ ok: true });
};

/** La app avisa si está en primer plano: así no se envían notificaciones push a quien ya la está viendo. */
exports.visibility = async (req, res) => {
  await presence.setVisible(req.user.id, validate.toBool(req.body.visible));
  res.json({ ok: true, ttl: presence.ACTIVE_TTL });
};

/** Configuración del cliente de Pusher (va en la página del chat). */
exports.clientConfig = () => (realtime.enabled ? { key: config.pusher.key, cluster: config.pusher.cluster, prefix } : null);
