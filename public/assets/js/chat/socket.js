// Conexión en tiempo real con Pusher Channels (usa la cookie de sesión). Se reconecta sola.
// Expone la misma interfaz que tenía Socket.IO: socket.on(evento, fn), socket.emit(evento, datos, ack)
// y socket.connected. Los eventos del servidor llegan por el canal privado del usuario; lo que
// el navegador enviaba por el socket ahora va por HTTP (ver EMITTERS).
/* global Pusher */
const config = JSON.parse(document.getElementById("clientConfig").textContent);

const listeners = new Map(); // evento -> Set(fn)
const dispatch = (event, data) => listeners.get(event)?.forEach((fn) => fn(data));

const pusher = config.pusher && window.Pusher
  ? new Pusher(config.pusher.key, { cluster: config.pusher.cluster, channelAuthorization: { endpoint: "/api/realtime/auth", transport: "ajax" } })
  : null;
if (!pusher) console.warn("Tiempo real desactivado: faltan las claves de Pusher en el servidor.");

let connected = false;
const socketId = () => pusher?.connection.socket_id;

function post(url, body, { keepalive = false } = {}) {
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (socketId()) headers["X-Socket-Id"] = socketId();
  return fetch(url, { method: "POST", headers, credentials: "same-origin", body: JSON.stringify(body || {}), keepalive })
    .then((res) => res.json().catch(() => ({})))
    .catch(() => ({ error: "Sin conexión con el servidor." }));
}

// --- Canal del usuario: todos los eventos del servidor ----------------------------------
// prefix: "dev-" en local, para no mezclarse con producción si se usa la misma app de Pusher
const prefix = config.pusher?.prefix || "";
const userChannel = pusher?.subscribe(`private-${prefix}user-${config.userId}`);

userChannel?.bind_global((event, data) => {
  if (event.startsWith("pusher:")) return;
  // La contraseña se cambió en esta misma pestaña: el aviso es para los demás dispositivos
  if (event === "session:revoked" && data?.keepTag && data.keepTag === config.sessionTag) return;
  // El evento era demasiado grande para Pusher: se recarga el estado desde la API
  if (event === "sync") return document.dispatchEvent(new CustomEvent("socket:reconnected"));
  dispatch(event, data);
  if (event === "call:ended" && data?.callId === call.id) leaveCall();
});

// Sesión caducada o usuario borrado: al inicio
userChannel?.bind("pusher:subscription_error", ({ status } = {}) => {
  if (status === 401 || status === 403) window.location.href = "/";
});

// Conectado = suscrito al canal del usuario (Pusher se vuelve a suscribir tras cada reconexión)
userChannel?.bind("pusher:subscription_succeeded", () => {
  connected = true;
  post("/api/realtime/hello"); // en línea al instante y lo pendiente pasa a "entregado"
  dispatch("connect");
});

pusher?.connection.bind("state_change", ({ current }) => {
  if (current === "connected" || !connected) return;
  connected = false;
  dispatch("disconnect");
});

// --- Llamadas: canal propio por llamada para la señalización WebRTC ----------------------
// La oferta, la respuesta y los candidatos ICE van directos al otro navegador como eventos
// de cliente. Pusher limita esos eventos a 10 KB y 10 por segundo: los candidatos se agrupan,
// los mensajes grandes se trocean y se envían con una pausa mínima entre uno y otro.
const CHUNK = 8000;
const GAP = 120;
const call = { id: null, channel: null, ready: null, outbox: [], pumping: false, candidates: [], flushTimer: null, parts: new Map() };

function joinCall(callId) {
  leaveCall();
  call.id = callId;
  call.channel = pusher.subscribe(`presence-${prefix}call-${callId}`);
  call.ready = new Promise((resolve, reject) => {
    call.channel.bind("pusher:subscription_succeeded", resolve);
    call.channel.bind("pusher:subscription_error", reject);
  });
  call.channel.bind("client-signal", receiveSignal);
  return call.ready;
}

function leaveCall() {
  if (!call.id) return;
  pusher.unsubscribe(`presence-${prefix}call-${call.id}`);
  clearTimeout(call.flushTimer);
  Object.assign(call, { id: null, channel: null, ready: null, outbox: [], pumping: false, candidates: [], flushTimer: null, parts: new Map() });
}

async function pump() {
  if (call.pumping) return;
  call.pumping = true;
  const channel = call.channel;
  try {
    await call.ready;
    while (call.channel === channel && call.outbox.length) {
      channel.trigger("client-signal", call.outbox.shift());
      if (call.outbox.length) await new Promise((r) => setTimeout(r, GAP));
    }
  } catch {
    /* la llamada terminó o no se pudo abrir el canal */
  } finally {
    if (call.channel === channel) call.pumping = false;
  }
}

function sendPayload(payload) {
  const text = JSON.stringify(payload);
  if (text.length <= CHUNK) call.outbox.push({ payload });
  else {
    const id = Math.random().toString(36).slice(2);
    const n = Math.ceil(text.length / CHUNK);
    for (let i = 0; i < n; i++) call.outbox.push({ id, i, n, part: text.slice(i * CHUNK, (i + 1) * CHUNK) });
  }
  pump();
}

function flushCandidates() {
  clearTimeout(call.flushTimer);
  call.flushTimer = null;
  if (call.candidates.length) sendPayload({ candidates: call.candidates.splice(0) });
}

function sendSignal({ callId, data }) {
  if (!pusher || callId !== call.id || !data) return;
  if (data.candidate) {
    call.candidates.push(data.candidate);
    if (!call.flushTimer) call.flushTimer = setTimeout(flushCandidates, GAP);
  } else {
    sendPayload(data);
    flushCandidates();
  }
}

function receiveSignal(msg) {
  let payload = msg.payload;
  if (!payload) {
    const parts = call.parts.get(msg.id) || [];
    parts[msg.i] = msg.part;
    call.parts.set(msg.id, parts);
    if (parts.filter((p) => p !== undefined).length < msg.n) return;
    call.parts.delete(msg.id);
    payload = JSON.parse(parts.join(""));
  }
  const callId = call.id;
  if (payload.candidates) payload.candidates.forEach((candidate) => dispatch("call:signal", { callId, data: { candidate } }));
  else dispatch("call:signal", { callId, data: payload });
}

// --- Visibilidad: latido mientras la app está a la vista (el servidor no envía push) -------
let visibleTimer = null;
function reportVisibility({ visible } = {}, keepalive = false) {
  clearInterval(visibleTimer);
  if (visible) visibleTimer = setInterval(() => post("/api/realtime/visibility", { visible: true }), 30 * 1000);
  post("/api/realtime/visibility", { visible: Boolean(visible) }, { keepalive });
}

// --- Lo que antes se enviaba por el socket -----------------------------------------------
const EMITTERS = {
  typing: (data) => post("/api/realtime/typing", data),
  "conversation:read": (data) => post("/api/realtime/receipt", { ...data, kind: "read" }),
  "message:delivered": (data) => post("/api/realtime/receipt", { ...data, kind: "delivered" }),
  "app:visibility": (data) => reportVisibility(data, !data?.visible),

  async "call:invite"(data, ack) {
    const res = await post("/api/calls", data);
    if (!res.error && res.callId) {
      joinCall(res.callId).catch(() => {});
      // Nadie contestó a tiempo: el servidor avisa a los dos y deja la llamada perdida en el chat
      setTimeout(() => call.id === res.callId && post(`/api/calls/${res.callId}/timeout`), res.ringTimeout || 35000);
    }
    ack(res.error || res.callId ? res : { error: "No se pudo iniciar la llamada." });
  },
  async "call:accept"({ callId }) {
    try {
      await joinCall(callId); // antes de contestar: así el llamante ya puede enviar la oferta
    } catch {
      /* se intenta igual; la conexión fallará y se colgará */
    }
    const res = await post(`/api/calls/${callId}/accept`);
    if (res.error) dispatch("call:ended", { callId, reason: "cancelled" });
  },
  "call:reject": ({ callId }) => {
    post(`/api/calls/${callId}/reject`);
    if (callId === call.id) leaveCall();
  },
  "call:end": ({ callId }) => {
    post(`/api/calls/${callId}/end`, {}, { keepalive: true });
    if (callId === call.id) leaveCall();
  },
  "call:signal": sendSignal,
};

export const socket = {
  get connected() {
    return connected;
  },
  on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
  },
  emit(event, data, ack = () => {}) {
    const emitter = EMITTERS[event];
    if (!emitter) return console.warn("Evento sin destino:", event);
    emitter(data, ack);
  },
};

// La contraseña se cambió en otro dispositivo y se cerraron las demás sesiones
socket.on("session:revoked", () => {
  window.location.href = "/login?aviso=contrasena";
});

// --- Aviso de conexión ---------------------------------------------------------------
// Una sola línea arriba (respeta la barra de estado del teléfono): «Sin conexión · Reconectando…»
// con un indicador girando; al volver, «Conectado» en verde un momento. Los cortes de menos de
// un segundo no se muestran (evita parpadeos al cambiar de red).
const banner = document.createElement("div");
banner.id = "connBanner";
banner.className = "conn-banner";
banner.setAttribute("role", "status");
banner.setAttribute("aria-live", "polite");
banner.innerHTML = '<span class="conn-ico" aria-hidden="true"></span><span class="conn-text"><strong></strong><span></span></span>';
document.body.append(banner);

let showTimer = null;
let hideTimer = null;

function showBanner(state) {
  clearTimeout(hideTimer);
  const text = {
    offline: navigator.onLine === false ? ["Sin internet", "Esperando señal…"] : ["Sin conexión", "Reconectando…"],
    online: ["Conectado", ""],
  }[state];
  banner.querySelector("strong").textContent = text[0];
  banner.querySelector(".conn-text span").textContent = text[1];
  banner.dataset.state = state;
  banner.classList.add("is-visible");
}

function hideBanner(delay = 0) {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => banner.classList.remove("is-visible"), delay);
}

// Sin internet en el dispositivo: el texto lo dice (y se actualiza si vuelve la red)
addEventListener("offline", () => banner.dataset.state === "offline" && showBanner("offline"));
addEventListener("online", () => banner.dataset.state === "offline" && showBanner("offline"));

let wasConnected = false;
socket.on("disconnect", () => {
  document.body.classList.add("is-offline");
  clearTimeout(showTimer);
  showTimer = setTimeout(() => socket.connected || showBanner("offline"), 1000);
});
socket.on("connect", () => {
  document.body.classList.remove("is-offline");
  clearTimeout(showTimer);
  if (banner.classList.contains("is-visible") && banner.dataset.state === "offline") {
    showBanner("online");
    hideBanner(1800);
  }
  // Tras una reconexión, se recarga el estado para no perder nada
  if (wasConnected) document.dispatchEvent(new CustomEvent("socket:reconnected"));
  wasConnected = true;
});
