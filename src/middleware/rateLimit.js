// Límite de peticiones por ventana fija, guardado en la base de datos (tabla rate_limits):
// en Vercel cada petición puede ir a una instancia distinta y un contador en memoria no serviría.
const db = require("../config/database");
const { httpError } = require("./errorHandler");

const SQL = {
  // Suma un intento; si la ventana anterior terminó, empieza una nueva. Devuelve el total.
  hit: `
    INSERT INTO rate_limits (key, window_start, hits) VALUES (?1, ?2, 1)
    ON CONFLICT (key) DO UPDATE SET
      hits = CASE WHEN window_start = ?2 THEN hits + 1 ELSE 1 END,
      window_start = ?2
    RETURNING hits`,
  purge: "DELETE FROM rate_limits WHERE window_start < ?",
};

// Las ventanas más largas que se usan (registro: 1 hora); lo anterior ya no cuenta
const MAX_WINDOW = 60 * 60 * 1000;

const minutes = (ms) => Math.ceil(ms / 60000);

/**
 * Middleware: hasta `max` peticiones cada `windowMs` por clave. `by` saca la clave de la petición
 * (por defecto la IP); si devuelve null no se limita. Al pasarse: 429 con Retry-After.
 */
function rateLimit({ name, max, windowMs, by = (req) => req.ip, message }) {
  return async (req, res, next) => {
    const id = by(req);
    if (id == null || id === "") return next();
    const now = Date.now();
    const windowStart = now - (now % windowMs);
    try {
      const { hits } = await db.get(SQL.hit, [`${name}:${String(id).toLowerCase()}`, windowStart]);
      if (hits <= max) return next();
    } catch (err) {
      // Si la base de datos falla, no se bloquea a nadie por el límite
      console.error("[límite]", err);
      return next();
    }
    const retryAfter = windowStart + windowMs - now;
    res.set("Retry-After", String(Math.ceil(retryAfter / 1000)));
    next(httpError(429, message || `Demasiados intentos. Espera ${minutes(retryAfter)} min y vuelve a probar.`));
  };
}

/** Borra los contadores de ventanas que ya terminaron (tarea periódica, ver services/cron.js). */
rateLimit.purge = () => db.run(SQL.purge, [Date.now() - MAX_WINDOW]);

// Claves habituales
rateLimit.byUser = (req) => req.user?.id;
rateLimit.byLogin = (req) => {
  const login = req.body?.login || req.body?.username || req.body?.email;
  return typeof login === "string" ? login.trim().replace(/^@/, "").slice(0, 120) : null;
};

module.exports = rateLimit;
