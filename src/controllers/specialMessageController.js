// Mensajes especiales: encuestas, ubicación y fotos/videos de "ver una vez".
const Message = require("../models/Message");
const conversations = require("./conversationController");
const messaging = require("../services/messaging");
const realtime = require("../services/realtime");
const validate = require("../utils/validate");
const { httpError } = require("../middleware/errorHandler");

const POLL = { maxQuestion: 200, maxOption: 80, minOptions: 2, maxOptions: 12 };

// ==========================================================================
// Encuestas
// ==========================================================================

/** POST /api/conversations/:id/polls { question, options[], multiple } */
exports.createPoll = async (req, res) => {
  const peer = await conversations.assertCanSend(req);
  const question = validate.str(req.body.question, POLL.maxQuestion);
  const seen = new Set();
  const options = (Array.isArray(req.body.options) ? req.body.options : [])
    .map((o) => validate.str(o, POLL.maxOption))
    .filter((o) => o && !seen.has(o.toLowerCase()) && seen.add(o.toLowerCase()))
    .slice(0, POLL.maxOptions);
  if (!question) throw httpError(422, "Escribe la pregunta de la encuesta.");
  if (options.length < POLL.minOptions) throw httpError(422, "La encuesta necesita al menos dos opciones distintas.");

  // La pregunta va en body: así sale en la vista previa, en las notificaciones y en la búsqueda
  const message = await messaging.publish(
    { conversationId: req.conversation.id, senderId: req.user.id, type: "poll", body: question, meta: { options, multiple: validate.toBool(req.body.multiple) } },
    req.user,
    { peer, clientId: validate.str(req.body.clientId, 40) || undefined }
  );
  res.status(201).json({ message });
};

function livePoll(req) {
  const row = req.message;
  if (row.type !== "poll") throw httpError(400, "Este mensaje no es una encuesta.");
  if (row.deleted_at) throw httpError(410, "La encuesta ya no existe.");
  return JSON.parse(row.meta || "{}");
}

/** POST /api/messages/:id/vote { options: [índices] } — sustituye el voto; [] lo quita. */
exports.vote = async (req, res) => {
  const meta = livePoll(req);
  if (meta.closedAt) throw httpError(409, "La encuesta ya está cerrada.");
  const picked = [...new Set((Array.isArray(req.body.options) ? req.body.options : []).map(Number))]
    .filter((i) => Number.isInteger(i) && i >= 0 && i < meta.options.length);
  if (!meta.multiple && picked.length > 1) throw httpError(422, "En esta encuesta solo se puede elegir una opción.");
  const message = await Message.setVotes(req.message.id, req.user.id, picked);
  await realtime.messageUpdated(message);
  res.json({ message });
};

/** POST /api/messages/:id/close-poll — solo quien la creó. */
exports.closePoll = async (req, res) => {
  const meta = livePoll(req);
  if (req.message.sender_id !== req.user.id) throw httpError(403, "Solo quien creó la encuesta puede cerrarla.");
  if (meta.closedAt) throw httpError(409, "La encuesta ya está cerrada.");
  const message = await Message.updateMeta(req.message.id, { ...meta, closedAt: Date.now() });
  await realtime.messageUpdated(message);
  res.json({ message });
};

// ==========================================================================
// Ubicación
// ==========================================================================

/** POST /api/conversations/:id/location { lat, lng, accuracy?, label? } */
exports.sendLocation = async (req, res) => {
  const peer = await conversations.assertCanSend(req);
  const lat = Number(req.body.lat);
  const lng = Number(req.body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw httpError(422, "La ubicación no es válida.");
  }
  const round = (n) => Math.round(n * 1e6) / 1e6; // ~10 cm: más precisión no aporta
  const accuracy = Number(req.body.accuracy);
  const meta = { lat: round(lat), lng: round(lng), ...(Number.isFinite(accuracy) && accuracy > 0 ? { accuracy: Math.min(Math.round(accuracy), 100000) } : {}) };
  const message = await messaging.publish(
    { conversationId: req.conversation.id, senderId: req.user.id, type: "location", body: validate.str(req.body.label, 80) || null, meta },
    req.user,
    { peer, clientId: validate.str(req.body.clientId, 40) || undefined }
  );
  res.status(201).json({ message });
};

// ==========================================================================
// Ver una vez
// ==========================================================================

/**
 * POST /api/messages/:id/open — devuelve el archivo de una foto/video de "ver una vez" UNA sola vez
 * por persona. Quien la envió tampoco puede volver a verla (como WhatsApp).
 */
exports.openViewOnce = async (req, res) => {
  const row = req.message;
  const meta = JSON.parse(row.meta || "{}");
  if (!meta.viewOnce) throw httpError(400, "Este mensaje no es de ver una vez.");
  if (row.deleted_at || !row.media_url) throw httpError(410, "Esta foto ya no está disponible.");
  if (row.sender_id === req.user.id) throw httpError(403, "Las fotos de ver una vez no se pueden volver a abrir.");
  if (!(await Message.markOpened(row.id, req.user.id))) throw httpError(410, "Ya abriste esta foto.");

  // Quien la envió ve "Abierta" (el archivo se borra luego en la tarea periódica, ver purgeViewOnce)
  await realtime.messageUpdated(await Message.findById(row.id));
  res.set("Cache-Control", "no-store");
  res.json({ mediaUrl: row.media_url, type: row.type });
};

/**
 * Borra los archivos de "ver una vez" que ya abrieron todos (con unos minutos de margen para que
 * terminen de cargar) o que nadie abrió en 14 días. Tarea periódica (services/cron.js).
 */
exports.purgeViewOnce = async () => {
  const upload = require("../middleware/upload");
  const db = require("../config/database");
  const now = Date.now();
  const rows = await db.all(
    `SELECT m.id, m.media_url FROM messages m
     WHERE m.media_url IS NOT NULL AND m.type IN ('image', 'video') AND json_extract(m.meta, '$.viewOnce') = 1
       AND (m.created_at < ?1 OR (
         (SELECT COUNT(*) FROM view_once_opens o WHERE o.message_id = m.id) >=
         (SELECT COUNT(*) FROM conversation_members cm WHERE cm.conversation_id = m.conversation_id AND cm.user_id != m.sender_id)
         AND (SELECT MAX(opened_at) FROM view_once_opens o WHERE o.message_id = m.id) < ?2))
     LIMIT 50`,
    [now - 14 * 24 * 60 * 60 * 1000, now - 5 * 60 * 1000]
  );
  for (const row of rows) {
    await upload.remove(row.media_url).catch((err) => console.error("[ver una vez]", err));
    await Message.clearMedia(row.id);
  }
};

exports.POLL = POLL;
