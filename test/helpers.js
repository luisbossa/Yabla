// Arranca la app real contra una base SQLite temporal con los datos de demostración.
// Cada archivo de pruebas corre en su propio proceso (node --test), así que cada uno tiene su base.
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yabla-test-"));

// Antes de cargar la configuración: dotenv no pisa variables ya definidas (aunque estén vacías),
// así las pruebas nunca usan Turso, Pusher ni Blob aunque estén en el .env local.
Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_PATH: path.join(dir, "test.db"),
  TURSO_DATABASE_URL: "",
  TURSO_AUTH_TOKEN: "",
  PUSHER_APP_ID: "",
  PUSHER_KEY: "",
  PUSHER_SECRET: "",
  BLOB_READ_WRITE_TOKEN: "",
  BLOB_STORE_ID: "",
  SEED_DEMO: "true",
  CRON_SECRET: "secreto-de-prueba",
});

const PASSWORD = "demo1234";
let server;
let base;

/** Arranca el servidor una vez por archivo y devuelve su URL. */
async function start() {
  if (base) return base;
  const app = require("../src/app");
  await require("../src/bootstrap")();
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  return base;
}

async function stop() {
  await new Promise((resolve) => server?.close(resolve));
  require("../src/config/database").close();
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch {
    /* Windows puede tener aún abierto el archivo: queda en la carpeta temporal del sistema */
  }
}

/** Petición JSON. Devuelve { status, body, headers }. */
async function request(method, url, { cookie, body, headers = {} } = {}) {
  const isForm = body instanceof FormData;
  const res = await fetch(base + url, {
    method,
    redirect: "manual",
    headers: {
      Accept: "application/json",
      ...(body !== undefined && !isForm ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let data = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* no es JSON (p. ej. la exportación del chat) */
  }
  return { status: res.status, body: data, headers: res.headers };
}

/** Inicia sesión con un usuario de demostración y devuelve su cookie. */
async function login(username, password = PASSWORD) {
  const res = await request("POST", "/login", { body: { login: username, password } });
  if (res.status !== 200) throw new Error(`No se pudo iniciar sesión como ${username}: ${res.status}`);
  return res.headers.get("set-cookie").split(";")[0];
}

/** Id del chat 1 a 1 entre el usuario de `cookie` y `username`. */
async function directChat(cookie, username) {
  const { body } = await request("GET", "/api/bootstrap", { cookie });
  const conv = body.conversations.find((c) => c.type === "direct" && c.members.some((m) => m.username === username));
  if (!conv) throw new Error(`No hay chat con ${username}`);
  return conv.id;
}

/** Envía un mensaje de texto y devuelve el mensaje creado. */
async function sendText(cookie, conversationId, text) {
  const form = new FormData();
  form.append("text", text);
  const res = await request("POST", `/api/conversations/${conversationId}/messages`, { cookie, body: form });
  if (res.status !== 201) throw new Error(`No se pudo enviar: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.message;
}

/** Abre (o crea) el chat 1 a 1 con el usuario `userId` y devuelve su id. */
async function openDirect(cookie, userId) {
  const res = await request("POST", "/api/conversations", { cookie, body: { userId } });
  if (res.status >= 300) throw new Error(`No se pudo abrir el chat: ${res.status}`);
  return res.body.conversation.id;
}

module.exports = { start, stop, request, login, directChat, openDirect, sendText, PASSWORD, base: () => base };
