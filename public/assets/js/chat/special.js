// Mensajes especiales: encuestas, ubicación y fotos/videos de "ver una vez". Exportar el chat.
import { $, $$, icon, escapeHTML, toast, toastError } from "./utils.js";
import { state, getConv, activeConv, isGroup, userName } from "./state.js";
import { api } from "./api.js";
import { openModal, closeModal, onModalOpen, registerAction } from "./ui.js";
import { onIncomingMessage, onMessageUpdate, sendAttachment, findMessage } from "./conversation.js";

const POLL_MIN = 2;
const POLL_MAX = 12;

// ==========================================================================
// Encuestas
// ==========================================================================
const myVotes = (msg) => (msg.votes || []).filter((v) => v.userId === state.me.id).map((v) => v.option);

export function pollHTML(msg) {
  const m = msg.meta || {};
  const votes = msg.votes || [];
  const voters = new Set(votes.map((v) => v.userId)).size;
  const mine = myVotes(msg);
  const closed = Boolean(m.closedAt);
  const isMine = msg.senderId === state.me.id;
  const options = (m.options || [])
    .map((option, i) => {
      const who = votes.filter((v) => v.option === i).map((v) => v.userId);
      const pct = voters ? Math.round((who.length / voters) * 100) : 0;
      const names = who.map((id) => (id === state.me.id ? "Tú" : userName(id, { short: true }))).join(", ");
      return `
        <button type="button" class="poll-option ${mine.includes(i) ? "is-mine" : ""}" data-poll-option="${i}" ${closed ? "disabled" : ""}
          style="--pct:${pct}%" ${names ? `title="${escapeHTML(names)}"` : ""} aria-pressed="${mine.includes(i)}">
          <span class="poll-check ${m.multiple ? "is-multi" : ""}">${icon("check", "icon-sm")}</span>
          <span class="poll-label">${escapeHTML(option)}</span>
          <span class="poll-count">${who.length}</span>
        </button>`;
    })
    .join("");
  const total = voters ? `${voters} ${voters === 1 ? "persona votó" : "personas votaron"}` : "Nadie ha votado todavía";
  return {
    kind: "is-poll",
    html: `
      <div class="poll-card ${closed ? "is-closed" : ""}">
        <small class="poll-kind">${icon("bar-chart", "icon-sm")} Encuesta${m.multiple ? " · varias respuestas" : ""}</small>
        <strong class="poll-question">${escapeHTML(msg.body || "")}</strong>
        <div class="poll-options">${options}</div>
        <div class="poll-foot">
          <small>${closed ? `${icon("lock", "icon-sm")} Cerrada · ` : ""}${total}</small>
          ${isMine && !closed && !msg.pending ? `<button type="button" class="poll-close" data-poll-close>Cerrar</button>` : ""}
        </div>
      </div>`,
  };
}

async function vote(msg, option) {
  const current = myVotes(msg);
  const next = msg.meta.multiple
    ? current.includes(option) ? current.filter((o) => o !== option) : [...current, option]
    : current.includes(option) ? [] : [option];
  // Se ve al instante; si el servidor falla, se vuelve atrás
  const before = msg.votes;
  onMessageUpdate({ ...msg, votes: [...(msg.votes || []).filter((v) => v.userId !== state.me.id), ...next.map((o) => ({ userId: state.me.id, option: o }))] });
  try {
    const { message } = await api.vote(msg.id, next);
    onMessageUpdate(message);
  } catch (err) {
    onMessageUpdate({ ...msg, votes: before });
    toastError(err.message);
  }
}

function pollOptionRow(value = "") {
  return `
    <div class="poll-edit-option">
      <input class="input" maxlength="80" placeholder="Opción" value="${escapeHTML(value)}" data-poll-input>
      <button type="button" class="icon-btn" data-poll-remove aria-label="Quitar opción">${icon("x", "icon-sm")}</button>
    </div>`;
}

function syncPollForm() {
  const rows = $$("#pollOptions .poll-edit-option");
  // La ✕ no sale si quedarían menos de dos opciones ni en el hueco vacío del final
  rows.forEach((row, i) => ($("[data-poll-remove]", row).hidden = rows.length <= POLL_MIN || (i === rows.length - 1 && !$("[data-poll-input]", row).value.trim())));
  $("#pollAddOption").hidden = rows.length >= POLL_MAX;
  // Siempre queda un hueco libre al final para la siguiente opción
  const inputs = $$("[data-poll-input]");
  if (inputs.length < POLL_MAX && inputs.at(-1)?.value.trim()) {
    $("#pollOptions").insertAdjacentHTML("beforeend", pollOptionRow());
    syncPollForm();
  }
}

async function submitPoll(e) {
  e.preventDefault();
  const conv = activeConv();
  if (!conv) return;
  const question = $("#pollQuestion").value.trim();
  const options = $$("[data-poll-input]").map((i) => i.value.trim()).filter(Boolean);
  if (!question) return toastError("Escribe la pregunta.");
  if (new Set(options.map((o) => o.toLowerCase())).size < POLL_MIN) return toastError("Escribe al menos dos opciones distintas.");
  const btn = $("#pollForm [type=submit]");
  btn.disabled = true;
  try {
    const { message } = await api.createPoll(conv.id, { question, options, multiple: $("#pollMultiple").checked });
    closeModal("modal-poll");
    onIncomingMessage(message);
  } catch (err) {
    toastError(err.message);
  } finally {
    btn.disabled = false;
  }
}

// ==========================================================================
// Ubicación (mapa de OpenStreetMap con 4 teselas, sin servicios de pago)
// ==========================================================================
const ZOOM = 16;
const TILE = 256;

/** Teselas 2x2 alrededor del punto, colocadas para que el punto quede en el centro de la tarjeta. */
function mapTiles(lat, lng, width = 256, height = 150) {
  const n = 2 ** ZOOM;
  const rad = (lat * Math.PI) / 180;
  const fx = ((lng + 180) / 360) * n;
  const fy = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  const x0 = Math.floor(fx) - (fx % 1 < 0.5 ? 1 : 0);
  const y0 = Math.floor(fy) - (fy % 1 < 0.5 ? 1 : 0);
  const left = width / 2 - (fx - x0) * TILE;
  const top = height / 2 - (fy - y0) * TILE;
  const tiles = [];
  for (let dy = 0; dy < 2; dy++) {
    for (let dx = 0; dx < 2; dx++) {
      tiles.push(`<img src="https://tile.openstreetmap.org/${ZOOM}/${(x0 + dx + n) % n}/${y0 + dy}.png" alt="" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" style="left:${Math.round(left + dx * TILE)}px;top:${Math.round(top + dy * TILE)}px">`);
    }
  }
  return tiles.join("");
}

const osmLink = ({ lat, lng }) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
const directionsLink = ({ lat, lng }) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

function mapHTML(point) {
  return `
    <div class="map-tiles" aria-hidden="true">${mapTiles(point.lat, point.lng)}</div>
    <span class="map-pin">${icon("map-pin")}</span>
    <span class="map-credit">© OpenStreetMap</span>`;
}

export function locationHTML(msg) {
  const m = msg.meta || {};
  return {
    kind: "is-location",
    html: `
      <div class="location-card">
        <a class="location-map" href="${osmLink(m)}" target="_blank" rel="noopener" aria-label="Abrir en el mapa">${mapHTML(m)}</a>
        <div class="location-info">
          <strong>${escapeHTML(msg.body || "Ubicación")}</strong>
          ${m.accuracy ? `<small>Precisión: ±${m.accuracy < 1000 ? `${m.accuracy} m` : `${(m.accuracy / 1000).toFixed(1)} km`}</small>` : ""}
        </div>
        <div class="location-actions">
          <a href="${osmLink(m)}" target="_blank" rel="noopener">${icon("map", "icon-sm")}Ver mapa</a>
          <a href="${directionsLink(m)}" target="_blank" rel="noopener">${icon("arrow-up-right", "icon-sm")}Cómo llegar</a>
        </div>
      </div>`,
  };
}

let position = null;

function locate() {
  position = null;
  $("#locationSend").disabled = true;
  $("#locationLabel").value = "";
  $("#locationPreview").innerHTML = `<span class="location-status">${icon("locate")}Buscando tu ubicación…</span>`;
  if (!navigator.geolocation) {
    $("#locationPreview").innerHTML = `<span class="location-status">${icon("alert")}Tu navegador no permite compartir la ubicación.</span>`;
    return;
  }
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      position = { lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy };
      $("#locationPreview").innerHTML = `<div class="location-map">${mapHTML(position)}</div>`;
      $("#locationAccuracy").textContent = `Precisión: ±${Math.round(coords.accuracy)} m`;
      $("#locationSend").disabled = false;
    },
    (err) => {
      const text = err.code === err.PERMISSION_DENIED
        ? "Necesitamos permiso para ver tu ubicación. Actívalo en el candado de la barra de direcciones."
        : "No se pudo obtener tu ubicación. Inténtalo de nuevo.";
      $("#locationPreview").innerHTML = `<span class="location-status">${icon("alert")}${text}</span>`;
      $("#locationAccuracy").textContent = "";
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
  );
}

async function sendLocation() {
  const conv = activeConv();
  if (!conv || !position) return;
  $("#locationSend").disabled = true;
  try {
    const { message } = await api.sendLocation(conv.id, { ...position, label: $("#locationLabel").value.trim() || undefined });
    closeModal("modal-location");
    onIncomingMessage(message);
  } catch (err) {
    toastError(err.message);
    $("#locationSend").disabled = false;
  }
}

// ==========================================================================
// Ver una vez
// ==========================================================================
export function viewOnceHTML(msg) {
  const video = msg.type === "video";
  const what = video ? "Video" : "Foto";
  const conv = getConv(msg.conversationId);
  const opened = msg.openedBy || [];
  const mine = msg.senderId === state.me.id;
  let status;
  if (msg.pending) status = "Enviando…";
  else if (mine) {
    const others = (conv?.members?.length || 2) - 1;
    status = !opened.length ? "Sin abrir" : isGroup(conv) && opened.length < others ? `Abierta por ${opened.length}` : video ? "Abierto" : "Abierta";
  } else status = opened.includes(state.me.id) ? (video ? "Abierto" : "Abierta") : null;

  return {
    kind: "is-once",
    html: status
      ? `<div class="once-card is-done">${icon("view-once")}<span><strong>${what}</strong><small>${status}</small></span></div>`
      : `<button type="button" class="once-card" data-view-once>${icon("view-once")}<span><strong>${what}</strong><small>Toca para ver · solo una vez</small></span></button>`,
  };
}

async function openViewOnce(msg) {
  let data;
  try {
    data = await api.openViewOnce(msg.id);
  } catch (err) {
    toastError(err.message);
    // Ya no se puede abrir (la abrió en otro dispositivo o caducó): se marca como abierta
    if (err.status === 410) onMessageUpdate({ ...msg, openedBy: [...new Set([...(msg.openedBy || []), state.me.id])] });
    return;
  }
  onMessageUpdate({ ...msg, openedBy: [...new Set([...(msg.openedBy || []), state.me.id])] });

  const viewer = document.createElement("div");
  viewer.className = "once-viewer";
  viewer.setAttribute("role", "dialog");
  viewer.setAttribute("aria-label", "Ver una vez");
  viewer.innerHTML = `
    <div class="once-bar">
      <span>${icon("view-once")} ${data.type === "video" ? "Video" : "Foto"} de ver una vez · se cerrará para siempre</span>
      <button type="button" class="icon-btn" data-once-close aria-label="Cerrar">${icon("x")}</button>
    </div>
    ${data.type === "video"
      ? `<video src="${data.mediaUrl}" autoplay playsinline controls controlslist="nodownload noplaybackrate" disablepictureinpicture></video>`
      : `<img src="${data.mediaUrl}" alt="" draggable="false">`}`;
  const close = () => {
    viewer.classList.add("is-closing");
    document.removeEventListener("keydown", onKey, true);
    setTimeout(() => viewer.remove(), 200);
  };
  const onKey = (e) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    close();
  };
  viewer.addEventListener("click", (e) => e.target.closest("[data-once-close]") && close());
  viewer.addEventListener("contextmenu", (e) => e.preventDefault());
  document.addEventListener("keydown", onKey, true);
  document.body.append(viewer);
}

function pickViewOnce() {
  const picker = Object.assign(document.createElement("input"), { type: "file", accept: "image/*,video/*" });
  picker.addEventListener("change", () => {
    const file = picker.files[0];
    if (!file) return;
    sendAttachment(file, "", file.type.startsWith("video/") ? "video" : "image", { viewOnce: true });
    toast("Se enviará como de ver una vez: solo se podrá abrir una vez.", { icon: "view-once" });
  });
  picker.click();
}

// ==========================================================================
// Exportar el chat
// ==========================================================================
function exportChat() {
  const conv = activeConv();
  if (!conv) return;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Costa_Rica";
  // Descarga directa (el servidor responde con Content-Disposition: attachment)
  const a = Object.assign(document.createElement("a"), { href: `/api/conversations/${conv.id}/export?tz=${encodeURIComponent(tz)}` });
  document.body.append(a);
  a.click();
  a.remove();
  toast("Descargando el chat…", { icon: "download" });
}

// ==========================================================================
// Inicio
// ==========================================================================
export function initSpecial() {
  // Clics dentro de los mensajes
  $("#messages").addEventListener("click", (e) => {
    const bubble = e.target.closest(".msg");
    const msg = bubble && findMessage(bubble.dataset.id);
    if (!msg || msg.pending) return;
    const option = e.target.closest("[data-poll-option]");
    if (option) return vote(msg, Number(option.dataset.pollOption));
    if (e.target.closest("[data-poll-close]")) {
      return api.closePoll(msg.id).then(({ message }) => onMessageUpdate(message)).catch((err) => toastError(err.message));
    }
    if (e.target.closest("[data-view-once]")) return openViewOnce(msg);
  });

  // Crear encuesta
  onModalOpen("modal-poll", () => {
    $("#pollForm").reset();
    $("#pollOptions").innerHTML = pollOptionRow() + pollOptionRow();
    syncPollForm();
    setTimeout(() => $("#pollQuestion").focus(), 50);
  });
  $("#pollOptions").addEventListener("input", syncPollForm);
  $("#pollOptions").addEventListener("click", (e) => {
    const remove = e.target.closest("[data-poll-remove]");
    if (!remove) return;
    remove.closest(".poll-edit-option").remove();
    syncPollForm();
  });
  $("#pollAddOption").addEventListener("click", () => {
    $("#pollOptions").insertAdjacentHTML("beforeend", pollOptionRow());
    syncPollForm();
    $$("[data-poll-input]").at(-1)?.focus();
  });
  $("#pollForm").addEventListener("submit", submitPoll);

  // Ubicación
  onModalOpen("modal-location", locate);
  $("#locationSend").addEventListener("click", sendLocation);
  $("#locationRetry").addEventListener("click", locate);

  registerAction("export-chat", exportChat);
}

export const attachActions = {
  poll: () => openModal("modal-poll"),
  location: () => openModal("modal-location"),
  "view-once": pickViewOnce,
};
