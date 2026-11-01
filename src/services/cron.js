// Tareas periódicas. En Vercel no hay proceso encendido: un cron externo llama a
// GET /api/cron/tick cada minuto. En local (npm run dev) server.js las ejecuta cada 10 s.
const Story = require("../models/Story");
const session = require("../config/session");
const scheduler = require("./scheduler");
const calls = require("./calls");
const rateLimit = require("../middleware/rateLimit");
const special = require("../controllers/specialMessageController");

const TASKS = [
  ["programados", scheduler.sendDue],
  ["temporales", scheduler.purgeExpired],
  ["estados", () => Story.purgeExpired()],
  ["sesiones", session.purge],
  ["llamadas", calls.expireUnanswered],
  ["límites", rateLimit.purge],
  ["ver una vez", special.purgeViewOnce],
];

/** Ejecuta todas las tareas; un fallo en una no impide las demás. Devuelve las que fallaron. */
async function tick() {
  const failed = [];
  for (const [label, task] of TASKS) {
    try {
      await task();
    } catch (err) {
      console.error(`[${label}]`, err);
      failed.push(label);
    }
  }
  return failed;
}

module.exports = { tick };
