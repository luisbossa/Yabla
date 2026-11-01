const bcrypt = require("bcryptjs");

// Hash de relleno para verifyPassword cuando el usuario no existe (mismo coste que los reales)
const DUMMY_HASH = bcrypt.hashSync("yabla-usuario-inexistente", 10);
const db = require("../config/database");
const config = require("../config");
const presence = require("../services/presence");

const DEFAULT_AVATAR = "/assets/images/ui/avatar-default.svg";
const OFFICIAL_USERNAME = "yabla"; // cuenta oficial que da la bienvenida (services/welcome.js)
// Las cuentas nuevas no usan correo. La columna email es obligatoria en bases ya desplegadas,
// así que se guarda un identificador interno único que nunca se muestra.
const NO_EMAIL_DOMAIN = "@sin-correo.yabla";
const crypto = require("crypto");

const SQL = {
  insert: `
    INSERT INTO users (name, username, email, password_hash, avatar, phone, bio, balance_cents, balance_crc_cents, created_at)
    VALUES (@name, @username, @email, @passwordHash, @avatar, @phone, COALESCE(@bio, 'Hola, estoy usando Yabla 👋'), @balance, @balanceCrc, @now)`,
  byId: "SELECT * FROM users WHERE id = ?",
  byEmail: "SELECT * FROM users WHERE email = ?",
  byUsername: "SELECT * FROM users WHERE username = ?",
  byLogin: "SELECT * FROM users WHERE email = ? OR username = ?",
  search: `
    SELECT * FROM users
    WHERE id <> @me AND (name LIKE @q OR username LIKE @q)
    ORDER BY name COLLATE NOCASE
    LIMIT @limit`,
  touchLastSeen: "UPDATE users SET last_seen = ? WHERE id = ?",
  // Usuarios con los que comparto al menos una conversación
  contactIds: `
    SELECT DISTINCT other.user_id AS id
    FROM conversation_members mine
    JOIN conversation_members other ON other.conversation_id = mine.conversation_id
    WHERE mine.user_id = ? AND other.user_id <> mine.user_id`,
  isBlocked: `
    SELECT 1 FROM blocks
    WHERE (blocker_id = @a AND blocked_id = @b) OR (blocker_id = @b AND blocked_id = @a)`,
  blockedByMe: "SELECT blocked_id AS id FROM blocks WHERE blocker_id = ?",
  block: "INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)",
  unblock: "DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?",
};

const EDITABLE = ["name", "username", "bio", "phone", "avatar", "presence_status", "profile_color", "birthday"];
// Estados de disponibilidad (como Slack o Teams) y colores de perfil
const STATUSES = ["available", "busy", "away", "dnd"];
const COLORS = ["blue", "violet", "green", "pink", "orange", "teal", "red", "slate"];
const SETTINGS = { readReceipts: "read_receipts", showLastSeen: "show_last_seen" };
const placeholders = (n) => Array(n).fill("?").join(",");

const User = {
  DEFAULT_AVATAR,
  OFFICIAL_USERNAME,
  STATUSES,
  COLORS,

  async create({ name, username, email = null, password, avatar = null, phone = null, bio = null }, executor = db) {
    const { lastInsertRowid } = await executor.run(SQL.insert, {
      name,
      username,
      email: email || `${crypto.randomUUID()}${NO_EMAIL_DOMAIN}`,
      passwordHash: bcrypt.hashSync(password, 10),
      avatar,
      phone,
      bio,
      balance: config.initialBalanceCents,
      balanceCrc: config.initialBalanceCrcCents,
      now: Date.now(),
    });
    return executor.get(SQL.byId, [lastInsertRowid]);
  },

  findById: (id) => db.get(SQL.byId, [id]),
  findByEmail: (email) => db.get(SQL.byEmail, [email]),
  findByUsername: (username) => db.get(SQL.byUsername, [username]),
  findByLogin: (login) => db.get(SQL.byLogin, [login, login]),

  /** De una lista de nombres de usuario, los que siguen libres. */
  async availableUsernames(candidates) {
    const unique = [...new Set(candidates)];
    if (!unique.length) return [];
    const taken = new Set((await db.all(`SELECT username FROM users WHERE username IN (${placeholders(unique.length)})`, unique)).map((r) => r.username.toLowerCase()));
    return unique.filter((u) => !taken.has(u.toLowerCase()));
  },

  /** Varios usuarios en una sola consulta → Map(id → fila). */
  async findMany(ids) {
    const unique = [...new Set(ids)].filter(Boolean);
    if (!unique.length) return new Map();
    const rows = await db.all(`SELECT * FROM users WHERE id IN (${placeholders(unique.length)})`, unique);
    return new Map(rows.map((u) => [u.id, u]));
  },

  async updatePassword(id, password) {
    await db.run("UPDATE users SET password_hash = ? WHERE id = ?", [bcrypt.hashSync(password, 10), id]);
  },

  /** Cierra las demás sesiones del usuario (otros dispositivos). Devuelve cuántas. */
  async destroyOtherSessions(id, keepSid) {
    const { changes } = await db.run("DELETE FROM sessions WHERE sid <> ? AND json_extract(sess, '$.userId') = ?", [keepSid, id]);
    return changes;
  },

  /** Si el usuario no existe se compara igual con un hash cualquiera: así tarda lo mismo y no delata qué usuarios existen. */
  verifyPassword(user, password) {
    const matches = bcrypt.compareSync(password, user?.password_hash || DUMMY_HASH);
    return Boolean(user) && matches;
  },

  search(meId, query, limit = 20) {
    return db.all(SQL.search, { me: meId, q: `%${query}%`, limit });
  },

  async update(id, fields) {
    const entries = Object.entries(fields).filter(([key, value]) => EDITABLE.includes(key) && value !== undefined);
    if (entries.length) {
      const sets = entries.map(([key]) => `${key} = @${key}`).join(", ");
      await db.run(`UPDATE users SET ${sets} WHERE id = @id`, { ...Object.fromEntries(entries), id });
    }
    return User.findById(id);
  },

  async updateSettings(id, settings) {
    const entries = Object.entries(settings).filter(([key]) => key in SETTINGS);
    if (entries.length) {
      const sets = entries.map(([key]) => `${SETTINGS[key]} = @${key}`).join(", ");
      const values = Object.fromEntries(entries.map(([key, value]) => [key, value ? 1 : 0]));
      await db.run(`UPDATE users SET ${sets} WHERE id = @id`, { ...values, id });
    }
    return User.findById(id);
  },

  touchLastSeen(id, at = Date.now(), executor = db) {
    return executor.run(SQL.touchLastSeen, [at, id]);
  },

  async contactIds(id) {
    return (await db.all(SQL.contactIds, [id])).map((row) => row.id);
  },

  async isBlocked(a, b) {
    return Boolean(await db.get(SQL.isBlocked, { a, b }));
  },

  async blockedIds(id) {
    return (await db.all(SQL.blockedByMe, [id])).map((row) => row.id);
  },

  async toggleBlock(blockerId, blockedId) {
    if ((await db.run(SQL.unblock, [blockerId, blockedId])).changes) return false;
    await db.run(SQL.block, [blockerId, blockedId, Date.now()]);
    return true;
  },

  /** Datos visibles para otros usuarios (sin correo ni contraseña). */
  toPublic(user) {
    if (!user) return null;
    return {
      id: user.id,
      name: user.name,
      username: user.username,
      avatar: user.avatar || DEFAULT_AVATAR,
      bio: user.bio,
      phone: user.phone,
      online: presence.isOnline(user),
      lastSeen: user.show_last_seen ? user.last_seen : null,
      official: user.username === OFFICIAL_USERNAME,
      status: user.presence_status || "available",
      color: user.profile_color || "blue",
      birthday: user.birthday || null,
    };
  },

  /** Saldos de la billetera por moneda (en centavos/céntimos). */
  balancesOf(user) {
    return { USD: user.balance_cents, CRC: user.balance_crc_cents ?? 0 };
  },

  /** Datos completos del usuario conectado. */
  toSelf(user) {
    return {
      ...User.toPublic(user),
      email: user.email?.endsWith(NO_EMAIL_DOMAIN) ? null : user.email,
      balances: User.balancesOf(user),
      createdAt: user.created_at,
      settings: { readReceipts: Boolean(user.read_receipts), showLastSeen: Boolean(user.show_last_seen) },
    };
  },
};

module.exports = User;
