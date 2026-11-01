-- Esquema de Yabla. Las fechas se guardan como milisegundos Unix (INTEGER).

CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,
  username        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  email           TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash   TEXT    NOT NULL,
  avatar          TEXT,
  bio             TEXT    NOT NULL DEFAULT 'Hola, estoy usando Yabla 👋',
  phone           TEXT,
  balance_cents   INTEGER NOT NULL DEFAULT 0,      -- saldo en dólares (centavos)
  balance_crc_cents INTEGER NOT NULL DEFAULT 0,    -- saldo en colones (céntimos)
  read_receipts   INTEGER NOT NULL DEFAULT 1,
  show_last_seen  INTEGER NOT NULL DEFAULT 1,
  presence_status TEXT    NOT NULL DEFAULT 'available', -- available | busy | away | dnd
  profile_color   TEXT    NOT NULL DEFAULT 'blue',      -- color del perfil (portada y nombre en grupos)
  birthday        TEXT,                                 -- "MM-DD" (opcional, sin año)
  last_seen       INTEGER,
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  type            TEXT    NOT NULL CHECK (type IN ('direct', 'group')),
  name            TEXT,
  avatar          TEXT,
  description     TEXT,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  last_message_id INTEGER,
  disappear_after INTEGER NOT NULL DEFAULT 0, -- mensajes temporales: segundos (0 = desactivados)
  origin          TEXT    NOT NULL DEFAULT 'chat', -- 'match' si nació de un match de «Conocer»
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id   INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role              TEXT    NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  last_read_id      INTEGER NOT NULL DEFAULT 0,
  last_delivered_id INTEGER NOT NULL DEFAULT 0,
  cleared_id        INTEGER NOT NULL DEFAULT 0,
  muted             INTEGER NOT NULL DEFAULT 0,
  pinned            INTEGER NOT NULL DEFAULT 0,
  hidden            INTEGER NOT NULL DEFAULT 0, -- "eliminar chat": oculto hasta que llegue un mensaje nuevo
  archived          INTEGER NOT NULL DEFAULT 0, -- chat archivado (sale de la lista principal)
  joined_at         INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_members_user ON conversation_members(user_id);

-- type: text | image | file | audio | sticker | call | payment | system
CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  type            TEXT    NOT NULL DEFAULT 'text',
  body            TEXT,
  media_url       TEXT,
  meta            TEXT,
  reply_to_id     INTEGER REFERENCES messages(id) ON DELETE SET NULL,
  edited_at       INTEGER,
  deleted_at      INTEGER,
  expires_at      INTEGER, -- mensajes temporales: momento en que desaparece
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, id);

CREATE TABLE IF NOT EXISTS reactions (
  message_id  INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji       TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id)
);

-- "Eliminar para mí": mensajes que un usuario ya no quiere ver
CREATE TABLE IF NOT EXISTS message_hidden (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id  INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, message_id)
);

-- Mensajes fijados arriba del chat (máx. 3 por conversación, como WhatsApp)
CREATE TABLE IF NOT EXISTS pinned_messages (
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id      INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  pinned_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  pinned_at       INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, message_id)
);

-- Historial de entregas y lecturas: permite saber cuándo leyó cada persona un mensaje
-- ("Info del mensaje"). up_to_id = hasta qué mensaje llegó en ese momento.
CREATE TABLE IF NOT EXISTS receipt_events (
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind            TEXT    NOT NULL CHECK (kind IN ('delivered', 'read')),
  up_to_id        INTEGER NOT NULL,
  at              INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_receipt_events ON receipt_events(conversation_id, user_id, kind, up_to_id);

-- Mensajes programados: se envían solos a la hora elegida
CREATE TABLE IF NOT EXISTS scheduled_messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body            TEXT    NOT NULL,
  reply_to_id     INTEGER REFERENCES messages(id) ON DELETE SET NULL,
  send_at         INTEGER NOT NULL,
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scheduled_send_at ON scheduled_messages(send_at);

-- «Conocer»: perfiles de citas (opcionales), deslizamientos, matches y reportes
CREATE TABLE IF NOT EXISTS dating_profiles (
  user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  active        INTEGER NOT NULL DEFAULT 1,
  paused        INTEGER NOT NULL DEFAULT 0,
  birthdate     TEXT    NOT NULL,              -- YYYY-MM-DD (solo mayores de 18)
  gender        TEXT    NOT NULL,              -- woman | man | nonbinary
  interested_in TEXT    NOT NULL,              -- women | men | everyone
  looking_for   TEXT    NOT NULL DEFAULT 'no_se', -- pareja | algo_casual | amistad | no_se
  province      TEXT    NOT NULL,              -- provincia de Costa Rica (distancia aproximada)
  about         TEXT,
  interests     TEXT    NOT NULL DEFAULT '[]', -- JSON
  prompts       TEXT    NOT NULL DEFAULT '[]', -- JSON [{q, a}]
  photos        TEXT    NOT NULL DEFAULT '[]', -- JSON [url]
  age_min       INTEGER NOT NULL DEFAULT 18,
  age_max       INTEGER NOT NULL DEFAULT 45,
  max_km        INTEGER NOT NULL DEFAULT 200,
  verified      INTEGER NOT NULL DEFAULT 0,
  verified_at   INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dating_swipes (
  from_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action      TEXT    NOT NULL CHECK (action IN ('like', 'pass', 'superlike')),
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (from_id, to_id)
);

CREATE INDEX IF NOT EXISTS idx_swipes_to ON dating_swipes(to_id, action);

CREATE TABLE IF NOT EXISTS dating_matches (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_a          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- el menor id
  user_b          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
  created_at      INTEGER NOT NULL,
  unmatched_by    INTEGER,
  unmatched_at    INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_pair ON dating_matches(user_a, user_b);

CREATE TABLE IF NOT EXISTS dating_reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason      TEXT    NOT NULL,
  details     TEXT,
  created_at  INTEGER NOT NULL
);

-- Mensajes destacados (con estrella) por cada usuario
CREATE TABLE IF NOT EXISTS stars (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id  INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, message_id)
);

CREATE TABLE IF NOT EXISTS stories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_url   TEXT    NOT NULL,
  caption     TEXT,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stories_user ON stories(user_id, expires_at);

CREATE TABLE IF NOT EXISTS story_views (
  story_id   INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  viewer_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_at  INTEGER NOT NULL,
  PRIMARY KEY (story_id, viewer_id)
);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  to_user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
  currency      TEXT    NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'CRC')),
  note          TEXT,
  created_at    INTEGER NOT NULL
);

-- Archivos subidos (fotos, documentos, notas de voz). Se guardan en la base de datos
-- para no depender de un disco: así funciona en alojamientos gratuitos sin almacenamiento.
CREATE TABLE IF NOT EXISTS files (
  id          TEXT    PRIMARY KEY,
  mime        TEXT    NOT NULL,
  name        TEXT,
  size        INTEGER NOT NULL,
  data        BLOB    NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  sid      TEXT    PRIMARY KEY,
  sess     TEXT    NOT NULL,
  expires  INTEGER NOT NULL
);

-- Notificaciones push (Web Push): una fila por navegador/dispositivo suscrito
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint     TEXT    NOT NULL UNIQUE,
  p256dh       TEXT    NOT NULL,
  auth         TEXT    NOT NULL,
  preview      INTEGER NOT NULL DEFAULT 1, -- 0 = no mostrar el texto del mensaje en la notificación
  user_agent   TEXT,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);

-- Ajustes del servidor que deben sobrevivir a los reinicios (p. ej. claves VAPID generadas)
CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Llamadas en curso (en serverless no hay memoria compartida entre peticiones).
-- Al terminar se guarda ended_at y queda un mensaje de tipo "call" en el chat.
CREATE TABLE IF NOT EXISTS calls (
  id              TEXT    PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  type            TEXT    NOT NULL CHECK (type IN ('audio', 'video')),
  caller_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  callee_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  answered_at     INTEGER,
  created_at      INTEGER NOT NULL,
  ended_at        INTEGER
);

CREATE INDEX IF NOT EXISTS idx_calls_open ON calls(ended_at, caller_id, callee_id);

-- Límite de intentos (inicio de sesión, registro, envíos…). En serverless no hay memoria
-- compartida entre peticiones, así que el contador vive aquí. Ventana fija por clave.
CREATE TABLE IF NOT EXISTS rate_limits (
  key          TEXT    PRIMARY KEY,
  window_start INTEGER NOT NULL,
  hits         INTEGER NOT NULL
);

-- Encuestas (mensajes de tipo "poll"): un voto por persona y opción. Tabla propia (no el meta
-- del mensaje) para que dos votos a la vez no se pisen.
CREATE TABLE IF NOT EXISTS poll_votes (
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  option     INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id, option)
);

-- Fotos y videos de "ver una vez": quién la abrió ya (cada persona solo una vez)
CREATE TABLE IF NOT EXISTS view_once_opens (
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opened_at  INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id)
);

-- Índices de rendimiento. Varios los usan las tareas que corren cada minuto (services/cron.js):
-- sin ellos recorrerían la tabla entera en cada pasada (y Turso cobra por filas leídas).
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires);
-- "Cerrar las otras sesiones" busca por el usuario guardado dentro de la sesión
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(json_extract(sess, '$.userId'));
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window_start);
CREATE INDEX IF NOT EXISTS idx_stories_expires ON stories(expires_at);
-- Movimientos de la billetera (enviados o recibidos)
CREATE INDEX IF NOT EXISTS idx_transactions_from ON transactions(from_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_transactions_to ON transactions(to_user_id, created_at);
-- Solo las fotos/videos de "ver una vez" que aún tienen archivo (índice parcial: casi vacío)
CREATE INDEX IF NOT EXISTS idx_messages_view_once ON messages(created_at)
  WHERE media_url IS NOT NULL AND json_extract(meta, '$.viewOnce') = 1;
