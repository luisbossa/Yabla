const fs = require("fs");
const config = require("../config");
const path = require("path");
const User = require("../models/User");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const Story = require("../models/Story");
const Dating = require("../models/Dating");
const upload = require("../middleware/upload");
const blob = require("./blobController");
const realtime = require("../services/realtime");
const validate = require("../utils/validate");
const { httpError } = require("../middleware/errorHandler");
const welcome = require("../services/welcome");
const messaging = require("../services/messaging");
const Scheduled = require("../models/Scheduled");

const MAX_TEXT = 4000;
// Stickers válidos: solo los archivos que existen en public/assets/images/stickers (GIF clásicos y packs SVG)
const STICKER_DIR = path.join(__dirname, "../../public/assets/images/stickers");
const STICKERS = new Set(
  fs.readdirSync(STICKER_DIR, { recursive: true })
    .map((f) => String(f).split(path.sep).join("/"))
    .filter((f) => /\.(gif|svg)$/.test(f))
    .map((f) => `/assets/images/stickers/${f}`)
);

/** Carga la conversación y comprueba que el usuario es miembro. Se usa como middleware. */
exports.loadMembership = async (req, res, next) => {
  const id = validate.toId(req.params.id);
  const [conversation, member] = id ? await Promise.all([Conversation.findById(id), Conversation.getMember(id, req.user.id)]) : [];
  if (!conversation || !member) throw httpError(404, "Conversación no encontrada.");
  req.conversation = conversation;
  req.member = member;
  next();
};

/** Comprueba bloqueos y devuelve el otro participante de un chat 1 a 1 (o null). */
async function assertCanSend(req) {
  if (req.conversation.type !== "direct") return null;
  if (req.conversation.origin === "match") {
    const match = await Dating.matchByConversation(req.conversation.id);
    if (match?.unmatched_at) throw httpError(403, "Ya no tienen match: no se pueden enviar mensajes.");
  }
  const peerId = (await Conversation.memberIds(req.conversation.id)).find((id) => id !== req.user.id);
  if (peerId && (await User.isBlocked(req.user.id, peerId))) throw httpError(403, "No puedes enviar mensajes a este contacto.");
  return peerId ? User.findById(peerId) : null;
}

exports.assertCanSend = assertCanSend;

async function systemMessage(conversationId, actorId, action, extra = {}) {
  const message = await Message.create({ conversationId, senderId: actorId, type: "system", meta: { action, ...extra } });
  await realtime.message(message);
  return message;
}

exports.create = async (req, res) => {
  const me = req.user;

  // Chat 1 a 1
  if (req.body.type !== "group") {
    const userId = validate.toId(req.body.userId);
    if (!userId || userId === me.id || !(await User.findById(userId))) throw httpError(404, "Usuario no encontrado.");
    const { id, created } = await Conversation.getOrCreateDirect(me.id, userId);
    if (created) await realtime.conversation(id, [userId]);
    else await Conversation.updateMember(id, me.id, { hidden: 0 }); // si lo habías eliminado, vuelve a tu lista
    return res.status(created ? 201 : 200).json({ conversation: await Conversation.getForUser(id, me) });
  }

  // Grupo
  const name = validate.str(req.body.name, 60);
  const candidates = validate.idList(req.body.memberIds).filter((id) => id !== me.id);
  const existing = await User.findMany(candidates);
  const memberIds = candidates.filter((id) => existing.has(id));
  if (!name) throw httpError(422, "Ponle un nombre al grupo.");
  if (!memberIds.length) throw httpError(422, "Elige al menos un participante.");

  const id = await Conversation.createGroup({
    name,
    avatar: await upload.save(req.file),
    description: validate.str(req.body.description, 200) || null,
    createdBy: me.id,
    memberIds,
  });
  await Message.create({ conversationId: id, senderId: me.id, type: "system", meta: { action: "created", name } });
  await realtime.conversation(id);
  res.status(201).json({ conversation: await Conversation.getForUser(id, me) });
};

/** Una conversación (p. ej. un chat eliminado que reaparece al recibir un mensaje). */
exports.show = async (req, res) => {
  const conversation = await Conversation.getForUser(req.conversation.id, req.user);
  if (!conversation) throw httpError(404, "Conversación no encontrada.");
  res.json({ conversation });
};

exports.messages = async (req, res) => {
  const before = validate.toId(req.query.before) || undefined;
  const limit = Math.min(validate.toId(req.query.limit) || 50, 100);
  const messages = await Message.list(req.conversation.id, { before, limit, after: req.member.cleared_id, viewerId: req.user.id });
  res.json({ messages, hasMore: messages.length === limit });
};

/**
 * GET /api/conversations/:id/export?tz=America/Costa_Rica — el chat como archivo de texto, tal como
 * lo ve el usuario (sin lo vaciado, lo eliminado para él ni los temporales caducados).
 */
exports.exportChat = async (req, res) => {
  const { messageText } = require("../services/push");
  const conv = req.conversation;
  const PAGE = 500;
  const messages = [];
  for (let before = Number.MAX_SAFE_INTEGER; ; ) {
    const page = await Message.list(conv.id, { before, after: req.member.cleared_id, limit: PAGE, viewerId: req.user.id });
    messages.unshift(...page);
    if (page.length < PAGE) break;
    before = page[0].id;
  }

  const users = await User.findMany([...new Set(messages.map((m) => m.senderId).filter(Boolean))]);
  const memberIds = await Conversation.memberIds(conv.id);
  const peer = conv.type === "direct" ? await User.findById(memberIds.find((id) => id !== req.user.id)) : null;
  const title = conv.type === "group" ? conv.name || "Grupo" : peer?.name || "Chat";

  // Zona horaria del navegador (el servidor de Vercel está en UTC)
  let timeZone = "America/Costa_Rica";
  try {
    if (req.query.tz) timeZone = new Intl.DateTimeFormat("es", { timeZone: String(req.query.tz) }).resolvedOptions().timeZone;
  } catch {
    /* zona no válida: se usa la de Costa Rica */
  }
  const when = new Intl.DateTimeFormat("es-CR", { timeZone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

  const lines = messages
    .filter((m) => m.type !== "system")
    .map((m) => {
      const name = m.senderId === req.user.id ? `${req.user.name} (tú)` : users.get(m.senderId)?.name || "Usuario";
      let text = m.deletedAt ? "Se eliminó este mensaje" : m.type === "text" ? m.body : messageText(m) || m.type;
      if (!m.deletedAt && m.type !== "text" && m.body && !text.includes(m.body)) text += ` — ${m.body}`;
      if (m.type === "poll" && !m.deletedAt) {
        const count = (i) => m.votes.filter((v) => v.option === i).length;
        text += ` → ${m.meta.options.map((o, i) => `${o} (${count(i)})`).join(", ")}${m.meta.closedAt ? " · cerrada" : ""}`;
      }
      if (m.type === "location" && !m.deletedAt) text += ` (https://www.openstreetmap.org/?mlat=${m.meta.lat}&mlon=${m.meta.lng}#map=17/${m.meta.lat}/${m.meta.lng})`;
      return `[${when.format(m.createdAt)}] ${name}: ${text}${m.editedAt ? " (editado)" : ""}`;
    });

  const header = [`Chat de Yabla: ${title}`, `Exportado el ${when.format(Date.now())} · ${lines.length} mensajes`, ""];
  const file = `yabla-${title.normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "chat"}.txt`;
  res.set({
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Disposition": `attachment; filename="${file}"`,
    "Cache-Control": "no-store",
  });
  // BOM: así el Bloc de notas de Windows muestra bien las tildes y los emojis
  res.send(`﻿${[...header, ...lines].join("\r\n")}\r\n`);
};

exports.media = async (req, res) => {
  res.json({ messages: await Message.media(req.conversation.id, req.member.cleared_id, req.user.id) });
};

exports.send = async (req, res) => {
  const peer = await assertCanSend(req);

  const conversationId = req.conversation.id;
  const text = validate.str(req.body.text, MAX_TEXT);
  const replyToId = validate.toId(req.body.replyToId);
  const sticker = validate.str(req.body.sticker, 200);
  // Con Vercel Blob el navegador ya subió el archivo y envía su URL (mediaUrl); si no, llega por multipart
  const file = req.file || (req.body.mediaUrl ? await blob.fileFromUrl(req.body.mediaUrl, req.body.fileName) : null);

  const data = { conversationId, senderId: req.user.id, type: "text", body: text || null, meta: null, replyToId: null };

  if (file) {
    const isVideo = req.body.kind !== "file" && (file.mimetype.startsWith("video/") || req.body.kind === "video");
    // Solo los videos pueden pasar de 4 MB (llegan hasta 16 MB)
    if (!isVideo && file.size > config.uploadLimit) {
      throw httpError(413, `El archivo supera el límite de ${config.uploadLimit / 1024 / 1024} MB.`);
    }
    data.mediaUrl = file.url || (await upload.save(file));
    // kind=file: enviado como documento (p. ej. una foto con su calidad original)
    if (req.body.kind === "file") data.type = "file";
    else if (isVideo) data.type = "video";
    else if (file.mimetype.startsWith("image/")) data.type = "image";
    else if (file.mimetype.startsWith("audio/") || req.body.kind === "audio") data.type = "audio";
    else data.type = "file";
    data.meta = { name: file.originalname.slice(0, 120), size: file.size, mime: file.mimetype };
    // Ver una vez: solo fotos y videos; el archivo no viaja con el mensaje (ver specialMessageController)
    if (validate.toBool(req.body.viewOnce) && (data.type === "image" || data.type === "video")) data.meta.viewOnce = true;
    if (data.type === "audio") data.meta.duration = Math.min(Number(req.body.duration) || 0, 60 * 30);
    if (data.type === "video") {
      // Datos que mide el navegador: se validan para pintar la miniatura con su proporción
      const num = (v, max) => Math.max(0, Math.min(Math.round(Number(v) || 0), max));
      Object.assign(data.meta, {
        duration: Math.min(Number(req.body.duration) || 0, config.videoMaxSeconds + 5),
        width: num(req.body.width, 4096),
        height: num(req.body.height, 4096),
      });
    }
  } else if (sticker) {
    if (!STICKERS.has(sticker)) throw httpError(422, "Sticker no válido.");
    Object.assign(data, { type: "sticker", mediaUrl: sticker, body: null });
  } else if (!text) {
    throw httpError(422, "El mensaje está vacío.");
  }

  if (replyToId) {
    const original = await Message.findRaw(replyToId);
    if (original?.conversation_id === conversationId) data.replyToId = replyToId;
  }

  const mentions = await messaging.mentionsIn(req.conversation, text, req.user.id);
  if (mentions.length) data.meta = { ...(data.meta || {}), mentions };

  // Respuesta a un estado: se adjunta una miniatura del estado
  const storyId = validate.toId(req.body.storyId);
  if (storyId) {
    const [story, memberIds] = await Promise.all([Story.findById(storyId), Conversation.memberIds(conversationId)]);
    if (story && memberIds.includes(story.user_id)) {
      data.meta = { ...(data.meta || {}), story: { id: story.id, mediaUrl: story.media_url, userId: story.user_id } };
    }
  }

  // clientId: identificador temporal del cliente para reemplazar el mensaje provisional sin duplicarlo
  const message = await messaging.publish(data, req.user, { clientId: validate.str(req.body.clientId, 40) || undefined, peer });
  res.status(201).json({ message });
};

exports.updateSettings = async (req, res) => {
  const fields = {};
  if ("muted" in req.body) fields.muted = validate.toBool(req.body.muted) ? 1 : 0;
  if ("pinned" in req.body) fields.pinned = validate.toBool(req.body.pinned) ? 1 : 0;
  if ("archived" in req.body) {
    fields.archived = validate.toBool(req.body.archived) ? 1 : 0;
    if (fields.archived) fields.pinned = 0; // un chat archivado no puede estar fijado
  }
  if (fields.pinned) fields.archived = 0;
  await Conversation.updateMember(req.conversation.id, req.user.id, fields);
  const conversation = await Conversation.getForUser(req.conversation.id, req.user);
  realtime.toUsers([req.user.id], "conversation:update", conversation);
  res.json({ conversation });
};

/** "Vaciar chat": oculta el historial solo para quien lo vacía. */
exports.clear = async (req, res) => {
  const lastId = req.conversation.last_message_id || 0;
  await Conversation.updateMember(req.conversation.id, req.user.id, { cleared_id: lastId });
  await Conversation.updateReceipts(req.conversation.id, req.user.id, { read: lastId });
  const conversation = await Conversation.getForUser(req.conversation.id, req.user);
  realtime.toUsers([req.user.id], "conversation:update", conversation);
  res.json({ conversation });
};

exports.updateGroup = async (req, res) => {
  if (req.conversation.type !== "group") throw httpError(400, "Solo se pueden editar grupos.");
  if (req.member.role !== "admin") throw httpError(403, "Solo los administradores pueden editar el grupo.");
  const name = req.body.name !== undefined ? validate.str(req.body.name, 60) : null;
  if (name === "") throw httpError(422, "El nombre no puede estar vacío.");
  await Conversation.update(req.conversation.id, {
    name,
    avatar: await upload.save(req.file),
    description: req.body.description !== undefined ? validate.str(req.body.description, 200) : null,
  });
  if (name && name !== req.conversation.name) await systemMessage(req.conversation.id, req.user.id, "renamed", { name });
  await realtime.conversation(req.conversation.id, undefined, "conversation:update");
  res.json({ conversation: await Conversation.getForUser(req.conversation.id, req.user) });
};

exports.addMembers = async (req, res) => {
  if (req.conversation.type !== "group") throw httpError(400, "Solo se pueden añadir participantes a grupos.");
  if (req.member.role !== "admin") throw httpError(403, "Solo los administradores pueden añadir participantes.");
  const candidates = validate.idList(req.body.userIds);
  const existing = await User.findMany(candidates);
  const added = await Conversation.addMembers(req.conversation.id, candidates.filter((id) => existing.has(id)));
  if (!added.length) throw httpError(422, "Esas personas ya están en el grupo.");

  await systemMessage(req.conversation.id, req.user.id, "added", { userIds: added });
  const everyone = await Conversation.memberIds(req.conversation.id);
  await realtime.conversation(req.conversation.id, added);
  await realtime.conversation(req.conversation.id, everyone.filter((id) => !added.includes(id)), "conversation:update");
  res.json({ conversation: await Conversation.getForUser(req.conversation.id, req.user) });
};

exports.leave = async (req, res) => {
  if (req.conversation.type !== "group") throw httpError(400, "Solo puedes salir de grupos.");
  await leaveGroup(req);
  res.json({ ok: true });
};

/**
 * "Eliminar chat", como en WhatsApp:
 * - chat individual: se oculta solo para ti con su historial; reaparece si te vuelven a escribir.
 * - grupo: sales del grupo y desaparece de tu lista.
 */
exports.remove = async (req, res) => {
  if (req.conversation.type === "group") {
    await leaveGroup(req);
  } else {
    await Conversation.hide(req.conversation.id, req.user.id, req.conversation.last_message_id || 0);
    realtime.toUsers([req.user.id], "conversation:removed", { conversationId: req.conversation.id });
  }
  res.json({ ok: true });
};

async function leaveGroup(req) {
  const conversationId = req.conversation.id;
  await systemMessage(conversationId, req.user.id, "left");
  await Conversation.removeMember(conversationId, req.user.id);

  // Si se va el último administrador, el más antiguo pasa a serlo
  const remaining = await Conversation.members(conversationId, req.user);
  if (remaining.length && !remaining.some((m) => m.role === "admin")) {
    await Conversation.updateMember(conversationId, remaining[0].id, { role: "admin" });
  }
  realtime.toUsers([req.user.id], "conversation:removed", { conversationId });
  await realtime.conversation(conversationId, undefined, "conversation:update");
}

// ==========================================================================
// Mensajes temporales (como WhatsApp: el ajuste es del chat, para todos)
// ==========================================================================
const DISAPPEAR_OPTIONS = [0, 24 * 3600, 7 * 24 * 3600, 90 * 24 * 3600];

exports.updateDisappearing = async (req, res) => {
  const seconds = Number(req.body.seconds);
  if (!DISAPPEAR_OPTIONS.includes(seconds)) throw httpError(422, "Duración no válida.");
  if (seconds !== req.conversation.disappear_after) {
    await Conversation.setDisappearing(req.conversation.id, seconds);
    await systemMessage(req.conversation.id, req.user.id, "disappearing", { seconds });
    await realtime.conversation(req.conversation.id, undefined, "conversation:update");
  }
  res.json({ conversation: await Conversation.getForUser(req.conversation.id, req.user) });
};

// ==========================================================================
// Mensajes programados (solo los ve quien los programa)
// ==========================================================================
const MAX_SCHEDULE_AHEAD = 365 * 24 * 3600 * 1000;

exports.scheduled = async (req, res) => {
  res.json({ scheduled: await Scheduled.listFor(req.conversation.id, req.user.id) });
};

exports.schedule = async (req, res) => {
  await assertCanSend(req);
  const text = validate.str(req.body.text, MAX_TEXT);
  const sendAt = Number(req.body.sendAt);
  if (!text) throw httpError(422, "Escribe el mensaje que quieres programar.");
  if (!Number.isFinite(sendAt) || sendAt < Date.now() + 30 * 1000) throw httpError(422, "Elige una hora futura (al menos dentro de un minuto).");
  if (sendAt > Date.now() + MAX_SCHEDULE_AHEAD) throw httpError(422, "Solo puedes programar con hasta un año de antelación.");
  if ((await Scheduled.countFor(req.conversation.id, req.user.id)) >= 20) throw httpError(422, "Ya tienes 20 mensajes programados en este chat.");

  const replyToId = validate.toId(req.body.replyToId);
  const original = replyToId && (await Message.findRaw(replyToId));
  const item = await Scheduled.create({
    conversationId: req.conversation.id,
    senderId: req.user.id,
    body: text,
    replyToId: original?.conversation_id === req.conversation.id ? replyToId : null,
    sendAt,
  });
  realtime.toUsers([req.user.id], "conversation:update", await Conversation.getForUser(req.conversation.id, req.user));
  res.status(201).json({ scheduled: item });
};
