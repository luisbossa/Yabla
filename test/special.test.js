const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { start, stop, request, login, directChat } = require("./helpers");

let andres;
let karla;
let chat;

before(async () => {
  await start();
  [andres, karla] = await Promise.all([login("andres"), login("karla")]);
  chat = await directChat(andres, "karla");
});
after(stop);

const createPoll = (cookie, body) => request("POST", `/api/conversations/${chat}/polls`, { cookie, body });
const vote = (cookie, id, options) => request("POST", `/api/messages/${id}/vote`, { cookie, body: { options } });

// ==========================================================================
// Encuestas
// ==========================================================================
test("crea una encuesta sin opciones vacías ni repetidas", async () => {
  const res = await createPoll(andres, { question: "¿Dónde comemos?", options: ["Soda", "Pizza", "soda", "", "  Sushi "] });
  assert.equal(res.status, 201);
  assert.equal(res.body.message.type, "poll");
  assert.equal(res.body.message.body, "¿Dónde comemos?");
  assert.deepEqual(res.body.message.meta.options, ["Soda", "Pizza", "Sushi"]);
  assert.equal((await createPoll(andres, { question: "¿Sí?", options: ["Sí", "sí"] })).status, 422);
  assert.equal((await createPoll(andres, { question: "", options: ["a", "b"] })).status, 422);
});

test("votar, cambiar el voto y quitarlo en una encuesta de una respuesta", async () => {
  const { message } = (await createPoll(andres, { question: "¿Hoy o mañana?", options: ["Hoy", "Mañana"] })).body;
  assert.deepEqual((await vote(karla, message.id, [0])).body.message.votes, [{ userId: 2, option: 0 }]);
  assert.equal((await vote(karla, message.id, [0, 1])).status, 422);
  assert.deepEqual((await vote(karla, message.id, [1])).body.message.votes, [{ userId: 2, option: 1 }]);
  assert.deepEqual((await vote(karla, message.id, [])).body.message.votes, []);
  assert.equal((await vote(karla, message.id, [7])).body.message.votes.length, 0, "una opción que no existe se ignora");
});

test("los votos simultáneos no se pierden", async () => {
  const { message } = (await createPoll(andres, { question: "¿Qué día?", options: ["Lunes", "Martes", "Miércoles"], multiple: true })).body;
  await Promise.all([vote(andres, message.id, [0, 1]), vote(karla, message.id, [1, 2])]);
  const { body } = await request("GET", `/api/conversations/${chat}/messages?limit=5`, { cookie: andres });
  assert.equal(body.messages.find((m) => m.id === message.id).votes.length, 4);
});

test("solo quien la creó puede cerrarla y ya no admite votos", async () => {
  const { message } = (await createPoll(andres, { question: "¿Cine?", options: ["Sí", "No"] })).body;
  assert.equal((await request("POST", `/api/messages/${message.id}/close-poll`, { cookie: karla })).status, 403);
  const closed = await request("POST", `/api/messages/${message.id}/close-poll`, { cookie: andres });
  assert.ok(closed.body.message.meta.closedAt);
  assert.equal((await vote(karla, message.id, [0])).status, 409);
});

// ==========================================================================
// Ubicación
// ==========================================================================
test("envía una ubicación redondeada y rechaza coordenadas imposibles", async () => {
  const res = await request("POST", `/api/conversations/${chat}/location`, {
    cookie: andres,
    body: { lat: 9.93333333, lng: -84.08, accuracy: 12.6, label: "Teatro Nacional" },
  });
  assert.equal(res.status, 201);
  assert.deepEqual(res.body.message.meta, { lat: 9.933333, lng: -84.08, accuracy: 13 });
  assert.equal(res.body.message.body, "Teatro Nacional");
  for (const bad of [{ lat: 95, lng: 0 }, { lat: 0, lng: 200 }, { lat: "x", lng: 1 }]) {
    assert.equal((await request("POST", `/api/conversations/${chat}/location`, { cookie: andres, body: bad })).status, 422);
  }
});

// ==========================================================================
// Ver una vez
// ==========================================================================
async function sendViewOnce(cookie) {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: "image/png" }), "foto.png");
  form.append("viewOnce", "1");
  const res = await request("POST", `/api/conversations/${chat}/messages`, { cookie, body: form });
  assert.equal(res.status, 201);
  return res.body.message;
}

test("la foto de ver una vez no lleva su archivo en los datos del mensaje", async () => {
  const msg = await sendViewOnce(andres);
  assert.equal(msg.meta.viewOnce, true);
  assert.equal(msg.mediaUrl, null);
  const { body } = await request("GET", `/api/conversations/${chat}/messages?limit=3`, { cookie: karla });
  assert.equal(body.messages.find((m) => m.id === msg.id).mediaUrl, null);
});

test("se abre una sola vez, nunca por quien la envió, y no se reenvía", async () => {
  const msg = await sendViewOnce(andres);
  assert.equal((await request("POST", `/api/messages/${msg.id}/open`, { cookie: andres })).status, 403);

  const opened = await request("POST", `/api/messages/${msg.id}/open`, { cookie: karla });
  assert.equal(opened.status, 200);
  assert.match(opened.body.mediaUrl, /^\/uploads\//);
  assert.equal(opened.headers.get("cache-control"), "no-store");
  assert.equal((await request("POST", `/api/messages/${msg.id}/open`, { cookie: karla })).status, 410);

  const forward = await request("POST", `/api/messages/${msg.id}/forward`, { cookie: karla, body: { conversationIds: [chat] } });
  assert.equal(forward.status, 400);

  const { body } = await request("GET", `/api/conversations/${chat}/messages?limit=3`, { cookie: andres });
  assert.deepEqual(body.messages.find((m) => m.id === msg.id).openedBy, [2]);
});

test("no aparece en la búsqueda ni en el panel de multimedia", async () => {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), "secreta.png");
  form.append("text", "foto-secreta-unica");
  form.append("viewOnce", "1");
  const { body } = await request("POST", `/api/conversations/${chat}/messages`, { cookie: andres, body: form });
  assert.equal((await request("GET", "/api/search?q=foto-secreta-unica", { cookie: karla })).body.messages.length, 0);
  const media = await request("GET", `/api/conversations/${chat}/media`, { cookie: karla });
  assert.ok(!media.body.messages.some((m) => m.id === body.message.id));
});
