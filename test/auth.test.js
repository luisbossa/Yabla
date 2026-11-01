const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { start, stop, request, login } = require("./helpers");

before(start);
after(stop);

test("inicia sesión con usuario y contraseña (con o sin @)", async () => {
  assert.equal((await request("POST", "/login", { body: { login: "andres", password: "demo1234" } })).status, 200);
  assert.equal((await request("POST", "/login", { body: { login: "@Andres", password: "demo1234" } })).status, 200);
});

test("rechaza la contraseña incorrecta y un usuario que no existe con el mismo mensaje", async () => {
  const wrong = await request("POST", "/login", { body: { login: "karla", password: "mala" } });
  const missing = await request("POST", "/login", { body: { login: "no-existe", password: "mala" } });
  assert.equal(wrong.status, 401);
  assert.equal(missing.status, 401);
  assert.equal(wrong.body.error, missing.body.error);
});

test("bloquea una cuenta tras 10 intentos y deja entrar a las demás", async () => {
  for (let i = 0; i < 10; i++) {
    assert.equal((await request("POST", "/login", { body: { login: "mauricio", password: "mala" } })).status, 401);
  }
  const blocked = await request("POST", "/login", { body: { login: "mauricio", password: "demo1234" } });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
  assert.equal((await request("POST", "/login", { body: { login: "daniela", password: "demo1234" } })).status, 200);
});

test("la API exige sesión", async () => {
  assert.equal((await request("GET", "/api/bootstrap")).status, 401);
  const cookie = await login("andres");
  const res = await request("GET", "/api/bootstrap", { cookie });
  assert.equal(res.status, 200);
  assert.equal(res.body.me.username, "andres");
});

test("el registro valida los datos y no admite usuarios repetidos", async () => {
  const form = (data) => {
    const f = new FormData();
    Object.entries(data).forEach(([k, v]) => f.append(k, v));
    return f;
  };
  const short = await request("POST", "/register", { body: form({ name: "Ana", username: "ana_prueba", password: "123" }) });
  assert.equal(short.status, 422);
  const taken = await request("POST", "/register", { body: form({ name: "Otro Andrés", username: "andres", password: "secreta1" }) });
  assert.equal(taken.status, 422);
  assert.ok(taken.body.errors.username);
  const ok = await request("POST", "/register", { body: form({ name: "Ana Prueba", username: "ana_prueba", password: "secreta1" }) });
  assert.equal(ok.status, 201);
});

test("cabeceras de seguridad", async () => {
  const res = await request("GET", "/healthz");
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  assert.match(res.headers.get("permissions-policy"), /geolocation=\(self\)/);
  assert.equal(res.headers.get("cross-origin-opener-policy"), "same-origin");
});

test("el cron exige su clave", async () => {
  assert.equal((await request("GET", "/api/cron/tick")).status, 401);
  assert.equal((await request("GET", "/api/cron/tick", { headers: { Authorization: "Bearer otra" } })).status, 401);
  const ok = await request("GET", "/api/cron/tick", { headers: { Authorization: "Bearer secreto-de-prueba" } });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { ok: true, failed: [] });
});
