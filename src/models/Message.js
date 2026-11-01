const db = require("../config/database");

const TYPES = ["text", "image", "file", "audio", "sticker", "call", "payment", "system", "poll", "location"];

// Mensajes visibles para un usuario: sin los caducados (temporales) ni los que eliminó para sí
const VISIBLE = `
  (expires_at IS NULL OR expires_at > @now)
  AND id NOT IN (SELECT message_id FROM message_hidden WHERE user_id = @viewerId)`;

const SQL = {
  // Si el chat tiene mensajes temporales, el mensaje caduca a los N segundos (salvo los de sistema)
  insert: `
    INSERT INTO messages (conversation_id, sender_id, type, body, media_url, meta, reply_to_id, search_text, created_at, expires_at)
    VALUES (@conversationId, @senderId, @type, @body, @mediaUrl, @meta, @replyToId, @searchText, @now,
      CASE WHEN @type = 'system' THEN NULL ELSE
        (SELECT CASE WHEN disappear_after > 0 THEN @now + disappear_after * 1000 END FROM conversations WHERE id = @conversationId)
      END)`,
  setLastInserted: "UPDATE conversations SET last_message_id = last_insert_rowid() WHERE id = ?",
  // Un mensaje nuevo hace reaparecer el chat a quien lo había eliminado
  unhide: "UPDATE conversation_members SET hidden = 0 WHERE conversation_id = ? AND hidden = 1",
  byId: "SELECT * FROM messages WHERE id = ?",
  page: `
    SELECT * FROM messages
    WHERE conversation_id = @conversationId AND id > @after AND id < @before AND ${VISIBLE}
    ORDER BY id DESC
    LIMIT @limit`,
  edit: "UPDATE messages SET body = ?, search_text = ?, edited_at = ? WHERE id = ?",
  remove: "UPDATE messages SET deleted_at = ?, body = NULL, media_url = NULL, meta = NULL WHERE id = ?",
  removeReactions: "DELETE FROM reactions WHERE message_id = ?",
  unpin: "DELETE FROM pinned_messages WHERE message_id = ?",
  reaction: "SELECT emoji FROM reactions WHERE message_id = ? AND user_id = ?",
  addReaction: `
    INSERT INTO reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (message_id, user_id) DO UPDATE SET emoji = excluded.emoji, created_at = excluded.created_at`,
  removeReaction: "DELETE FROM reactions WHERE message_id = ? AND user_id = ?",
  media: `
    SELECT * FROM messages
    WHERE conversation_id = @conversationId AND id > @after AND deleted_at IS NULL AND ${VISIBLE}
      AND (type IN ('image', 'video', 'file', 'audio') OR (type = 'text' AND body LIKE '%http%'))
      AND (meta IS NULL OR json_extract(meta, '$.viewOnce') IS NULL)
    ORDER BY id DESC LIMIT 120`,
  hide: "INSERT OR IGNORE INTO message_hidden (user_id, message_id) VALUES (?, ?)",
  // Búsqueda en todos los chats del usuario sobre search_text (texto, pies de foto/video y nombres
  // de documentos, sin tildes ni mayúsculas). Mismas reglas que el historial (vaciar chat, temporales,
  // "eliminar para mí"); nunca "ver una vez".
  search: `
    SELECT m.* FROM messages m
    JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = @viewerId
    WHERE m.deleted_at IS NULL AND m.id > cm.cleared_id
      AND m.type IN ('text', 'image', 'video', 'file', 'poll')
      AND (m.meta IS NULL OR json_extract(m.meta, '$.viewOnce') IS NULL)
      AND m.search_text LIKE @like ESCAPE '\\'
      AND (m.expires_at IS NULL OR m.expires_at > @now)
      AND m.id NOT IN (SELECT message_id FROM message_hidden WHERE user_id = @viewerId)
    ORDER BY m.id DESC
    LIMIT @limit`,
  // Primer momento en que cada miembro llegó (entregado / leído) hasta este mensaje
  receiptTimes: `
    SELECT user_id, kind, MIN(at) AS at FROM receipt_events
    WHERE conversation_id = ? AND up_to_id >= ?
    GROUP BY user_id, kind`,
  // Temporales: borra los caducados y corrige el "último mensaje" de esos chats
  expired: "SELECT id, conversation_id FROM messages WHERE expires_at IS NOT NULL AND expires_at <= ? LIMIT 500",
  fixLast: `
    UPDATE conversations SET last_message_id = (SELECT MAX(id) FROM messages WHERE conversation_id = conversations.id)
    WHERE id = ?`,
};

const placeholders = (n) => Array(n).fill("?").join(",");

/** Sin tildes y en minúsculas: así "cafe" y "CAFÉ" encuentran "café" (SQLite solo ignora mayúsculas sin tilde). */
const normalize = (text) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Lo que se puede buscar de un mensaje: su texto (o pie de foto) y, en documentos, el nombre del archivo. */
function searchText(type, body, meta) {
  const text = [body, type === "file" ? meta?.name : null].filter(Boolean).join(" ");
  return text ? normalize(text) : null;
}

function parseMeta(raw) {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Foto o video de "ver una vez" (su archivo nunca va en los datos del mensaje: se pide al abrirlo). */
const isViewOnce = (row) => (row.type === "image" || row.type === "video") && parseMeta(row.meta)?.viewOnce === true;

/** Agrupa filas { message_id, user_id, … } por mensaje con `pick(row)`. */
function groupBy(rows, pick) {
  const map = new Map();
  rows.forEach((r) => map.set(r.message_id, [...(map.get(r.message_id) || []), pick(r)]));
  return map;
}

/**
 * Convierte filas de la BD en objetos para el cliente, con reacciones y respuesta citada (2 consultas
 * por lote, más una por cada tipo especial presente: votos de encuestas y aperturas de "ver una vez").
 */
async function hydrate(rows) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const replyIds = [...new Set(rows.map((r) => r.reply_to_id).filter(Boolean))];
  const pollIds = rows.filter((r) => r.type === "poll").map((r) => r.id);
  const onceIds = rows.filter(isViewOnce).map((r) => r.id);

  const [reactionRows, replyRows, voteRows, openRows] = await Promise.all([
    db.all(`SELECT message_id, user_id, emoji FROM reactions WHERE message_id IN (${placeholders(ids.length)}) ORDER BY created_at`, ids),
    replyIds.length ? db.all(`SELECT * FROM messages WHERE id IN (${placeholders(replyIds.length)})`, replyIds) : [],
    pollIds.length ? db.all(`SELECT message_id, user_id, option FROM poll_votes WHERE message_id IN (${placeholders(pollIds.length)}) ORDER BY created_at`, pollIds) : [],
    onceIds.length ? db.all(`SELECT message_id, user_id FROM view_once_opens WHERE message_id IN (${placeholders(onceIds.length)})`, onceIds) : [],
  ]);
  const votes = groupBy(voteRows, (r) => ({ userId: r.user_id, option: r.option }));
  const opens = groupBy(openRows, (r) => r.user_id);

  const reactions = new Map();
  reactionRows.forEach(({ message_id, user_id, emoji }) => {
    const list = reactions.get(message_id) || [];
    const group = list.find((r) => r.emoji === emoji);
    if (group) group.userIds.push(user_id);
    else list.push({ emoji, userIds: [user_id] });
    reactions.set(message_id, list);
  });
  const replies = new Map(replyRows.map((r) => [r.id, r]));

  return rows.map((row) => {
    const reply = replies.get(row.reply_to_id);
    const viewOnce = isViewOnce(row);
    return {
      id: row.id,
      conversationId: row.conversation_id,
      senderId: row.sender_id,
      type: row.type,
      body: row.body,
      mediaUrl: viewOnce ? null : row.media_url,
      meta: parseMeta(row.meta),
      replyTo: reply
        ? {
            id: reply.id,
            senderId: reply.sender_id,
            type: reply.type,
            body: reply.deleted_at ? null : reply.body?.slice(0, 160) ?? null,
            mediaUrl: reply.deleted_at || reply.type !== "image" || isViewOnce(reply) ? null : reply.media_url,
            viewOnce: isViewOnce(reply),
            deleted: Boolean(reply.deleted_at),
          }
        : null,
      reactions: row.deleted_at ? [] : reactions.get(row.id) || [],
      ...(row.type === "poll" ? { votes: votes.get(row.id) || [] } : {}),
      ...(viewOnce ? { openedBy: opens.get(row.id) || [] } : {}),
      editedAt: row.edited_at,
      deletedAt: row.deleted_at,
      expiresAt: row.expires_at || null,
      createdAt: row.created_at,
    };
  });
}

const Message = {
  TYPES,
  hydrate,

  async create({ conversationId, senderId, type = "text", body = null, mediaUrl = null, meta = null, replyToId = null, createdAt = Date.now() }) {
    // Insertar y marcar como último mensaje en una sola petición atómica
    const [{ lastInsertRowid: id }] = await db.batch([
      [SQL.insert, { conversationId, senderId, type, body, mediaUrl, meta: meta ? JSON.stringify(meta) : null, replyToId, searchText: searchText(type, body, meta) ?? "", now: createdAt }],
      [SQL.setLastInserted, [conversationId]],
      [SQL.unhide, [conversationId]],
    ]);
    return Message.findById(id);
  },

  findRaw: (id) => db.get(SQL.byId, [id]),

  async findById(id) {
    const row = await db.get(SQL.byId, [id]);
    return row ? (await hydrate([row]))[0] : null;
  },

  /** Varios mensajes por id en una consulta → Map(id → mensaje). */
  async findMany(ids) {
    const unique = [...new Set(ids)].filter(Boolean);
    if (!unique.length) return new Map();
    const rows = await db.all(`SELECT * FROM messages WHERE id IN (${placeholders(unique.length)})`, unique);
    return new Map((await hydrate(rows)).map((m) => [m.id, m]));
  },

  /** Página de mensajes en orden cronológico para `viewerId`. `after` oculta los anteriores a "vaciar chat". */
  async list(conversationId, { before = Number.MAX_SAFE_INTEGER, after = 0, limit = 50, viewerId = 0 } = {}) {
    return hydrate((await db.all(SQL.page, { conversationId, before, after, limit, viewerId, now: Date.now() })).reverse());
  },

  /** Fotos, documentos, audios y mensajes con enlaces (panel de información). */
  async media(conversationId, after = 0, viewerId = 0) {
    return hydrate(await db.all(SQL.media, { conversationId, after, viewerId, now: Date.now() }));
  },

  /** Mensajes de todos los chats de `viewerId` que contienen `query` (los más recientes primero). */
  async search(viewerId, query, limit = 30) {
    // % y _ son comodines en LIKE: se escapan para buscar el texto tal cual
    const like = `%${normalize(query).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    return hydrate(await db.all(SQL.search, { viewerId, like, limit, now: Date.now() }));
  },

  /**
   * Rellena search_text en los mensajes anteriores a la búsqueda global (por lotes; al arrancar).
   * Los que no tienen nada que buscar quedan con "" para no volver a revisarlos.
   */
  async backfillSearch(batch = 500) {
    for (;;) {
      const rows = await db.all("SELECT id, type, body, meta FROM messages WHERE search_text IS NULL LIMIT ?", [batch]);
      if (!rows.length) return;
      await db.batch(rows.map((r) => ["UPDATE messages SET search_text = ? WHERE id = ?", [searchText(r.type, r.body, parseMeta(r.meta)) ?? "", r.id]]));
    }
  },

  async edit(id, body) {
    const row = await db.get(SQL.byId, [id]);
    await db.run(SQL.edit, [body, searchText(row.type, body, parseMeta(row.meta)) ?? "", Date.now(), id]);
    return Message.findById(id);
  },

  async remove(id) {
    await db.batch([
      [SQL.remove, [Date.now(), id]],
      [SQL.removeReactions, [id]],
      [SQL.unpin, [id]],
    ]);
    return Message.findById(id);
  },

  /** Reemplaza el meta (juegos y propuestas de cita guardan aquí su estado). */
  async updateMeta(id, meta) {
    await db.run("UPDATE messages SET meta = ? WHERE id = ?", [JSON.stringify(meta), id]);
    return Message.findById(id);
  },

  /** Sustituye los votos de `userId` en una encuesta por `options` (lista vacía = quitar el voto). Atómico. */
  async setVotes(messageId, userId, options) {
    const now = Date.now();
    await db.batch([
      ["DELETE FROM poll_votes WHERE message_id = ? AND user_id = ?", [messageId, userId]],
      ...options.map((option) => ["INSERT INTO poll_votes (message_id, user_id, option, created_at) VALUES (?, ?, ?, ?)", [messageId, userId, option, now]]),
    ]);
    return Message.findById(messageId);
  },

  /** Registra que `userId` abrió una foto/video de "ver una vez". false si ya la había abierto. */
  async markOpened(messageId, userId) {
    const { changes } = await db.run("INSERT OR IGNORE INTO view_once_opens (message_id, user_id, opened_at) VALUES (?, ?, ?)", [messageId, userId, Date.now()]);
    return changes > 0;
  },

  /** Quita el archivo de un mensaje (p. ej. "ver una vez" ya abierta por todos). */
  clearMedia(id) {
    return db.run("UPDATE messages SET media_url = NULL WHERE id = ?", [id]);
  },

  /** "Eliminar para mí". */
  async hideFor(userId, ids) {
    if (!ids.length) return;
    await db.batch(ids.map((id) => [SQL.hide, [userId, id]]));
  },

  /** Misma reacción = quitarla; otra = reemplazarla (una reacción por persona, como WhatsApp). */
  async react(messageId, userId, emoji) {
    const current = await db.get(SQL.reaction, [messageId, userId]);
    if (current?.emoji === emoji) await db.run(SQL.removeReaction, [messageId, userId]);
    else await db.run(SQL.addReaction, [messageId, userId, emoji, Date.now()]);
    return Message.findById(messageId);
  },

  /** Map(userId → { deliveredAt, readAt }) para "Info del mensaje". */
  async receiptTimes(conversationId, messageId) {
    const times = new Map();
    for (const { user_id, kind, at } of await db.all(SQL.receiptTimes, [conversationId, messageId])) {
      const t = times.get(user_id) || {};
      t[kind === "read" ? "readAt" : "deliveredAt"] = at;
      times.set(user_id, t);
    }
    return times;
  },

  /** Borra los mensajes temporales caducados. Devuelve [{ conversationId, ids }]. */
  async purgeExpired(now = Date.now()) {
    const rows = await db.all(SQL.expired, [now]);
    if (!rows.length) return [];
    const byConv = new Map();
    rows.forEach((r) => byConv.set(r.conversation_id, [...(byConv.get(r.conversation_id) || []), r.id]));
    const ids = rows.map((r) => r.id);
    await db.batch([
      [`DELETE FROM messages WHERE id IN (${placeholders(ids.length)})`, ids],
      ...[...byConv.keys()].map((cid) => [SQL.fixLast, [cid]]),
    ]);
    return [...byConv].map(([conversationId, list]) => ({ conversationId, ids: list }));
  },
};

module.exports = Message;
