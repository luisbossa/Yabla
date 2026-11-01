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

const lastCallMessage = async () => {
  const { body } = await request("GET", `/api/conversations/${chat}/messages?limit=10`, { cookie: andres });
  return body.messages.filter((m) => m.type === "call").at(-1);
};

test("llamar a alguien desconectado deja una llamada perdida", async () => {
  const res = await request("POST", "/api/calls", { cookie: andres, body: { conversationId: chat, type: "video" } });
  assert.match(res.body.error, /no está conectado/);
  assert.equal((await lastCallMessage()).meta.status, "missed");
});

test("llamada completa: sonar, ocupado, contestar una sola vez y colgar", async () => {
  // "Al conectarse" Karla queda en línea
  await request("POST", "/api/realtime/hello", { cookie: karla });

  const invite = await request("POST", "/api/calls", { cookie: andres, body: { conversationId: chat, type: "audio" } });
  assert.ok(invite.body.callId);
  const { callId } = invite.body;

  const busy = await request("POST", "/api/calls", { cookie: andres, body: { conversationId: chat, type: "audio" } });
  assert.match(busy.body.error, /Ya estás en una llamada/);

  assert.equal((await request("POST", `/api/calls/${callId}/accept`, { cookie: andres })).body.error, "La llamada ya terminó.", "quien llama no puede contestar");
  assert.deepEqual((await request("POST", `/api/calls/${callId}/accept`, { cookie: karla })).body, { ok: true });
  assert.ok((await request("POST", `/api/calls/${callId}/accept`, { cookie: karla })).body.error, "no se contesta dos veces");

  await request("POST", `/api/calls/${callId}/end`, { cookie: andres });
  const msg = await lastCallMessage();
  assert.equal(msg.meta.status, "completed");
  assert.equal(msg.meta.callType, "audio");
});

test("rechazar una llamada la registra como rechazada", async () => {
  const { callId } = (await request("POST", "/api/calls", { cookie: andres, body: { conversationId: chat, type: "audio" } })).body;
  await request("POST", `/api/calls/${callId}/reject`, { cookie: karla });
  assert.equal((await lastCallMessage()).meta.status, "declined");
});

test("solo se llama en chats individuales de los que eres miembro", async () => {
  const mauricio = await login("mauricio");
  const res = await request("POST", "/api/calls", { cookie: mauricio, body: { conversationId: chat, type: "audio" } });
  assert.match(res.body.error, /chats individuales/);
});
