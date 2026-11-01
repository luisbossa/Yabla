// Conversación activa: mensajes, barra de escritura, notas de voz, respuestas, reacciones y lectura.
import { $, $$, icon, escapeHTML, linkify, toast, timeLabel, CLOCK, dayLabel, lastSeenLabel, duration, fileSize, isMobile, isWide, prefs, firstName, toastError, STATUSES, profileColor, isBirthdayToday } from "./utils.js";
import {
  state, emit, on, getConv, activeConv, isGroup, peerOf, convTitle, convAvatar, userName, messagesOf, receiptOf, isBlockedConv, upsertConversation,
  getDraft, setDraft,
} from "./state.js";
import { api } from "./api.js";
import { socket } from "./socket.js";
import { systemText, callText, paymentText, typingText, previewOf } from "./format.js";
import { registerAction, closePopovers, openLightbox, confirmDialog, openModal } from "./ui.js";
import { openAttachPreview } from "./attach.js";
import { initEmojiPicker } from "./emoji-picker.js";
import { linkSlot, hydrateLinks } from "./link-preview.js";
import { openForward, toggleStar } from "./message-extras.js";
import { openReactTray, isSelecting, toggleSelected, isSelected, exitSelect, enterSelect, askDelete, openMessageInfo, togglePinMessage, renderPinnedBar } from "./chat-actions.js";
import { renderMentions, mentionsMe } from "./mentions.js";
import { renderScheduledChip, openSchedule } from "./timed.js";
import { icebreakerHTML, sendThisOrThat, matchForConversation } from "./discover.js";
import { initStickers } from "./stickers.js";
import { playIncoming, playInChat, playSent } from "./sounds.js";
import { pushEnabled, showLocalNotification } from "./push.js";
import { openVideoRecorder } from "./video-recorder.js";
import { labelHTML } from "./dz-icons.js";
import { pollHTML, locationHTML, viewOnceHTML, attachActions } from "./special.js";

const app = $("#app");
const messagesEl = $("#messages");
const input = $("#messageInput");
const fileInput = $("#fileInput");

const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
const RECEIPT_ICON = { sending: "clock", sent: "check", delivered: "check-check", read: "check-check" };
const EDIT_WINDOW = 15 * 60 * 1000;
const WAVE = [6, 10, 16, 8, 20, 12, 24, 14, 9, 18, 26, 12, 7, 16, 22, 10, 14, 20, 8, 12, 18, 24, 10, 6, 14, 20, 9, 12];

const composeState = { mode: null, message: null }; // mode: reply | edit
let searchQuery = "";
let loadingOlder = false;
let newWhileScrolled = 0;
let atBottom = true; // ¿estaba abajo del todo? (para mantenerlo al crecer una vista previa)
// Separador "N mensajes sin leer": se calcula al abrir el chat
let unreadMarker = null; // { conversationId, messageId, count }
const FORWARDABLE = ["text", "image", "video", "file", "audio", "sticker"];
// Videos: hasta 1 minuto y 16 MB (el resto de archivos, 4 MB)
export const VIDEO_MAX_SECONDS = 60;
export const VIDEO_MAX_BYTES = 16 * 1024 * 1024;
const FILE_MAX_BYTES = 4 * 1024 * 1024;

// ==========================================================================
// Render de mensajes
// ==========================================================================
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

function highlight(html) {
  if (!searchQuery) return html;
  const q = escapeHTML(searchQuery).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html.replace(new RegExp(`(${q})(?![^<]*>)`, "gi"), "<mark>$1</mark>");
}

function replyQuote(msg) {
  const r = msg.replyTo;
  if (!r) return "";
  const labels = { image: "Foto", video: "Video", audio: "Nota de voz", file: "Documento", sticker: "Sticker", poll: "Encuesta", location: "Ubicación" };
  const icons = { image: "image", video: "video", audio: "mic", file: "file", sticker: "sticker", poll: "bar-chart", location: "map-pin" };
  const text = r.deleted ? "Mensaje eliminado" : r.viewOnce ? `${labels[r.type]} de ver una vez` : r.body || labels[r.type] || "";
  const kindIcon = !r.deleted && (r.viewOnce || icons[r.type]) ? icon(r.viewOnce ? "view-once" : icons[r.type], "icon-sm") : "";
  return `
    <button class="quote" data-jump="${r.id}">
      ${r.mediaUrl ? `<img src="${r.mediaUrl}" alt="">` : ""}
      <span><strong>${escapeHTML(userName(r.senderId))}</strong><span>${kindIcon}${escapeHTML(text)}</span></span>
    </button>`;
}

function reactionsHTML(msg) {
  if (!msg.reactions?.length) return "";
  return `<div class="reactions">${msg.reactions
    .map((r) => `<button class="reaction ${r.userIds.includes(state.me.id) ? "is-mine" : ""}" data-react="${r.emoji}" title="${escapeHTML(r.userIds.map((id) => userName(id)).join(", "))}">${r.emoji}${r.userIds.length > 1 ? ` <b>${r.userIds.length}</b>` : ""}</button>`)
    .join("")}</div>`;
}

function bodyHTML(msg) {
  const conv = getConv(msg.conversationId);
  const text = msg.body ? `<p class="bubble-text">${highlight(renderMentions(conv, linkify(msg.body)))}</p>` : "";
  if (msg.meta?.viewOnce && (msg.type === "image" || msg.type === "video")) return viewOnceHTML(msg);
  switch (msg.type) {
    case "poll":
      return pollHTML(msg);
    case "location":
      return locationHTML(msg);
    case "image":
      return { kind: "is-media", html: `<img src="${msg.mediaUrl}" alt="${escapeHTML(msg.body || "Imagen")}" data-lightbox loading="lazy">${text}` };
    case "video": {
      // Miniatura = primer fotograma (#t=0.1 lo fuerza también en iPhone), botón de play y duración
      const m = msg.meta || {};
      const ratio = m.width && m.height ? Math.max(0.6, Math.min(m.width / m.height, 1.78)) : 0.75;
      const src = msg.pending ? msg.mediaUrl : `${msg.mediaUrl}#t=0.1`;
      return {
        kind: "is-media is-video",
        html: `
          <button type="button" class="video-thumb" data-video="${msg.mediaUrl}" style="--ratio:${ratio.toFixed(3)}" aria-label="Reproducir video">
            <video src="${src}" preload="metadata" muted playsinline disablepictureinpicture></video>
            ${msg.pending ? `<span class="video-uploading"><span class="spinner"></span>Enviando…</span>` : `<span class="video-play">${icon("play")}</span>`}
            <span class="video-dur">${icon("video", "icon-sm")}${duration(m.duration)}</span>
          </button>${text}`,
      };
    }
    case "sticker":
      return { kind: "is-sticker", html: `<img src="${msg.mediaUrl}" alt="Sticker" loading="lazy">` };
    case "audio":
      return {
        kind: "",
        html: `
          <div class="audio" data-src="${msg.mediaUrl}">
            <button class="audio-play" aria-label="Reproducir">${icon("play")}</button>
            <div class="audio-wave">${WAVE.map((h) => `<i style="height:${h}px"></i>`).join("")}</div>
            <time data-duration="${duration(msg.meta?.duration)}">${duration(msg.meta?.duration)}</time>
          </div>`,
      };
    case "file":
      return {
        kind: "",
        html: `
          <a class="file-chip" href="${msg.mediaUrl}" download="${escapeHTML(msg.meta?.name || "archivo")}" target="_blank" rel="noopener">
            <span>${icon("file")}</span>
            <div><strong>${escapeHTML(msg.meta?.name || "Documento")}</strong><small>${fileSize(msg.meta?.size)} · Descargar</small></div>
          </a>${text}`,
      };
    case "payment":
      return {
        kind: "is-payment",
        html: `
          <div class="payment-card">
            <span class="payment-icon">${icon("wallet")}</span>
            <div><strong>${escapeHTML(paymentText(msg))}</strong>${msg.body ? `<small>${escapeHTML(msg.body)}</small>` : ""}</div>
          </div>`,
      };
    case "call": {
      const missed = !["completed"].includes(msg.meta?.status);
      const mine = msg.senderId === state.me.id;
      return {
        kind: "is-call",
        html: `
          <button class="call-card ${missed ? "is-missed" : ""}" data-call="${msg.meta?.callType || "audio"}">
            <span class="call-card-icon">${icon(msg.meta?.callType === "video" ? "video" : "phone")}</span>
            <span><strong>${escapeHTML(callText(msg))}</strong><small>${icon(mine ? "arrow-up-right" : "arrow-down-left", "icon-sm")} Toca para volver a llamar</small></span>
          </button>`,
      };
    }
    case "game": {
      // «Esto o aquello»: cada uno toca su opción; se ve la del otro al responder ambos
      const mine = msg.meta?.answers?.[state.me.id];
      const both = Object.keys(msg.meta?.answers || {}).length >= 2;
      return {
        kind: "is-game",
        html: `
          <div class="game-card">
            <small>${icon("dice", "icon-sm")} Esto o aquello</small>
            <div class="game-options">${(msg.meta?.options || [])
              .map((o) => {
                const picked = Object.values(msg.meta?.answers || {}).filter((a) => a === o).length;
                return `<button data-game-choice="${escapeHTML(o)}" class="${mine === o ? "is-mine" : ""}" ${mine ? "disabled" : ""}>${labelHTML(o)}${both ? `<b>${picked}</b>` : ""}</button>`;
              })
              .join("")}</div>
            <small class="game-state">${both ? "¡Ya respondieron los dos!" : mine ? "Esperando la otra respuesta…" : "Toca tu favorita"}</small>
          </div>`,
      };
    }
    case "date": {
      const m = msg.meta || {};
      const whenText = new Date(m.when).toLocaleString("es-CR", { weekday: "long", day: "numeric", month: "long", ...CLOCK });
      const mine = msg.senderId === state.me.id;
      const status = { pending: mine ? "Esperando respuesta…" : "", accepted: `${icon("check-circle", "icon-sm")}¡Cita confirmada!`, declined: `${icon("x", "icon-sm")}Esta vez no` }[m.status] || "";
      return {
        kind: "is-date",
        html: `
          <div class="date-card is-${m.status}">
            <span class="date-ico">${icon(m.kind === "place" ? "map-pin" : "video")}</span>
            <div>
              <small>Propuesta de cita</small>
              <strong>${m.kind === "place" ? escapeHTML(m.place) : "Videollamada"}</strong>
              <span>${escapeHTML(whenText)}</span>
              ${status ? `<em>${status}</em>` : ""}
              ${!mine && m.status === "pending" ? `<div class="date-actions"><button data-date-answer="1">Aceptar</button><button data-date-answer="0">Ahora no</button></div>` : ""}
              ${m.status === "accepted" ? `<button class="date-remind" data-date-remind="${m.when}">${icon("calendar-clock", "icon-sm")}Programar recordatorio</button>` : ""}
            </div>
          </div>`,
      };
    }
    default:
      return { kind: "", html: text };
  }
}

function messageHTML(conv, msg, prev) {
  let html = "";
  if (!prev || !sameDay(prev.createdAt, msg.createdAt)) html += `<div class="date-chip">${dayLabel(msg.createdAt)}</div>`;
  if (unreadMarker?.conversationId === conv.id && unreadMarker.messageId === msg.id) {
    const n = unreadMarker.count;
    html += `<div class="unread-divider" id="unreadDivider"><span>${n} mensaje${n === 1 ? "" : "s"} sin leer</span></div>`;
  }

  if (msg.type === "system") return `${html}<div class="system-msg" data-id="${msg.id}">${escapeHTML(systemText(msg))}</div>`;

  const me = msg.senderId === state.me.id;
  const grouped = prev && !prev.deletedAt && prev.type !== "system" && prev.senderId === msg.senderId && sameDay(prev.createdAt, msg.createdAt) && msg.createdAt - prev.createdAt < 5 * 60 * 1000;
  const showAuthor = !me && isGroup(conv);
  const author = showAuthor ? state.users.get(msg.senderId) : null;
  const matches = !searchQuery || (msg.body || "").toLowerCase().includes(searchQuery.toLowerCase());

  let content;
  if (msg.deletedAt) {
    content = { kind: "is-deleted", html: `<p class="bubble-text">${icon("ban", "icon-sm")} ${me ? "Eliminaste este mensaje" : "Se eliminó este mensaje"}</p>` };
  } else {
    content = bodyHTML(msg);
  }

  const story = msg.meta?.story && !msg.deletedAt
    ? `<div class="story-quote"><img src="${msg.meta.story.mediaUrl}" alt=""><span>${msg.meta.story.userId === state.me.id ? "Respondió a tu estado" : "Respuesta a un estado"}</span></div>`
    : "";
  const receipt = me && !msg.deletedAt && msg.type !== "call" ? receiptOf(conv, msg) : null;
  const starred = !msg.deletedAt && state.starred.has(msg.id);
  const forwarded = msg.meta?.forwarded && !msg.deletedAt ? `<span class="fwd-label">${icon("forward", "icon-sm")}Reenviado</span>` : "";
  const classes = ["msg", me && "me", grouped && "same", !matches && "is-dim", msg.pending && "is-pending", isSelected(msg.id) && "is-selected", !me && mentionsMe(msg) && "is-mention"]
    .filter(Boolean)
    .join(" ");
  // Acciones rápidas al pasar el ratón (reaccionar y responder), como WhatsApp Web
  const quick = !msg.deletedAt && !msg.pending
    ? `<div class="msg-actions">
        <button data-quick-react aria-label="Reaccionar" title="Reaccionar">${icon("smile-plus", "icon-sm")}</button>
        <button data-quick-reply aria-label="Responder" title="Responder">${icon("reply", "icon-sm")}</button>
      </div>`
    : "";

  return `${html}
    <div class="${classes}" data-id="${msg.id}">
      ${showAuthor ? `<span class="avatar"><img src="${author?.avatar || "/assets/images/ui/avatar-default.svg"}" alt=""></span>` : ""}
      <div class="bubble ${content.kind}">
        ${showAuthor && !grouped && msg.type !== "sticker" ? `<span class="bubble-author" style="--author:${profileColor(author?.color)[1]}">${escapeHTML(author?.name || "")}</span>` : ""}
        ${forwarded}
        ${msg.deletedAt ? "" : story + replyQuote(msg)}
        ${content.html}
        ${linkSlot(msg)}
        <span class="bubble-meta">
          ${starred ? icon("star-fill", "icon-star") : ""}${msg.editedAt && !msg.deletedAt ? "<em>editado</em>" : ""}${timeLabel(msg.createdAt)}
          ${receipt ? `<span class="tick tick-${receipt}">${icon(RECEIPT_ICON[receipt])}</span>` : ""}
        </span>
        ${!msg.deletedAt && !msg.pending ? `<button class="msg-more" data-msg-menu aria-label="Opciones del mensaje">${icon("chevron-down", "icon-sm")}</button>` : ""}
        ${quick}
      </div>
      ${msg.deletedAt ? "" : reactionsHTML(msg)}
    </div>`;
}

function renderMessages(conv, { keepScroll = false } = {}) {
  stopAudio();
  const { items, hasMore } = messagesOf(conv.id);
  const prevHeight = messagesEl.scrollHeight;
  const prevTop = messagesEl.scrollTop;

  let top = hasMore ? `<div class="load-more" id="loadMore"><span class="spinner"></span></div>` : `<div class="chat-intro">${icon("lock", "icon-sm")} Los mensajes de este chat son privados entre los participantes.</div>`;
  if (conv.origin === "match" && !hasMore && items.filter((m) => m.type !== "system").length < 3) top += icebreakerHTML(conv);
  messagesEl.innerHTML = top + (items.length ? items.map((m, i) => messageHTML(conv, m, items[i - 1])).join("") : `<div class="date-chip chat-placeholder">${icon("hand", "icon-sm")} Aún no hay mensajes. ¡Saluda!</div>`);
  renderTyping(conv);
  hydrateLinks(messagesEl, keepBottom);

  const divider = !keepScroll && $("#unreadDivider", messagesEl);
  if (keepScroll) messagesEl.scrollTop = messagesEl.scrollHeight - prevHeight + prevTop;
  else if (divider) {
    // Abre en el primer mensaje sin leer (como WhatsApp), no al final
    messagesEl.style.scrollBehavior = "auto";
    messagesEl.scrollTop += divider.getBoundingClientRect().top - messagesEl.getBoundingClientRect().top - 16;
    atBottom = nearBottom();
    updateScrollButton();
  } else scrollToBottom(false);
}

/** Si una vista previa hace crecer el chat estando abajo, se sigue abajo. */
function keepBottom() {
  if (atBottom) {
    messagesEl.style.scrollBehavior = "auto";
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

const nearBottom = () => messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 160;

function scrollToBottom(smooth = true) {
  messagesEl.style.scrollBehavior = smooth ? "smooth" : "auto";
  messagesEl.scrollTop = messagesEl.scrollHeight;
  newWhileScrolled = 0;
  atBottom = true;
  updateScrollButton();
}

function updateScrollButton() {
  const btn = $("#scrollDown");
  btn.hidden = nearBottom();
  const badge = $(".badge", btn);
  badge.hidden = !newWhileScrolled;
  badge.textContent = newWhileScrolled;
}

function appendMessage(conv, msg) {
  const { items } = messagesOf(conv.id);
  const prev = items[items.length - 2];
  const stick = nearBottom() || msg.senderId === state.me.id;
  $$(".typing-msg, .chat-placeholder", messagesEl).forEach((el) => el.remove());
  messagesEl.insertAdjacentHTML("beforeend", messageHTML(conv, msg, prev));
  messagesEl.lastElementChild.classList.add("is-new");
  hydrateLinks(messagesEl, keepBottom);
  renderTyping(conv);
  if (stick) scrollToBottom();
  else {
    newWhileScrolled += 1;
    updateScrollButton();
  }
}

/** Vuelve a pintar un mensaje concreto (edición, reacciones, borrado, confirmación). */
function rerenderMessage(conv, msg, oldId = msg.id) {
  const el = messagesEl.querySelector(`[data-id="${oldId}"]`);
  if (!el) return;
  const { items } = messagesOf(conv.id);
  const index = items.findIndex((m) => m.id === msg.id);
  const tmp = document.createElement("div");
  tmp.innerHTML = messageHTML(conv, msg, items[index - 1]);
  const fresh = tmp.querySelector(`[data-id="${msg.id}"]`);
  el.replaceWith(fresh);
  hydrateLinks(fresh, keepBottom);
}

/** Vuelve a pintar un mensaje por id si está en el chat abierto (p. ej. al destacarlo). */
export function refreshMessage(id) {
  const conv = activeConv();
  const msg = conv && messagesOf(conv.id).items.find((m) => m.id === id);
  if (msg) rerenderMessage(conv, msg);
}

function updateTicks(conv) {
  if (conv.id !== state.activeId) return;
  messagesOf(conv.id).items.forEach((msg) => {
    if (msg.senderId !== state.me.id || msg.deletedAt || msg.type === "call") return;
    const tick = messagesEl.querySelector(`[data-id="${msg.id}"] .tick`);
    if (!tick) return;
    const receipt = receiptOf(conv, msg);
    tick.className = `tick tick-${receipt}`;
    tick.innerHTML = icon(RECEIPT_ICON[receipt]);
  });
}

function renderTyping(conv) {
  $(".typing-msg", messagesEl)?.remove();
  if (!typingText(conv)) return;
  const stick = nearBottom();
  messagesEl.insertAdjacentHTML("beforeend", `<div class="msg typing-msg"><div class="bubble typing"><span></span><span></span><span></span></div></div>`);
  if (stick) scrollToBottom();
}

// ==========================================================================
// Cabecera y estado del chat
// ==========================================================================
export function renderHeader(conv = activeConv()) {
  if (!conv) return;
  const peer = peerOf(conv);
  $("#peerAvatar").className = `avatar ${peer?.online ? "is-online" : ""}`;
  $("#peerAvatar").dataset.status = peer?.status || "available";
  $("#peerAvatar img").src = convAvatar(conv);
  $("#peerName").innerHTML = escapeHTML(convTitle(conv)) + (peer?.official ? icon("verified", "badge-verified") : "");
  $("#peerTimer").hidden = !conv.disappearAfter;
  if (conv.origin === "match") $("#peerName").insertAdjacentHTML("beforeend", icon("heart-fill", "dz-heart"));
  $("#chat").classList.toggle("is-match", conv.origin === "match" && Boolean(matchForConversation(conv.id)));

  const typing = typingText(conv);
  const status = $("#peerStatus");
  if (typing) {
    status.textContent = typing;
    status.className = "is-typing";
  } else if (isGroup(conv)) {
    status.textContent = conv.members.map((m) => (m.id === state.me.id ? "Tú" : firstName(m.name))).join(", ");
    status.className = "";
  } else if (peer?.official) {
    status.textContent = "Cuenta oficial";
    status.className = "";
  } else if (isBlockedConv(conv)) {
    status.textContent = "Bloqueado";
    status.className = "";
  } else {
    // "en línea · Ocupado", "No molestar" o la última conexión; y si es su cumpleaños, se avisa
    const away = peer?.status && peer.status !== "available" ? STATUSES[peer.status]?.label : "";
    let text = peer?.online ? (away ? `en línea · ${away}` : "en línea") : lastSeenLabel(peer) || (away ? away : "toca para ver la info");
    if (isBirthdayToday(peer?.birthday)) text += " · 🎂 hoy cumple años";
    status.textContent = text;
    status.className = peer?.online ? (away ? `is-online is-${peer.status}` : "is-online") : "";
  }

  $$('.chat-head [data-call]').forEach((b) => (b.hidden = isGroup(conv) || Boolean(peer?.official)));
  const blocked = isBlockedConv(conv);
  $("#composer").classList.toggle("is-blocked", blocked);
  $("#blockedNote").hidden = !blocked;
}

/** Marca como leído lo visible (solo si la pestaña está a la vista). */
export function markRead(conv = activeConv()) {
  if (!conv || conv.id !== state.activeId || document.visibilityState !== "visible") return;
  const last = [...messagesOf(conv.id).items].reverse().find((m) => !m.pending);
  const me = conv.members.find((m) => m.id === state.me.id);
  if (!last || (me && me.lastReadId >= last.id && !conv.unread)) return;
  if (me) me.lastReadId = Math.max(me.lastReadId, last.id);
  conv.unread = 0;
  conv.mentions = 0;
  socket.emit("conversation:read", { conversationId: conv.id, messageId: last.id });
  emit("conversations");
}

async function loadMessages(conv) {
  const store = messagesOf(conv.id);
  if (store.loaded) return;
  const { messages, hasMore } = await api.messages(conv.id);
  store.items = messages;
  store.hasMore = hasMore;
  store.loaded = true;
  messages.forEach((m) => m.senderId && !state.users.has(m.senderId) && state.users.set(m.senderId, { id: m.senderId, name: "Antiguo participante" }));
}

async function loadOlder() {
  const conv = activeConv();
  const store = conv && messagesOf(conv.id);
  if (!store || !store.hasMore || loadingOlder || !store.items.length) return;
  loadingOlder = true;
  try {
    const { messages, hasMore } = await api.messages(conv.id, store.items[0].id);
    store.items = [...messages, ...store.items];
    store.hasMore = hasMore;
    if (conv.id === state.activeId) renderMessages(conv, { keepScroll: true });
  } finally {
    loadingOlder = false;
  }
}

export async function openChat(id, { force = false } = {}) {
  const conv = getConv(id);
  if (!conv) return;
  if (!force && state.activeId === conv.id && app.classList.contains("chat-open")) return;

  saveDraft();
  state.activeId = conv.id;
  unreadMarker = null;
  const meMember = conv.members.find((m) => m.id === state.me.id);
  const unreadFromId = conv.unread > 0 && meMember ? meMember.lastReadId : null;
  app.classList.add("chat-open");
  cancelContext();
  closeChatSearch(false);
  closePopovers();
  exitSelect(false);
  renderHeader(conv);
  renderPinnedBar(conv);
  renderScheduledChip(conv);
  emit("active", conv);

  messagesEl.innerHTML = `<div class="load-more"><span class="spinner"></span></div>`;
  try {
    await loadMessages(conv);
  } catch (err) {
    toastError(err.message);
  }
  if (state.activeId !== conv.id) return; // cambió de chat mientras cargaba
  if (unreadFromId !== null) {
    const unread = messagesOf(conv.id).items.filter((m) => m.id > unreadFromId && m.senderId !== state.me.id && m.type !== "system");
    if (unread.length) unreadMarker = { conversationId: conv.id, messageId: unread[0].id, count: unread.length };
  }
  restoreDraft(conv);
  renderMessages(conv);
  markRead(conv);

  if (isMobile()) {
    if (!history.state?.chat) history.pushState({ chat: conv.id }, "");
  } else {
    input.focus();
  }
  const url = new URL(location.href);
  url.searchParams.set("c", conv.id);
  history.replaceState(history.state, "", url);
}

export function closeChat() {
  saveDraft();
  input.value = "";
  autosize();
  unreadMarker = null;
  app.classList.remove("chat-open", "has-info");
  closePopovers();
  stopAudio();
  state.activeId = null;
  emit("active", null);
}

// --- Borradores: lo escrito en cada chat se conserva al cambiar de chat o recargar ---
function saveDraft() {
  if (!state.activeId || composeState.mode === "edit") return;
  if (setDraft(state.activeId, input.value)) emit("drafts");
}

function restoreDraft(conv) {
  cancelContext();
  input.value = getDraft(conv.id);
  autosize();
}

// ==========================================================================
// Eventos en tiempo real
// ==========================================================================
export async function onIncomingMessage(msg) {
  let conv = getConv(msg.conversationId);
  if (!conv) {
    // Chat que habías eliminado (o nuevo): reaparece con este mensaje
    try {
      const { conversation } = await api.conversation(msg.conversationId);
      conv = upsertConversation(conversation);
      conv.unread = Math.max(conv.unread || 0, 0);
    } catch {
      return;
    }
    if (msg.senderId !== state.me.id) notify(conv, msg);
    emit("conversations");
    return;
  }
  const store = messagesOf(conv.id);
  const mine = msg.senderId === state.me.id;

  // ¿Reemplaza a un mensaje provisional mío?
  const pendingIndex = msg.clientId ? store.items.findIndex((m) => m.clientId === msg.clientId && m.pending) : -1;
  if (store.items.some((m) => m.id === msg.id)) return;

  if (pendingIndex >= 0) {
    const tempId = store.items[pendingIndex].id;
    store.items[pendingIndex] = msg;
    if (conv.id === state.activeId) rerenderMessage(conv, msg, tempId);
  } else if (store.loaded) {
    store.items.push(msg);
    if (conv.id === state.activeId) appendMessage(conv, msg);
  }

  conv.lastMessage = msg;
  if (!mine && msg.type !== "system") {
    socket.emit("message:delivered", { conversationId: conv.id, messageId: msg.id });
    const visible = conv.id === state.activeId && document.visibilityState === "visible";
    if (visible) {
      markRead(conv);
      if (!conv.muted) playInChat();
    }
    else {
      conv.unread = (conv.unread || 0) + 1;
      if (mentionsMe(msg)) conv.mentions = (conv.mentions || 0) + 1;
      notify(conv, msg);
    }
  }
  // Quien escribe deja de estar "escribiendo"
  clearTyping(conv.id, msg.senderId);
  emit("conversations");
  if (["image", "video", "file", "audio"].includes(msg.type)) emit("media", conv);
}

export function onMessageUpdate(msg) {
  const conv = getConv(msg.conversationId);
  if (!conv) return;
  const store = messagesOf(conv.id);
  const index = store.items.findIndex((m) => m.id === msg.id);
  if (index >= 0) {
    store.items[index] = msg;
    if (conv.id === state.activeId) rerenderMessage(conv, msg);
  }
  if (conv.lastMessage?.id === msg.id) {
    conv.lastMessage = msg;
    emit("conversations");
  }
}

export function onReceipt({ conversationId, userId, lastReadId, lastDeliveredId }) {
  const conv = getConv(conversationId);
  const member = conv?.members.find((m) => m.id === userId);
  if (!member) return;
  member.lastReadId = Math.max(member.lastReadId, lastReadId);
  member.lastDeliveredId = Math.max(member.lastDeliveredId, lastDeliveredId);
  // Leí en otro dispositivo
  if (userId === state.me.id && conv.lastMessage && lastReadId >= conv.lastMessage.id) conv.unread = 0;
  updateTicks(conv);
  emit("receipts");
}

function clearTyping(conversationId, userId) {
  const map = state.typing.get(conversationId);
  if (!map?.has(userId)) return;
  clearTimeout(map.get(userId));
  map.delete(userId);
  onTypingChanged(conversationId);
}

export function onTyping({ conversationId, userId, isTyping }) {
  if (!state.typing.has(conversationId)) state.typing.set(conversationId, new Map());
  const map = state.typing.get(conversationId);
  clearTimeout(map.get(userId));
  if (isTyping) map.set(userId, setTimeout(() => clearTyping(conversationId, userId), 6000));
  else map.delete(userId);
  onTypingChanged(conversationId);
}

function onTypingChanged(conversationId) {
  const conv = getConv(conversationId);
  if (!conv) return;
  if (conv.id === state.activeId) {
    renderHeader(conv);
    renderTyping(conv);
  }
  emit("typing");
}

// --- Aviso de mensajes nuevos ---
function notify(conv, msg) {
  // Silenciado, salvo que te mencionen (como en WhatsApp); "No molestar" silencia todo
  if (conv.muted && !mentionsMe(msg)) return;
  if (state.me.status === "dnd") return;
  if (document.visibilityState === "visible") {
    playIncoming();
    if (isMobile()) navigator.vibrate?.(40);
    toast(previewOf(conv, msg), { avatar: convAvatar(conv), title: convTitle(conv), duration: 3500 });
    return;
  }
  // En segundo plano: si este dispositivo tiene push, la notificación llega por ahí (sin duplicados)
  if (!pushEnabled()) showLocalNotification(convTitle(conv), { body: previewOf(conv, msg), icon: convAvatar(conv), tag: `conv-${conv.id}`, data: { conversationId: conv.id, url: `/chat?c=${conv.id}` } });
}

// ==========================================================================
// Envío
// ==========================================================================
async function send(data, preview) {
  const conv = activeConv();
  if (!conv || isBlockedConv(conv)) return;

  const clientId = `c${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
  const temp = {
    id: `tmp-${clientId}`,
    clientId,
    pending: true,
    conversationId: conv.id,
    senderId: state.me.id,
    type: "text",
    body: null,
    reactions: [],
    createdAt: Date.now(),
    ...preview,
  };
  const store = messagesOf(conv.id);
  store.items.push(temp);
  appendMessage(conv, temp);

  try {
    const { message } = await api.send(conv.id, { ...data, clientId });
    const index = store.items.findIndex((m) => m.id === temp.id);
    if (index >= 0) {
      store.items[index] = message;
      rerenderMessage(conv, message, temp.id);
    }
    conv.lastMessage = message;
    emit("conversations");
    playSent();
  } catch (err) {
    store.items = store.items.filter((m) => m.id !== temp.id);
    messagesEl.querySelector(`[data-id="${temp.id}"]`)?.remove();
    toastError(err.message);
  }
}

export function sendStoryReply(conversationId, story, text) {
  return api.send(conversationId, { text, storyId: story.id });
}

function submitText() {
  const text = input.value.trim();
  if (!text) return;

  if (composeState.mode === "edit") {
    const msg = composeState.message;
    cancelContext();
    if (text !== msg.body) {
      api.editMessage(msg.id, text).catch((err) => toastError(err.message));
    }
  } else {
    const replyToId = composeState.mode === "reply" ? composeState.message.id : undefined;
    const replyTo = replyToId ? { id: replyToId, senderId: composeState.message.senderId, type: composeState.message.type, body: composeState.message.body } : null;
    cancelContext();
    send({ text, replyToId }, { body: text, replyTo });
  }
  input.value = "";
  autosize();
  stopTyping();
  closePopovers();
  if (setDraft(activeConv().id, "")) emit("drafts");
  // Al responder ya no hace falta el separador de no leídos
  if (unreadMarker) {
    unreadMarker = null;
    $("#unreadDivider", messagesEl)?.remove();
  }
  input.focus();
}

/** Envía un archivo con su comentario (lo llama la vista previa de adjuntos). */
/** Duración y tamaño de un video (lo lee el propio navegador). */
export function videoInfo(file) {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    const url = URL.createObjectURL(file);
    const done = (info) => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(info);
    };
    const timer = setTimeout(() => done({ duration: 0, width: 0, height: 0 }), 5000);
    v.preload = "metadata";
    v.muted = true;
    v.onloadedmetadata = () => done({ duration: Number.isFinite(v.duration) ? v.duration : 0, width: v.videoWidth, height: v.videoHeight });
    v.onerror = () => done({ duration: 0, width: 0, height: 0 });
    v.src = url;
  });
}

/** Envía un video (grabado o de la galería): aparece al instante y se sube en segundo plano. */
export function sendVideo(file, { duration: seconds = 0, width = 0, height = 0, caption = "", viewOnce = false } = {}) {
  const meta = { duration: Math.round(seconds * 10) / 10, width, height, size: file.size, ...(viewOnce ? { viewOnce: true } : {}) };
  const replyToId = composeState.mode === "reply" ? composeState.message.id : undefined;
  cancelContext();
  return send(
    { file, kind: "video", text: caption || undefined, replyToId, duration: meta.duration, width, height, viewOnce: viewOnce ? 1 : undefined },
    { type: "video", mediaUrl: viewOnce ? null : URL.createObjectURL(file), body: caption || null, meta }
  );
}

/** `viewOnce`: foto o video que el destinatario solo puede abrir una vez. */
export async function sendAttachment(file, caption = "", kind = "image", { viewOnce = false } = {}) {
  if (!file) return;
  const isVideo = kind === "video" || (kind !== "file" && file.type.startsWith("video/"));
  if (isVideo) {
    if (file.size > VIDEO_MAX_BYTES) return toast(`El video supera el límite de ${VIDEO_MAX_BYTES / 1024 / 1024} MB.`, { tone: "error", icon: "video" });
    const info = await videoInfo(file);
    if (info.duration > VIDEO_MAX_SECONDS + 1) return toast("El video dura más de 1 minuto. Recórtalo o grábalo desde «Grabar video».", { tone: "error", icon: "video" });
    return sendVideo(file, { ...info, caption, viewOnce });
  }
  if (file.size > FILE_MAX_BYTES) {
    toast(`El archivo supera el límite de ${FILE_MAX_BYTES / 1024 / 1024} MB.`, { tone: "error", icon: "file" });
    return;
  }
  const isImage = file.type.startsWith("image/") && kind !== "file";
  const once = viewOnce && isImage;
  const preview = isImage
    ? { type: "image", mediaUrl: once ? null : URL.createObjectURL(file), body: caption || null, ...(once ? { meta: { viewOnce: true } } : {}) }
    : { type: "file", meta: { name: file.name, size: file.size }, body: caption || null };
  const replyToId = composeState.mode === "reply" ? composeState.message.id : undefined;
  cancelContext();
  return send({ file, text: caption || undefined, replyToId, kind: isImage ? undefined : "file", viewOnce: once ? 1 : undefined }, preview);
}

// --- Escribiendo… ---
let typingActive = false;
let typingTimer;
function startTyping() {
  const conv = activeConv();
  if (!conv) return;
  if (!typingActive) {
    typingActive = true;
    socket.emit("typing", { conversationId: conv.id, isTyping: true });
  }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(stopTyping, 3500);
}

function stopTyping() {
  clearTimeout(typingTimer);
  if (!typingActive) return;
  typingActive = false;
  if (state.activeId) socket.emit("typing", { conversationId: state.activeId, isTyping: false });
}

function autosize() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  const hasText = Boolean(input.value.trim());
  $("#sendBtn").hidden = !hasText && composeState.mode !== "edit";
  $("#micBtn").hidden = hasText || composeState.mode === "edit";
}

// ==========================================================================
// Responder / editar
// ==========================================================================
function setContext(mode, msg) {
  composeState.mode = mode;
  composeState.message = msg;
  const box = $("#composeContext");
  box.hidden = false;
  box.dataset.mode = mode;
  $(".compose-context-icon", box).innerHTML = icon(mode === "edit" ? "edit" : "reply");
  $("#composeContextTitle").textContent = mode === "edit" ? "Editando mensaje" : `Respondiendo a ${userName(msg.senderId)}`;
  $("#composeContextText").textContent = previewOf(activeConv(), { ...msg, senderId: -1 }).replace(/^.*?: /, "") || msg.body || "";
  if (mode === "edit") input.value = msg.body;
  autosize();
  input.focus();
}

function cancelContext() {
  if (composeState.mode === "edit") input.value = "";
  composeState.mode = null;
  composeState.message = null;
  $("#composeContext").hidden = true;
  autosize();
}

// ==========================================================================
// Menú de mensaje (reacciones, responder, copiar, editar, eliminar)
// ==========================================================================
const menu = $("#msgMenu");
let menuMessage = null;

function findMessage(id) {
  const conv = activeConv();
  return conv && messagesOf(conv.id).items.find((m) => String(m.id) === String(id));
}

function openMessageMenu(msgEl, x, y) {
  const msg = findMessage(msgEl.dataset.id);
  if (!msg || msg.pending || msg.deletedAt || msg.type === "system") return;
  menuMessage = msg;
  const mine = msg.senderId === state.me.id;
  const myReaction = msg.reactions?.find((r) => r.userIds.includes(state.me.id))?.emoji;

  $("#msgMenuReactions").innerHTML =
    REACTIONS.map((e) => `<button data-react-menu="${e}" class="${e === myReaction ? "is-mine" : ""}">${e}</button>`).join("") +
    (myReaction && !REACTIONS.includes(myReaction) ? `<button data-react-menu="${myReaction}" class="is-mine">${myReaction}</button>` : "") +
    `<button class="react-more" data-react-more data-popover="reactPicker" aria-label="Más reacciones">${icon("plus", "icon-sm")}</button>`;
  $('[data-msg-action="copy"]', menu).hidden = !msg.body;
  $('[data-msg-action="forward"]', menu).hidden = !FORWARDABLE.includes(msg.type) || Boolean(msg.meta?.viewOnce);
  const starred = state.starred.has(msg.id);
  $('[data-msg-action="star"] span', menu).textContent = starred ? "Quitar destacado" : "Destacar";
  $('[data-msg-action="star"] use', menu).setAttribute("href", `/assets/images/icons.svg#i-${starred ? "star-off" : "star"}`);
  $('[data-msg-action="edit"]', menu).hidden = !mine || msg.type !== "text" || Date.now() - msg.createdAt > EDIT_WINDOW;
  const conv = activeConv();
  const pinned = conv?.pinnedMessages?.some((p) => p.id === msg.id);
  $('[data-msg-action="pin"] span', menu).textContent = pinned ? "Desfijar" : "Fijar";
  $('[data-msg-action="pin"] use', menu).setAttribute("href", `/assets/images/icons.svg#i-${pinned ? "pin-off" : "pin"}`);
  $('[data-msg-action="info"]', menu).hidden = !mine || msg.type === "call";

  menu.hidden = false;
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, innerWidth - rect.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, innerHeight - rect.height - 8))}px`;
}

export function closeMessageMenu() {
  menu.hidden = true;
  menuMessage = null;
}

export async function react(msg, emoji) {
  try {
    await api.react(msg.id, emoji);
  } catch (err) {
    toastError(err.message);
  }
}

menu.addEventListener("click", async (e) => {
  const msg = menuMessage;
  if (!msg) return;
  const emoji = e.target.closest("[data-react-menu]")?.dataset.reactMenu;
  const action = e.target.closest("[data-msg-action]")?.dataset.msgAction;
  // "+": el selector completo se coloca junto al botón antes de cerrar el menú
  const more = e.target.closest("[data-react-more]");
  if (more) openReactTray(msg, more, { picker: true });
  closeMessageMenu();
  if (more) return;
  if (emoji) return react(msg, emoji);
  if (action === "reply") setContext("reply", msg);
  if (action === "forward") openForward(msg);
  if (action === "star") toggleStar(msg);
  if (action === "edit") setContext("edit", msg);
  if (action === "copy") {
    await navigator.clipboard?.writeText(msg.body || "");
    toast("Mensaje copiado", { tone: "success", icon: "copy" });
  }
  if (action === "pin") togglePinMessage(msg);
  if (action === "info") openMessageInfo(msg);
  if (action === "select") enterSelect(msg);
  if (action === "delete") askDelete([msg]);
});

// Clic derecho y pulsación larga
messagesEl.addEventListener("contextmenu", (e) => {
  const msgEl = e.target.closest(".msg[data-id]");
  if (!msgEl || e.target.closest("a")) return;
  e.preventDefault();
  openMessageMenu(msgEl, e.clientX, e.clientY);
});

let pressTimer;
messagesEl.addEventListener("touchstart", (e) => {
  const msgEl = e.target.closest(".msg[data-id]");
  if (!msgEl) return;
  const t = e.touches[0];
  pressTimer = setTimeout(() => {
    navigator.vibrate?.(15);
    openMessageMenu(msgEl, t.clientX, t.clientY);
  }, 450);
}, { passive: true });
["touchend", "touchmove", "touchcancel"].forEach((evt) => messagesEl.addEventListener(evt, () => clearTimeout(pressTimer), { passive: true }));

// Doble clic: reacción rápida ❤️
messagesEl.addEventListener("dblclick", (e) => {
  const msgEl = e.target.closest(".msg[data-id]");
  const msg = msgEl && findMessage(msgEl.dataset.id);
  if (msg && !msg.pending && !msg.deletedAt && msg.type !== "system" && !e.target.closest("button, a, img[data-lightbox]")) react(msg, "❤️");
});

messagesEl.addEventListener("click", (e) => {
  const t = e.target;
  // En modo selección, tocar un mensaje lo marca o desmarca
  if (isSelecting()) {
    const msgEl = t.closest(".msg[data-id]");
    if (msgEl && !msgEl.classList.contains("typing-msg")) {
      e.preventDefault();
      toggleSelected(msgEl.dataset.id);
    }
    return;
  }
  const quickReact = t.closest("[data-quick-react]");
  if (quickReact) {
    const msg = findMessage(quickReact.closest(".msg").dataset.id);
    return msg && openReactTray(msg, quickReact);
  }
  const quickReply = t.closest("[data-quick-reply]");
  if (quickReply) {
    const msg = findMessage(quickReply.closest(".msg").dataset.id);
    return msg && setContext("reply", msg);
  }
  // «Conocer»: rompehielos, «Esto o aquello» y propuestas de cita
  const ice = t.closest("[data-icebreaker]");
  if (ice) {
    input.value = ice.dataset.icebreaker;
    autosize();
    return input.focus();
  }
  if (t.closest("[data-dz-game]")) return sendThisOrThat();
  const gameChoice = t.closest("[data-game-choice]");
  if (gameChoice) {
    return api.answer(gameChoice.closest(".msg").dataset.id, { choice: gameChoice.dataset.gameChoice }).catch((err) => toastError(err.message));
  }
  const dateAnswer = t.closest("[data-date-answer]");
  if (dateAnswer) {
    return api.answer(dateAnswer.closest(".msg").dataset.id, { accept: dateAnswer.dataset.dateAnswer === "1" }).catch((err) => toastError(err.message));
  }
  const remind = t.closest("[data-date-remind]");
  if (remind) {
    const when = Number(remind.dataset.dateRemind);
    input.value = `⏰ Recordatorio: nuestra cita es ${new Date(when).toLocaleString("es-CR", { weekday: "long", ...CLOCK })} 💞`;
    autosize();
    return openSchedule();
  }
  const more = t.closest("[data-msg-menu]");
  if (more) {
    const r = more.getBoundingClientRect();
    return openMessageMenu(more.closest(".msg"), r.left - 160, r.bottom + 4);
  }
  const chip = t.closest("[data-react]");
  if (chip) {
    const msg = findMessage(chip.closest(".msg").dataset.id);
    return msg && react(msg, chip.dataset.react);
  }
  const jump = t.closest("[data-jump]");
  if (jump) return jumpToMessage(Number(jump.dataset.jump));
  if (t.matches("img[data-lightbox]")) return openLightbox(t.src);
  const videoThumb = t.closest("[data-video]");
  if (videoThumb) {
    const msg = findMessage(videoThumb.closest(".msg").dataset.id);
    if (msg && !msg.pending) return openLightbox(videoThumb.dataset.video, { video: true });
    return;
  }
  if (t.closest(".audio-play")) return toggleAudio(t.closest(".audio"));
  const wave = t.closest(".audio-wave");
  if (wave) seekAudio(wave, e);
});

messagesEl.addEventListener("scroll", () => {
  atBottom = nearBottom();
  if (messagesEl.scrollTop < 80) loadOlder();
  if (nearBottom()) newWhileScrolled = 0;
  updateScrollButton();
});

$("#scrollDown").addEventListener("click", () => scrollToBottom());

// ==========================================================================
// Audio (notas de voz)
// ==========================================================================
const player = new Audio();
let playingEl = null;

function setPlayIcon(el, playing) {
  $(".audio-play", el).innerHTML = icon(playing ? "pause" : "play");
}

export function stopAudio() {
  player.pause();
  if (playingEl) {
    setPlayIcon(playingEl, false);
    $$(".audio-wave i", playingEl).forEach((b) => b.classList.remove("is-played"));
    const t = $("time", playingEl);
    t.textContent = t.dataset.duration;
  }
  playingEl = null;
}

function toggleAudio(el) {
  if (playingEl === el) {
    if (player.paused) player.play();
    else player.pause();
    return setPlayIcon(el, !player.paused);
  }
  stopAudio();
  playingEl = el;
  player.src = el.dataset.src;
  player.play().then(() => setPlayIcon(el, true), () => {
    toast("No se pudo reproducir el audio", { tone: "error", icon: "mic-off" });
    stopAudio();
  });
}

function seekAudio(wave, e) {
  const el = wave.closest(".audio");
  if (playingEl !== el) return toggleAudio(el);
  const r = wave.getBoundingClientRect();
  if (Number.isFinite(player.duration)) player.currentTime = ((e.clientX - r.left) / r.width) * player.duration;
}

player.addEventListener("timeupdate", () => {
  if (!playingEl || !Number.isFinite(player.duration)) return;
  const bars = $$(".audio-wave i", playingEl);
  const played = Math.round((player.currentTime / player.duration) * bars.length);
  bars.forEach((b, i) => b.classList.toggle("is-played", i < played));
  $("time", playingEl).textContent = duration(player.duration - player.currentTime);
});
player.addEventListener("ended", stopAudio);

// ==========================================================================
// Grabación de notas de voz
// ==========================================================================
const recorder = { media: null, chunks: [], stream: null, started: 0, timer: null, cancelled: false };

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast("Tu navegador no permite grabar audio.", { tone: "error", icon: "mic-off" });
  try {
    recorder.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return toast("Necesitamos permiso para usar el micrófono.", { tone: "error", icon: "mic-off" });
  }
  recorder.chunks = [];
  recorder.cancelled = false;
  recorder.media = new MediaRecorder(recorder.stream);
  recorder.media.ondataavailable = (e) => e.data.size && recorder.chunks.push(e.data);
  recorder.media.onstop = finishRecording;
  recorder.media.start();
  recorder.started = Date.now();
  $("#recorder").hidden = false;
  $("#composerForm").hidden = true;
  recorder.timer = setInterval(() => ($("#recTime").textContent = duration((Date.now() - recorder.started) / 1000)), 250);
}

function stopRecording(cancel) {
  if (!recorder.media || recorder.media.state === "inactive") return;
  recorder.cancelled = cancel;
  recorder.media.stop();
}

function finishRecording() {
  clearInterval(recorder.timer);
  recorder.stream.getTracks().forEach((t) => t.stop());
  $("#recorder").hidden = true;
  $("#composerForm").hidden = false;
  $("#recTime").textContent = "0:00";
  const seconds = (Date.now() - recorder.started) / 1000;
  if (recorder.cancelled || seconds < 0.8) return;

  const type = recorder.media.mimeType || "audio/webm";
  const file = new File(recorder.chunks, `nota-de-voz.${type.includes("ogg") ? "ogg" : type.includes("mp4") ? "m4a" : "webm"}`, { type });
  send({ file, kind: "audio", duration: Math.round(seconds) }, { type: "audio", mediaUrl: URL.createObjectURL(file), meta: { duration: seconds } });
}

// ==========================================================================
// Búsqueda dentro del chat
// ==========================================================================
function openChatSearch() {
  $("#chatSearch").hidden = false;
  $("#chatSearchInput").focus();
  if (!isWide()) app.classList.remove("has-info");
}

function closeChatSearch(rerender = true) {
  $("#chatSearch").hidden = true;
  $("#chatSearchInput").value = "";
  $("#chatSearchCount").textContent = "";
  if (searchQuery) {
    searchQuery = "";
    const conv = activeConv();
    if (rerender && conv) renderMessages(conv);
  }
}

$("#chatSearchInput").addEventListener("input", (e) => {
  searchQuery = e.target.value.trim();
  const conv = activeConv();
  if (!conv) return;
  renderMessages(conv);
  const hits = $$("mark", messagesEl);
  $("#chatSearchCount").textContent = searchQuery ? `${hits.length} resultado${hits.length === 1 ? "" : "s"}` : "";
  hits.at(-1)?.scrollIntoView({ block: "center" });
});

// ==========================================================================
// Inicialización
// ==========================================================================
export function initConversation() {
  // Teclado del móvil abierto o cerrado: si estabas abajo del todo, sigues viendo el último mensaje
  on("viewport", () => keepBottom());

  input.addEventListener("input", () => {
    autosize();
    if (input.value.trim()) startTyping();
    if (composeState.mode !== "edit" && state.activeId && setDraft(state.activeId, input.value)) emit("drafts");
  });
  // Guarda el borrador si se cierra o recarga la pestaña
  window.addEventListener("pagehide", saveDraft);

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && prefs.get("enterToSend", true) && !e.isComposing) {
      e.preventDefault();
      submitText();
    }
    if (e.key === "Escape" && composeState.mode) cancelContext();
  });

  // Pegar imágenes o archivos (Ctrl+V) abre la vista previa
  input.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) {
      e.preventDefault();
      openAttachPreview(files, "auto");
    }
  });

  $("#composerForm").addEventListener("submit", (e) => {
    e.preventDefault();
    submitText();
  });

  // Arrastrar y soltar archivos en el chat
  $("#chat").addEventListener("dragover", (e) => {
    if (state.activeId && e.dataTransfer?.types.includes("Files")) {
      e.preventDefault();
      $("#chat").classList.add("is-dragging");
    }
  });
  $("#chat").addEventListener("dragleave", (e) => {
    if (!e.relatedTarget || !$("#chat").contains(e.relatedTarget)) $("#chat").classList.remove("is-dragging");
  });
  $("#chat").addEventListener("drop", (e) => {
    $("#chat").classList.remove("is-dragging");
    if (!e.dataTransfer?.files.length || !state.activeId) return;
    e.preventDefault();
    openAttachPreview([...e.dataTransfer.files], "auto");
  });

  // Emojis (por categorías, con buscador y recientes) y stickers
  initEmojiPicker($("#emojiPanel"), (emoji) => {
    input.setRangeText(emoji, input.selectionStart, input.selectionEnd, "end");
    autosize();
    // En móvil no se enfoca el campo para no abrir el teclado encima del panel
    if (!isMobile()) input.focus();
  });

  initStickers((src) => {
    send({ sticker: src }, { type: "sticker", mediaUrl: src });
    closePopovers();
  });

  $("#attachMenu").addEventListener("click", (e) => {
    const type = e.target.closest("[data-attach]")?.dataset.attach;
    if (!type) return;
    closePopovers();
    if (type === "schedule") return openSchedule();
    if (type === "this-or-that") return sendThisOrThat();
    if (type === "date") return openModal("modal-propose-date");
    if (type === "video") return openVideoRecorder();
    if (attachActions[type]) return attachActions[type]();
    if (type === "payment") {
      const peer = peerOf(activeConv());
      return openModal("modal-wallet", peer?.id);
    }
    fileInput.dataset.kind = type;
    fileInput.multiple = type !== "camera";
    fileInput.accept = type === "file" ? "" : type === "image" ? "image/*,video/*" : "image/*";
    if (type === "camera") fileInput.setAttribute("capture", "environment");
    else fileInput.removeAttribute("capture");
    fileInput.click();
  });

  // Los archivos elegidos pasan por la vista previa (o se añaden si ya está abierta)
  fileInput.addEventListener("change", () => {
    // "Documento" envía todo como archivo; foto, cámara y añadir detectan cada archivo
    openAttachPreview(fileInput.files, fileInput.dataset.kind === "file" ? "file" : "auto");
    fileInput.value = "";
    delete fileInput.dataset.adding;
  });

  document.addEventListener("visibilitychange", () => markRead());

  registerAction("close-chat", () => (history.state?.chat ? history.back() : closeChat()));
  registerAction("search-chat", () => ($("#chatSearch").hidden ? openChatSearch() : closeChatSearch()));
  registerAction("cancel-context", cancelContext);
  registerAction("start-recording", startRecording);
  registerAction("cancel-recording", () => stopRecording(true));
  registerAction("send-recording", () => stopRecording(false));

  on("presence", () => renderHeader());
  on("conversations", () => renderHeader());
  on("blocked", () => renderHeader());
  on("users", () => {
    const conv = activeConv();
    if (conv) renderMessages(conv, { keepScroll: true });
  });

  autosize();
}

/**
 * Lleva a un mensaje del chat abierto y lo resalta. Si aún no está cargado,
 * carga páginas anteriores hasta encontrarlo (citas, mensajes destacados).
 */
export async function jumpToMessage(id) {
  const conv = activeConv();
  if (!conv) return false;
  const store = messagesOf(conv.id);
  let loadedMore = false;
  for (let page = 0; page < 20 && !store.items.some((m) => m.id === id) && store.hasMore && store.items.length; page++) {
    const { messages, hasMore } = await api.messages(conv.id, store.items[0].id);
    store.items = [...messages, ...store.items];
    store.hasMore = hasMore;
    loadedMore = true;
    if (!messages.length) break;
  }
  if (conv.id !== state.activeId) return false;
  if (loadedMore) renderMessages(conv, { keepScroll: true });
  const target = messagesEl.querySelector(`[data-id="${id}"]`);
  if (!target) {
    toast("Ese mensaje ya no está en el chat.", { icon: "reply" });
    return false;
  }
  messagesEl.style.scrollBehavior = "auto";
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.classList.remove("is-flash");
  void target.offsetWidth; // reinicia la animación
  target.classList.add("is-flash");
  setTimeout(() => target.classList.remove("is-flash"), 1600);
  return true;
}

/**
 * Quita mensajes del chat (eliminados para mí, temporales caducados) y
 * actualiza la vista previa de la lista si era el último.
 */
export function removeMessages(conversationId, ids) {
  const conv = getConv(conversationId);
  if (!conv) return;
  const gone = new Set(ids.map(Number));
  const store = messagesOf(conv.id);
  const before = store.items.length;
  store.items = store.items.filter((m) => !gone.has(m.id));
  if (conv.lastMessage && gone.has(conv.lastMessage.id)) conv.lastMessage = store.items.filter((m) => !m.pending).at(-1) || null;
  if (conv.pinnedMessages?.some((p) => gone.has(p.id))) conv.pinnedMessages = conv.pinnedMessages.filter((p) => !gone.has(p.id));
  if (conv.id === state.activeId && store.items.length !== before) {
    renderMessages(conv, { keepScroll: true });
    renderPinnedBar(conv);
  }
  emit("conversations");
}

export { openChatSearch, setContext, findMessage, messagesEl, renderMessages, input as messageInput, autosize };

export function rerenderActive() {
  const conv = activeConv();
  if (!conv) return;
  renderHeader(conv);
  renderMessages(conv, { keepScroll: true });
}

export function resetMessages(conversationId) {
  state.messages.delete(conversationId);
}

export { upsertConversation };
