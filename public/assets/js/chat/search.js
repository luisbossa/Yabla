// Buscador global: chats, acciones y mensajes de todos los chats (los mensajes los busca el servidor).
import { $, $$, icon, escapeHTML } from "./utils.js";
import { state, sortedConversations, convTitle, convAvatar, peerOf, isGroup, getConv, getDraft, userName } from "./state.js";
import { api } from "./api.js";
import { openModal, closeModal, onModalOpen, runAction } from "./ui.js";
import { previewOf } from "./format.js";
import { openChat, jumpToMessage } from "./conversation.js";
import { setTab } from "./sidebar.js";

// Acciones que también aparecen en el buscador
const ACTIONS = [
  { label: "Nuevo chat", icon: "chat-plus", run: () => openModal("modal-new-chat") },
  { label: "Nuevo grupo", icon: "users", run: () => openModal("modal-group") },
  { label: "Conocer gente", icon: "flame", run: () => setTab("discover") },
  { label: "Mi perfil de citas", icon: "heart", run: () => openModal("modal-dating") },
  { label: "Mensajes destacados", icon: "star", run: () => openModal("modal-starred") },
  { label: "Chats archivados", icon: "archive", run: () => (setTab("chats"), runAction("open-archived")) },
  { label: "Publicar un estado", icon: "camera", run: () => runAction("my-status") },
  { label: "Billetera", icon: "wallet", run: () => openModal("modal-wallet") },
  { label: "Mi código QR", icon: "qr", run: () => openModal("modal-qr") },
  { label: "Ajustes y apariencia", icon: "palette", run: () => openModal("modal-settings") },
  { label: "Cambiar contraseña", icon: "lock", run: () => openModal("modal-password") },
  { label: "Cambiar tema claro / oscuro", icon: "moon", run: () => Yabla.toggleTheme() },
];

const MIN_MESSAGE_QUERY = 2;

/** Sin tildes ni mayúsculas, para que "maria" encuentre "María". */
const norm = (text = "") => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function mark(text, q) {
  if (!q) return escapeHTML(text);
  const i = norm(text).indexOf(q);
  if (i < 0) return escapeHTML(text);
  return `${escapeHTML(text.slice(0, i))}<mark>${escapeHTML(text.slice(i, i + q.length))}</mark>${escapeHTML(text.slice(i + q.length))}`;
}

/** Trozo del mensaje alrededor de lo encontrado, para que se vea aunque el mensaje sea largo. */
function snippet(text, q) {
  const i = norm(text).indexOf(q);
  if (i < 40) return text;
  return `…${text.slice(i - 30)}`;
}

const messageText = (m) => m.body || (m.type === "file" ? m.meta?.name : "") || "";

function messageDate(ts) {
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString([], { day: "numeric", month: "short", ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
}

// ==========================================================================
// Resultados
// ==========================================================================
let results = [];
let cursor = 0;
// Mensajes del servidor para la última búsqueda: { q, messages, loading }
let found = { q: "", messages: [], loading: false };
let searchTimer = null;
let searchSeq = 0;

function buildResults(raw) {
  const q = norm(raw.trim());
  const chats = sortedConversations()
    .filter((c) => c.lastMessage || isGroup(c) || c.clearedId > 0)
    .filter((c) => !q || norm(convTitle(c)).includes(q) || norm(peerOf(c)?.username).includes(q))
    .slice(0, q ? 8 : 6)
    .map((c) => ({ type: "chat", conv: c }));
  const actions = ACTIONS.filter((a) => !q || norm(a.label).includes(q))
    .slice(0, q ? 4 : 5)
    .map((a) => ({ type: "action", action: a }));
  const messages = q.length >= MIN_MESSAGE_QUERY && found.q === raw.trim()
    ? found.messages.filter((m) => getConv(m.conversationId)).map((m) => ({ type: "message", message: m }))
    : [];
  return { q, groups: [["Chats", chats], ["Mensajes", messages], ["Acciones", actions]] };
}

function row(item, i, q) {
  const active = i === cursor ? "is-active" : "";
  const attrs = `role="option" id="quick-${i}" class="quick-item ${active}" data-quick="${i}" aria-selected="${Boolean(active)}"`;
  if (item.type === "chat") {
    const c = item.conv;
    const draft = getDraft(c.id).trim();
    const sub = draft ? `Borrador: ${draft}` : previewOf(c);
    return `
      <li ${attrs}>
        <span class="avatar avatar-sm ${peerOf(c)?.online ? "is-online" : ""}"><img src="${convAvatar(c)}" alt=""></span>
        <span class="quick-text"><strong>${mark(convTitle(c), q)}</strong><small>${escapeHTML(sub)}</small></span>
        ${c.unread ? `<b class="badge">${c.unread}</b>` : ""}
        ${c.archived ? `<span class="quick-tag">${icon("archive", "icon-sm")}Archivado</span>` : ""}
        ${c.id === state.activeId ? `<span class="quick-tag">Abierto</span>` : ""}
      </li>`;
  }
  if (item.type === "message") {
    const m = item.message;
    const c = getConv(m.conversationId);
    const who = m.senderId === state.me.id ? "Tú" : userName(m.senderId).split(" ")[0];
    const text = messageText(m);
    const kind = { image: "image", video: "video", file: "file" }[m.type];
    return `
      <li ${attrs}>
        <span class="avatar avatar-sm"><img src="${convAvatar(c)}" alt=""></span>
        <span class="quick-text">
          <strong>${escapeHTML(convTitle(c))}</strong>
          <small>${kind ? icon(kind, "icon-sm") : ""}${isGroup(c) || who === "Tú" ? `${escapeHTML(who)}: ` : ""}${mark(snippet(text, q), q)}</small>
        </span>
        <span class="quick-tag">${messageDate(m.createdAt)}</span>
      </li>`;
  }
  return `
    <li ${attrs}>
      <span class="quick-icon">${icon(item.action.icon)}</span>
      <span class="quick-text"><strong>${mark(item.action.label, q)}</strong></span>
      <span class="quick-tag">Acción</span>
    </li>`;
}

function renderQuick() {
  const raw = $("#quickInput").value.trim();
  const { q, groups } = buildResults(raw);
  results = groups.flatMap(([, items]) => items);
  cursor = Math.min(cursor, Math.max(0, results.length - 1));

  const searching = q.length >= MIN_MESSAGE_QUERY && (found.loading || found.q !== raw);
  if (!results.length && !searching) {
    $("#quickList").innerHTML = `<li class="quick-empty">${icon("search")}No hay resultados para «${escapeHTML(raw)}»</li>`;
    return;
  }

  let i = 0;
  $("#quickList").innerHTML = groups
    .map(([label, items]) => {
      const title = label === "Chats" && !q ? "Recientes" : label;
      const loading = label === "Mensajes" && searching ? `<li class="quick-loading">${icon("search", "icon-sm")}Buscando en tus mensajes…</li>` : "";
      if (!items.length && !loading) return "";
      return `<li class="quick-group">${title}</li>${items.map((item) => row(item, i++, q)).join("")}${loading}`;
    })
    .join("");
  $("#quickInput").setAttribute("aria-activedescendant", `quick-${cursor}`);
}

/** Pide al servidor los mensajes que coinciden (con una pausa mientras se escribe). */
function searchMessages() {
  clearTimeout(searchTimer);
  const raw = $("#quickInput").value.trim();
  if (norm(raw).length < MIN_MESSAGE_QUERY) {
    found = { q: "", messages: [], loading: false };
    return;
  }
  found = { ...found, loading: true };
  const seq = ++searchSeq;
  searchTimer = setTimeout(async () => {
    try {
      const { messages } = await api.searchMessages(raw);
      if (seq !== searchSeq) return; // llegó tarde: ya se escribió otra cosa
      found = { q: raw, messages, loading: false };
    } catch {
      if (seq === searchSeq) found = { q: raw, messages: [], loading: false };
    }
    renderQuick();
  }, 250);
}

function moveCursor(delta) {
  if (!results.length) return;
  cursor = (cursor + delta + results.length) % results.length;
  $$(".quick-item").forEach((el) => {
    const on = Number(el.dataset.quick) === cursor;
    el.classList.toggle("is-active", on);
    el.setAttribute("aria-selected", on);
    if (on) el.scrollIntoView({ block: "nearest" });
  });
  $("#quickInput").setAttribute("aria-activedescendant", `quick-${cursor}`);
}

async function runResult(i) {
  const item = results[i];
  if (!item) return;
  closeModal("modal-quick");
  if (item.type === "action") return item.action.run();
  setTab("chats");
  const convId = item.type === "chat" ? item.conv.id : item.message.conversationId;
  await openChat(convId);
  if (item.type === "message") jumpToMessage(item.message.id);
}

export function initSearch() {
  onModalOpen("modal-quick", () => {
    $("#quickInput").value = "";
    cursor = 0;
    found = { q: "", messages: [], loading: false };
    renderQuick();
  });
  $("#quickInput").addEventListener("input", () => {
    cursor = 0;
    searchMessages();
    renderQuick();
  });
  // Moverse por la lista de resultados con las flechas y abrir con Enter (como cualquier lista)
  $("#quickInput").addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") moveCursor(1);
    else if (e.key === "ArrowUp") moveCursor(-1);
    else if (e.key === "Enter") runResult(cursor);
    else return;
    e.preventDefault();
  });
  $("#quickList").addEventListener("mousemove", (e) => {
    const item = e.target.closest("[data-quick]");
    if (item && Number(item.dataset.quick) !== cursor) moveCursor(Number(item.dataset.quick) - cursor);
  });
  $("#quickList").addEventListener("click", (e) => {
    const item = e.target.closest("[data-quick]");
    if (item) runResult(Number(item.dataset.quick));
  });
}
