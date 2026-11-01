// Preparación que se hace una vez por proceso: en local al arrancar server.js y en Vercel
// en la primera petición de cada instancia (luego se reutiliza mientras siga encendida).
const config = require("./config");
const db = require("./config/database");

let ready = null;

async function init() {
  if (config.isProduction && db.isLocal) {
    console.warn(
      "⚠️  Producción sin TURSO_DATABASE_URL: se usa un archivo SQLite local. " +
        "En serverless el disco no se conserva y se perderán los datos."
    );
  }

  // Crea las tablas si no existen (SQLite local o Turso)
  if (await db.init()) {
    // Tras una migración: texto de búsqueda de los mensajes anteriores a la búsqueda global
    await require("./models/Message").backfillSearch();
  }

  // Primer despliegue: datos de demostración si la base está vacía (SEED_DEMO=true)
  if (config.seedDemo) {
    const { seed } = require("./db/seed");
    if (await seed()) console.log("Datos de demostración creados (contraseña: demo1234).");
  }

  // Claves para las notificaciones push (del entorno o generadas y guardadas en la base de datos)
  await require("./services/push").init();

  // Cuenta oficial que da la bienvenida a los usuarios nuevos
  await require("./services/welcome").ensureOfficialAccount();
}

/** Promesa compartida; si falla se reintenta en la siguiente petición. */
module.exports = function bootstrap() {
  if (!ready) ready = init().catch((err) => {
    ready = null;
    throw err;
  });
  return ready;
};
