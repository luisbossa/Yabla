const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { start, stop, request, login, directChat, openDirect, sendText, base } = require("./helpers");

let andres;
let karla;
let chat;

before(async () => {
  await start();
  [andres, karla] = await Promise.all([login("andres"), login("karla")]);
  chat = await directChat(andres, "karla");
});
after(stop);

test("envía, lista y edita un mensaje", async () => {
  const msg = await sendText(andres, chat, "Hola, ¿cómo vas?");
  const { body } = await request("GET", `/api/conversations/${chat}/messages`, { cookie: karla });
  assert.ok(body.messages.some((m) => m.id === msg.id && m.body === "Hola, ¿cómo vas?"));

  const edited = await request("PATCH", `/api/messages/${msg.id}`, { cookie: andres, body: { text: "Hola, ¿qué tal?" } });
  assert.equal(edited.status, 200);
  assert.ok(edited.body.message.editedAt);
  assert.equal((await request("PATCH", `/api/messages/${msg.id}`, { cookie: karla, body: { text: "No es mío" } })).status, 403);
});

test("no deja escribir en un chat del que no eres miembro", async () => {
  const mauricio = await login("mauricio");
  const res = await request("GET", `/api/conversations/${chat}/messages`, { cookie: mauricio });
  assert.equal(res.status, 404);
});

test("la búsqueda global ignora tildes y mayúsculas", async () => {
  await sendText(karla, chat, "Mañana probamos el café de Naranjo");
  for (const q of ["cafe", "CAFÉ", "manana", "NARANJO"]) {
    const { body } = await request("GET", `/api/search?q=${encodeURIComponent(q)}`, { cookie: andres });
    assert.ok(body.messages.some((m) => m.body.includes("café de Naranjo")), `«${q}» debería encontrar el mensaje`);
  }
});

test("la búsqueda trata % y _ como texto y pide al menos 2 caracteres", async () => {
  await sendText(andres, chat, "Descuento del 50% en todo");
  const percent = await request("GET", `/api/search?q=${encodeURIComponent("50%")}`, { cookie: andres });
  assert.ok(percent.body.messages.every((m) => m.body.includes("50%")));
  assert.ok(percent.body.messages.length >= 1);
  assert.deepEqual((await request("GET", "/api/search?q=a", { cookie: andres })).body.messages, []);
});

test("la búsqueda no muestra mensajes de chats ajenos ni eliminados", async () => {
  const secret = await sendText(andres, chat, "palabra-secreta-xyz");
  const mauricio = await login("mauricio");
  assert.equal((await request("GET", "/api/search?q=palabra-secreta-xyz", { cookie: mauricio })).body.messages.length, 0);

  await request("DELETE", `/api/messages/${secret.id}`, { cookie: andres });
  assert.equal((await request("GET", "/api/search?q=palabra-secreta-xyz", { cookie: karla })).body.messages.length, 0);
});

test("exporta el chat como texto con BOM y nombre sin tildes", async () => {
  await sendText(andres, chat, "Línea para exportar ✅");
  const res = await fetch(`${base()}/api/conversations/${chat}/export?tz=America/Costa_Rica`, { headers: { cookie: andres } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/plain/);
  assert.match(res.headers.get("content-disposition"), /filename="yabla-karla-jimenez\.txt"/);
  // Se leen los bytes: res.text() quitaría el BOM
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const text = bytes.subarray(3).toString("utf8");
  assert.ok(text.startsWith("Chat de Yabla: Karla Jiménez"));
  assert.match(text, /Andrés Solano \(tú\): Línea para exportar ✅/);
});

test("limita los envíos masivos", async () => {
  const mauricio = await login("mauricio");
  const toKarla = await openDirect(mauricio, 2);
  // La ventana del límite es por minuto exacto: si falta poco para el cambio, se espera al siguiente
  const left = 60000 - (Date.now() % 60000);
  if (left < 15000) await new Promise((r) => setTimeout(r, left + 50));
  const statuses = [];
  for (let i = 0; i < 125; i++) {
    const form = new FormData();
    form.append("text", `spam ${i}`);
    statuses.push((await request("POST", `/api/conversations/${toKarla}/messages`, { cookie: mauricio, body: form })).status);
  }
  assert.equal(statuses.filter((s) => s === 201).length, 120);
  assert.equal(statuses.at(-1), 429);
});
