// Pantalla de inicio y ayudas para usuarios nuevos: saludo, primeros pasos y sugerencias.
import { $, $$, icon, escapeHTML, toast, firstName, prefs, debounce, toastError, listTime, profileColor, STATUSES } from "./utils.js";
import { state, on, emit, isGroup, peerOf, upsertConversation, rememberUser, sortedConversations, convTitle, convAvatar } from "./state.js";
import { previewOf, previewIcon } from "./format.js";
import { api } from "./api.js";
import { registerAction, runAction } from "./ui.js";
import { openChat, onIncomingMessage } from "./conversation.js";
import { setTab } from "./sidebar.js";

const DEFAULT_AVATAR = "/assets/images/ui/avatar-default.svg";
const DEFAULT_BIO = "Hola, estoy usando Yabla 👋";
let suggestions = [];

// ==========================================================================
// Primeros pasos
// ==========================================================================
function steps() {
  const convs = [...state.conversations.values()];
  const realChats = convs.filter((c) => !isGroup(c) && !peerOf(c)?.official);
  return [
    { done: state.me.avatar && state.me.avatar !== DEFAULT_AVATAR, label: "Añade una foto de perfil", hint: "Así te reconocerán tus amigos", open: "modal-profile", icon: "camera" },
    { done: state.me.bio && state.me.bio !== DEFAULT_BIO, label: "Escribe algo sobre ti", hint: "Tu info aparece en tu perfil", open: "modal-profile", icon: "edit" },
    { done: realChats.some((c) => c.lastMessage), label: "Envía tu primer mensaje", hint: "Empieza un chat con alguien", open: "modal-new-chat", icon: "chat" },
    { done: convs.some(isGroup), label: "Crea o únete a un grupo", hint: "Chatea con varios a la vez", open: "modal-group", icon: "users" },
    { done: state.stories.some((g) => g.user.id === state.me.id), label: "Publica tu primer estado", hint: "Una foto que dura 24 horas", action: "my-status", icon: "sparkles" },
  ];
}

function checklistHTML(compact) {
  const list = steps();
  const done = list.filter((s) => s.done).length;
  const pct = Math.round((done / list.length) * 100);
  const complete = done === list.length;

  return `
    <div class="home-card-head">
      <h3>${complete ? `${icon("party", "icon-sm")} ¡Todo listo!` : "Primeros pasos"}</h3>
      <button class="link-btn" data-action="dismiss-onboarding">${complete ? "Cerrar" : "Ocultar"}</button>
    </div>
    <div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
      <span style="width:${pct}%"></span>
    </div>
    <p class="progress-label muted">${done} de ${list.length} completados</p>
    ${complete ? "" : `
    <ul class="steps-list">
      ${list
        .filter((s) => !compact || !s.done)
        .slice(0, compact ? 2 : list.length)
        .map(
          (s) => `
          <li>
            <button class="step ${s.done ? "is-done" : ""}" ${s.open ? `data-open="${s.open}"` : `data-action="${s.action}"`} ${s.done ? "disabled" : ""}>
              <span class="step-icon">${icon(s.done ? "check" : s.icon, "icon-sm")}</span>
              <span><strong>${s.label}</strong><small>${s.hint}</small></span>
              ${s.done ? "" : icon("chevron-right", "icon-sm step-go")}
            </button>
          </li>`
        )
        .join("")}
    </ul>`}`;
}

function renderChecklist() {
  // Se oculta si el usuario la cerró o si ya completó todos los pasos
  const hidden = prefs.get("onboardingDismissed", false) || steps().every((s) => s.done);
  ["homeChecklist", "sideChecklist"].forEach((id) => {
    const el = document.getElementById(id);
    el.hidden = hidden;
    if (!hidden) el.innerHTML = checklistHTML(id === "sideChecklist");
  });
}

// ==========================================================================
// Personas que quizá conozcas
// ==========================================================================
function candidates() {
  const contacts = new Set([...state.conversations.values()].filter((c) => !isGroup(c)).map((c) => peerOf(c)?.id));
  return suggestions
    .map((u) => ({ ...u, ...state.users.get(u.id) }))
    .filter((u) => !u.official && !contacts.has(u.id) && !state.blockedIds.has(u.id))
    .sort((a, b) => b.online - a.online || a.name.localeCompare(b.name));
}

function personCard(u) {
  const [c1, c2] = profileColor(u.color);
  const status = u.online
    ? `<span class="person-status is-${u.status && u.status !== "available" ? u.status : "online"}"><i></i>${u.status && u.status !== "available" ? STATUSES[u.status].label : "En línea"}</span>`
    : `<span class="person-status is-empty"><i></i>—</span>`;
  return `
    <div class="person" style="--c1:${c1};--c2:${c2}">
      <span class="person-cover"></span>
      <span class="avatar avatar-lg ${u.online ? "is-online" : ""}" data-status="${u.status || "available"}"><img src="${escapeHTML(u.avatar)}" alt="" loading="lazy"></span>
      <strong title="${escapeHTML(u.name)}">${escapeHTML(u.name)}</strong>
      <small class="muted">@${escapeHTML(u.username)}</small>
      ${status}
      <p class="person-bio">${escapeHTML(u.bio || "")}</p>
      <button class="btn btn-primary btn-sm" data-hi="${u.id}">${icon("hand", "icon-sm")} Saludar</button>
    </div>`;
}

function personRow(u) {
  return `
    <li>
      <div class="conv">
        <span class="avatar ${u.online ? "is-online" : ""}"><img src="${escapeHTML(u.avatar)}" alt="" loading="lazy"></span>
        <span class="conv-body">
          <span class="conv-name">${escapeHTML(u.name)}</span>
          <span class="conv-preview">${escapeHTML(u.bio || `@${u.username}`)}</span>
        </span>
        <button class="btn btn-ghost btn-sm" data-hi="${u.id}">${icon("hand", "icon-sm")} Saludar</button>
      </div>
    </li>`;
}

function renderPeople() {
  const list = candidates();
  $("#homePeopleCard").hidden = !list.length;
  $("#homePeople").innerHTML = list.slice(0, 8).map(personCard).join("");

  // En la lista lateral solo mientras tengas pocos contactos
  const directCount = [...state.conversations.values()].filter((c) => !isGroup(c) && !peerOf(c)?.official).length;
  const showSide = list.length > 0 && directCount < 5 && !$("#listSearch").value;
  $("#sidePeople").hidden = !showSide;
  if (showSide) $("#sidePeopleList").innerHTML = list.slice(0, 5).map(personRow).join("");
}

async function loadSuggestions() {
  try {
    const { users } = await api.searchUsers("");
    users.forEach(rememberUser);
    suggestions = users;
    renderPeople();
  } catch {
    /* las sugerencias son opcionales */
  }
}

/** "Saludar": abre el chat y envía un 👋, como el saludo rápido de Telegram. */
async function sayHi(userId, btn) {
  btn.disabled = true;
  try {
    const { conversation } = await api.openDirect(userId);
    upsertConversation(conversation);
    emit("conversations");
    await openChat(conversation.id);
    const { message } = await api.send(conversation.id, { text: "👋 ¡Hola!" });
    onIncomingMessage(message); // por si el evento del socket aún no llegó (se ignora si ya está)
    toast("¡Saludo enviado!", { tone: "success", icon: "hand" });
  } catch (err) {
    toastError(err.message);
    btn.disabled = false;
  }
}

// ==========================================================================
// Saludo y resumen
// ==========================================================================
function renderHero() {
  const hour = new Date().getHours();
  const night = hour < 6 || hour >= 20;
  $("#homeGreeting").textContent = hour < 6 ? "Buenas noches" : hour < 12 ? "Buenos días" : hour < 20 ? "Buenas tardes" : "Buenas noches";
  $("#homeDayIcon").innerHTML = icon(night ? "moon" : "sun", "icon-sm");
  $("#homeDate").textContent = new Date().toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" });

  // Portada con el color de mi perfil
  const [c1, c2] = profileColor(state.me.color);
  $("#homeHero").style.setProperty("--c1", c1);
  $("#homeHero").style.setProperty("--c2", c2);
  $("#homeAvatarHint").hidden = state.me.avatar !== DEFAULT_AVATAR;

  const convs = [...state.conversations.values()].filter((c) => !c.archived);
  const unread = convs.reduce((n, c) => n + (c.muted ? 0 : c.unread || 0), 0);
  const unreadChats = convs.filter((c) => c.unread).length;
  const mentions = convs.filter((c) => c.mentions);
  const online = new Set(convs.flatMap((c) => c.members).filter((m) => m.id !== state.me.id && state.users.get(m.id)?.online).map((m) => m.id)).size;
  const newStories = state.stories.filter((g) => g.user.id !== state.me.id && !g.allViewed).length;

  $("#homeSummary").innerHTML = unread
    ? `Tienes <strong>${unread}</strong> mensaje${unread === 1 ? "" : "s"} sin leer${unreadChats > 1 ? ` en ${unreadChats} chats` : ""}.`
    : "Estás al día. Elige una conversación o empieza una nueva.";

  const pills = [];
  if (unread) pills.push(`<button class="home-pill" data-home="unread">${icon("chat", "icon-sm")}<b>${unread}</b> sin leer</button>`);
  if (mentions.length) pills.push(`<button class="home-pill is-mention" data-home="mention">${icon("at-sign", "icon-sm")}<b>${mentions.length}</b> mención${mentions.length === 1 ? "" : "es"}</button>`);
  if (newStories) pills.push(`<button class="home-pill" data-home="stories">${icon("status", "icon-sm")}<b>${newStories}</b> estado${newStories === 1 ? "" : "s"} nuevo${newStories === 1 ? "" : "s"}</button>`);
  if (online) pills.push(`<span class="home-pill is-static"><i class="dot-online"></i><b>${online}</b> en línea</span>`);
  $("#homePills").innerHTML = pills.join("");
}

// ==========================================================================
// Continúa la conversación (chats recientes, primero los no leídos)
// ==========================================================================
function renderRecent() {
  const list = sortedConversations()
    .filter((c) => c.lastMessage && !c.archived)
    .sort((a, b) => (b.unread > 0) - (a.unread > 0) || (b.lastMessage?.createdAt || 0) - (a.lastMessage?.createdAt || 0))
    .slice(0, 4);
  $("#homeRecentCard").hidden = !list.length;
  $("#homeRecent").innerHTML = list
    .map((c) => {
      const peer = peerOf(c);
      const kind = previewIcon(c.lastMessage);
      return `
      <li>
        <button class="recent-item ${c.unread ? "has-unread" : ""}" data-conv="${c.id}">
          <span class="avatar ${peer?.online ? "is-online" : ""}" data-status="${peer?.status || "available"}"><img src="${convAvatar(c)}" alt="" loading="lazy"></span>
          <span class="recent-body">
            <span class="recent-row"><strong>${escapeHTML(convTitle(c))}</strong><time>${listTime(c.lastMessage.createdAt)}</time></span>
            <span class="recent-row"><small>${kind ? icon(kind, "icon-sm") : ""}${escapeHTML(previewOf(c))}</small>${c.unread ? `<b class="badge">${c.unread}</b>` : ""}</span>
          </span>
        </button>
      </li>`;
    })
    .join("");
}

// ==========================================================================
// Consejo del día: descubre funciones
// ==========================================================================
const TIPS = [
  { icon: "search", title: "Busca en todos tus chats", text: "Desde el buscador encuentras chats, acciones y cualquier mensaje que hayas enviado o recibido.", action: ["modal-quick", "Probar ahora"] },
  { icon: "calendar-clock", title: "Programa mensajes", text: "Haz clic derecho (o mantén pulsado) el botón de enviar para elegir el día y la hora." },
  { icon: "pin", title: "Fija lo importante", text: "Fija hasta 3 mensajes arriba de cada chat desde el menú del mensaje." },
  { icon: "timer", title: "Mensajes temporales", text: "En la info del chat puedes hacer que los mensajes desaparezcan a las 24 h, 7 o 90 días." },
  { icon: "at-sign", title: "Menciona en grupos", text: "Escribe <kbd>@</kbd> y elige a alguien: le llegará el aviso aunque tenga el grupo silenciado." },
  { icon: "palette", title: "Hazla tuya", text: "Elige tema, color, fondo del chat y tamaño de letra en Ajustes.", action: ["modal-settings", "Abrir ajustes"] },
  { icon: "star", title: "Destaca mensajes", text: "Marca con estrella lo que quieras encontrar luego en «Mensajes destacados»." },
  { icon: "bell-off", title: "Modo No molestar", text: "Cambia tu estado en tu perfil para silenciar los avisos cuando lo necesites.", action: ["modal-profile", "Mi perfil"] },
];
let tipIndex = Math.floor(Math.random() * TIPS.length);

function renderTip() {
  const tip = TIPS[tipIndex];
  $("#tipBody").innerHTML = `
    <span class="tip-icon">${icon(tip.icon)}</span>
    <div>
      <strong>${tip.title}</strong>
      <p>${tip.text}</p>
      ${tip.action ? `<button class="btn btn-ghost btn-sm" data-open="${tip.action[0]}">${tip.action[1]}</button>` : ""}
    </div>
    <span class="tip-dots">${TIPS.map((_, i) => `<i class="${i === tipIndex ? "is-active" : ""}"></i>`).join("")}</span>`;
}

const renderAll = () => {
  renderHero();
  renderChecklist();
  renderRecent();
  renderPeople();
};

export function initHome() {
  registerAction("dismiss-onboarding", () => {
    prefs.set("onboardingDismissed", true);
    renderChecklist();
  });

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-hi]");
    if (btn) sayHi(Number(btn.dataset.hi), btn);
  });

  $("#listSearch").addEventListener("input", renderPeople);

  registerAction("next-tip", () => {
    tipIndex = (tipIndex + 1) % TIPS.length;
    renderTip();
  });

  // Pastillas del resumen
  $("#homePills").addEventListener("click", (e) => {
    const kind = e.target.closest("[data-home]")?.dataset.home;
    if (kind === "unread") {
      setTab("chats");
      $('[data-filter="unread"]')?.click();
    }
    if (kind === "mention") {
      const conv = sortedConversations().find((c) => c.mentions);
      if (conv) openChat(conv.id);
    }
    if (kind === "stories") setTab("status");
  });
  renderTip();
  const refresh = debounce(renderAll, 150);
  ["conversations", "presence", "stories", "users", "blocked"].forEach((evt) => on(evt, refresh));
  // El perfil cambia desde el modal: se refrescan los pasos al cerrarlo
  $("#modal-profile").addEventListener("modal:close", () => setTimeout(renderAll, 300));

  renderAll();
  loadSuggestions();
}
