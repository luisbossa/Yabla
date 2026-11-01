// Lista de conversaciones: pestañas, filtros, secciones, menú de cada chat e insignias.
import { $, $$, escapeHTML, icon, listTime } from "./utils.js";
import { state, sortedConversations, convTitle, convAvatar, peerOf, isGroup, receiptOf, on, getConv, getDraft, emit } from "./state.js";
import { previewOf, previewIcon, typingText } from "./format.js";
import { renderStoryLists } from "./stories.js";
import { togglePin, toggleMute, toggleArchive, markAsRead, clearChat, deleteChat } from "./conv-actions.js";
import { registerAction } from "./ui.js";

const TABS = {
  chats: { title: "Chats", placeholder: "Buscar chats…" },
  groups: { title: "Grupos", placeholder: "Buscar grupos…" },
  status: { title: "Estados", placeholder: "Buscar estados…" },
  discover: { title: "Conocer", placeholder: "Buscar en tus matches…" },
};

const FILTERS = {
  all: () => true,
  unread: (c) => c.unread > 0,
  groups: (c) => isGroup(c),
  pinned: (c) => c.pinned,
};

const EMPTY_TEXT = {
  all: "Aún no tienes chats. ¡Empieza uno nuevo!",
  unread: "No tienes mensajes sin leer",
  groups: "Aún no estás en ningún grupo",
  pinned: "Fija tus chats favoritos desde su menú",
};

const RECEIPT_ICON = { sending: "clock", sent: "check", delivered: "check-check", read: "check-check" };
let filter = "all";
let showArchived = false; // vista "Archivados" dentro de la pestaña Chats

/** Un chat recién abierto sin mensajes no aparece en la lista (como WhatsApp), salvo si está abierto. */
const isListed = (c) => c.lastMessage || c.clearedId > 0 || c.id === state.activeId || isGroup(c);

function convItem(conv) {
  const peer = peerOf(conv);
  const msg = conv.lastMessage;
  const typing = typingText(conv);
  // Borrador: lo que dejaste escrito en otro chat (no en el que tienes abierto)
  const draft = !typing && conv.id !== state.activeId ? getDraft(conv.id).trim() : "";
  const mine = msg && msg.senderId === state.me.id && !["system", "call"].includes(msg.type) && !msg.deletedAt;
  const receipt = mine && !draft ? receiptOf(conv, msg) : null;
  const classes = ["conv", conv.id === state.activeId && "is-active", conv.unread && "has-unread", conv.muted && "is-muted"].filter(Boolean).join(" ");

  return `
    <li>
      <button class="${classes}" data-conv="${conv.id}">
        <span class="avatar ${peer?.online ? "is-online" : ""}" data-status="${peer?.status || "available"}"><img src="${convAvatar(conv)}" alt="" loading="lazy"></span>
        <span class="conv-body">
          <span class="conv-row">
            <span class="conv-name">${escapeHTML(convTitle(conv))}${peer?.official ? icon("verified", "badge-verified") : ""}${conv.origin === "match" ? icon("heart-fill", "dz-heart") : ""}</span>
            <span class="conv-time">${listTime(msg?.createdAt || conv.createdAt)}</span>
          </span>
          <span class="conv-row">
            ${receipt ? `<span class="tick tick-${receipt}">${icon(RECEIPT_ICON[receipt], "icon-sm")}</span>` : ""}
            ${draft
              ? `<span class="conv-preview has-draft"><b>${icon("pencil-line", "preview-icon")}Borrador:</b> ${escapeHTML(draft.replace(/\s+/g, " "))}</span>`
              : `<span class="conv-preview ${typing ? "is-typing" : ""}">${!typing && previewIcon(msg) ? icon(previewIcon(msg), `preview-icon${msg.type === "call" && msg.meta?.status !== "completed" ? " is-missed" : ""}`) : ""}${escapeHTML(typing || previewOf(conv))}</span>`}
            <span class="conv-meta">
              ${conv.muted ? icon("bell-off", "icon-muted") : ""}
              ${conv.pinned ? icon("pin", "icon-muted") : ""}
              ${conv.archived && !showArchived ? icon("archive", "icon-muted") : ""}
              ${conv.disappearAfter ? icon("timer", "icon-muted") : ""}
              ${conv.mentions ? `<b class="badge badge-mention" title="Te mencionaron">@</b>` : ""}
              ${conv.unread ? `<b class="badge ${conv.muted ? "is-muted" : ""}">${conv.unread > 99 ? "99+" : conv.unread}</b>` : ""}
              <span class="conv-more" role="button" tabindex="0" data-conv-menu="${conv.id}" aria-label="Opciones del chat">${icon("chevron-down", "icon-sm")}</span>
            </span>
          </span>
        </span>
      </button>
    </li>`;
}

const listHTML = (items) => items.map(convItem).join("");

function renderChats(q, all) {
  const match = (c) => !q || convTitle(c).toLowerCase().includes(q) || (peerOf(c)?.username || "").includes(q);
  const archived = all.filter((c) => c.archived && isListed(c));
  if (showArchived && !archived.length) showArchived = false;
  $("#chatFilters").hidden = showArchived;
  const list = $("#chatList");

  // Vista de archivados
  if (showArchived) {
    const items = archived.filter(match);
    list.innerHTML = `
      <li class="archived-head">
        <button class="icon-btn" data-action="close-archived" aria-label="Volver a los chats">${icon("arrow-left")}</button>
        <span><strong>Archivados</strong><small>Siguen recibiendo mensajes, pero no aparecen en tu lista.</small></span>
      </li>
      ${items.length ? listHTML(items) : `<li class="empty-list">Sin resultados</li>`}`;
    return;
  }

  // Al buscar también aparecen los archivados (como en WhatsApp)
  const items = all.filter((c) => isListed(c) && (q || !c.archived) && match(c) && FILTERS[filter](c));
  const archivedUnread = archived.filter((c) => c.unread).length;
  const archivedRow =
    archived.length && !q && filter === "all"
      ? `<li><button class="archived-row" data-action="open-archived">
          <span class="archived-icon">${icon("archive")}</span>
          <span>Archivados</span>
          ${archivedUnread ? `<b class="badge is-muted">${archivedUnread}</b>` : `<small>${archived.length}</small>`}
        </button></li>`
      : "";

  if (!items.length) {
    if (archivedRow) {
      list.innerHTML = archivedRow;
      return;
    }
    list.innerHTML = `
      <li class="empty-list">
        <span class="empty-icon">${icon(filter === "unread" ? "check-check" : "chat")}</span>
        ${q ? "Sin resultados" : EMPTY_TEXT[filter]}
      </li>`;
    return;
  }

  // Sección de fijados arriba cuando se ven todos los chats
  const pinned = filter === "all" && !q ? items.filter((c) => c.pinned) : [];
  const rest = items.filter((c) => !pinned.includes(c));
  list.innerHTML =
    archivedRow +
    (pinned.length
      ? `<li class="list-title">${icon("pin", "icon-sm")} Fijados</li>${listHTML(pinned)}<li class="list-title">Todos los chats</li>${listHTML(rest)}`
      : listHTML(rest));
}

// ==========================================================================
// Movimiento de la lista
// ==========================================================================
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Los elementos de la lista entran escalonados (solo al cambiar de filtro o de vista, no con cada mensaje). */
function animateList(list) {
  if (!list || reduceMotion()) return;
  [...list.children].forEach((li, i) => li.style.setProperty("--i", Math.min(i, 12)));
  list.classList.remove("is-entering");
  void list.offsetWidth; // reinicia la animación si se cambia de filtro muy rápido
  list.classList.add("is-entering");
  clearTimeout(list.enterTimer);
  list.enterTimer = setTimeout(() => list.classList.remove("is-entering"), 700);
}

/** Lleva la píldora del filtro activo hasta su chip (sin animar la primera vez o si cambia el tamaño). */
function moveFilterIndicator({ instant = false } = {}) {
  const bar = $("#chatFilters");
  const active = $(".chip.is-active", bar);
  if (!active || bar.hidden || !active.offsetWidth) return;
  let pill = $(".chips-indicator", bar);
  if (!pill) {
    pill = Object.assign(document.createElement("span"), { className: "chips-indicator" });
    pill.setAttribute("aria-hidden", "true");
    bar.prepend(pill);
    bar.classList.add("has-indicator");
    instant = true;
  }
  if (instant) pill.style.transition = "none";
  pill.style.width = `${active.offsetWidth}px`;
  pill.style.transform = `translateX(${active.offsetLeft}px)`;
  if (instant) {
    void pill.offsetWidth;
    pill.style.transition = "";
  }
  // Si los filtros no caben (móvil estrecho), el activo se desplaza a la vista
  const { scrollLeft, clientWidth } = bar;
  if (active.offsetLeft < scrollLeft || active.offsetLeft + active.offsetWidth > scrollLeft + clientWidth) {
    bar.scrollTo({ left: active.offsetLeft - 8, behavior: reduceMotion() ? "auto" : "smooth" });
  }
}

function setArchivedView(open) {
  showArchived = open;
  $("#listSearch").value = "";
  renderLists();
  $("#chatList").closest(".panel").scrollTop = 0;
  animateList($("#chatList"));
  if (!open) requestAnimationFrame(() => moveFilterIndicator({ instant: true }));
}

export function renderLists() {
  const q = $("#listSearch").value.trim().toLowerCase();
  const all = sortedConversations();

  renderChats(q, all);
  const groups = all.filter((c) => isGroup(c) && !c.archived && (!q || c.name.toLowerCase().includes(q)));
  $("#groupList").innerHTML = groups.length ? listHTML(groups) : `<li class="empty-list">${q ? "Sin resultados" : "Aún no estás en ningún grupo."}</li>`;
  renderStoryLists(q);
  renderBadges(all);
}

function renderBadges(all) {
  // Los archivados y silenciados no cuentan en las insignias (como en WhatsApp)
  const unreadChats = all.filter((c) => c.unread && !c.muted && !c.archived);
  [["chats", unreadChats], ["groups", unreadChats.filter(isGroup)]].forEach(([tab, list]) => {
    const badge = $(`[data-badge="${tab}"]`);
    badge.hidden = !list.length;
    badge.textContent = list.length;
  });
  $('[data-badge="status"]').hidden = !state.stories.some((g) => g.user.id !== state.me.id && !g.allViewed);

  const unreadCount = all.filter((c) => c.unread && !c.archived).length;
  const chipCount = $('[data-filter-count="unread"]');
  const countChanged = chipCount.hidden !== !unreadCount || chipCount.textContent !== String(unreadCount);
  chipCount.hidden = !unreadCount;
  chipCount.textContent = unreadCount;
  // El número cambia el ancho del chip: la píldora se ajusta
  if (countChanged) moveFilterIndicator();

  const total = all.reduce((n, c) => n + (c.muted || c.archived ? 0 : c.unread || 0), 0);
  document.title = total ? `(${total}) Chats - Yabla` : "Chats - Yabla";
}

export function setTab(tab) {
  state.tab = tab;
  showArchived = false;
  $$("[data-tab]").forEach((btn) => {
    const active = btn.dataset.tab === tab;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-selected", active);
  });
  $$("[data-panel]").forEach((panel) => panel.classList.toggle("is-active", panel.dataset.panel === tab));
  $("#sidebarTitle").textContent = TABS[tab].title;
  $("#listSearch").placeholder = TABS[tab].placeholder;
  $("#listSearch").value = "";
  document.getElementById("app").dataset.view = tab;
  renderLists();
  emit("tab", tab);
  // Los filtros estaban ocultos en otras pestañas: la píldora se coloca sin animar
  if (tab === "chats") requestAnimationFrame(() => moveFilterIndicator({ instant: true }));
}

function setFilter(name) {
  if (name === filter) return;
  filter = name;
  $$("[data-filter]").forEach((chip) => {
    chip.classList.toggle("is-active", chip.dataset.filter === name);
    chip.setAttribute("aria-selected", chip.dataset.filter === name);
  });
  moveFilterIndicator();
  renderLists();
  $("#chatList").closest(".panel").scrollTo({ top: 0, behavior: reduceMotion() ? "auto" : "smooth" });
  animateList($("#chatList"));
  animateList($("#sidePeopleList"));
}

// ==========================================================================
// Menú de cada chat (⋯, clic derecho o pulsación larga)
// ==========================================================================
const menu = $("#convMenu");
let menuConv = null;

export function closeConvMenu() {
  menu.hidden = true;
  menuConv = null;
}

function openConvMenu(id, x, y) {
  const conv = getConv(id);
  if (!conv) return;
  menuConv = conv;
  const group = isGroup(conv);

  $('[data-conv-action="pin"] span', menu).textContent = conv.pinned ? "Desfijar chat" : "Fijar chat";
  $('[data-conv-action="mute"] span', menu).textContent = conv.muted ? "Activar notificaciones" : "Silenciar";
  $('[data-conv-action="mute"] use', menu).setAttribute("href", `/assets/images/icons.svg#i-${conv.muted ? "bell" : "bell-off"}`);
  $('[data-conv-action="archive"] span', menu).textContent = conv.archived ? "Desarchivar" : "Archivar chat";
  $('[data-conv-action="archive"] use', menu).setAttribute("href", `/assets/images/icons.svg#i-${conv.archived ? "unarchive" : "archive"}`);
  $('[data-conv-action="pin"]', menu).hidden = conv.archived;
  $('[data-conv-action="read"]', menu).hidden = !conv.unread;
  $('[data-conv-action="clear"]', menu).hidden = !conv.lastMessage;
  $('[data-conv-action="delete"] span', menu).textContent = group ? "Salir y eliminar" : "Eliminar chat";

  menu.hidden = false;
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, innerWidth - rect.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, innerHeight - rect.height - 8))}px`;
}

const ACTIONS = { pin: togglePin, mute: toggleMute, archive: toggleArchive, read: markAsRead, clear: clearChat, delete: deleteChat };

function initConvMenu() {
  menu.addEventListener("click", (e) => {
    const action = e.target.closest("[data-conv-action]")?.dataset.convAction;
    const conv = menuConv;
    closeConvMenu();
    if (action && conv) ACTIONS[action](conv);
  });

  // Botón ⋯ dentro de cada chat (va antes que el clic que abre el chat)
  document.addEventListener(
    "click",
    (e) => {
      const more = e.target.closest("[data-conv-menu]");
      if (!more) {
        if (!e.target.closest("#convMenu")) closeConvMenu();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const r = more.getBoundingClientRect();
      openConvMenu(Number(more.dataset.convMenu), r.right - 220, r.bottom + 6);
    },
    true
  );

  const lists = [$("#chatList"), $("#groupList")];
  lists.forEach((list) => {
    list.addEventListener("contextmenu", (e) => {
      const item = e.target.closest("[data-conv]");
      if (!item) return;
      e.preventDefault();
      openConvMenu(Number(item.dataset.conv), e.clientX, e.clientY);
    });

    // Pulsación larga en móvil
    let timer;
    let longPressed = false;
    list.addEventListener("touchstart", (e) => {
      const item = e.target.closest("[data-conv]");
      if (!item) return;
      longPressed = false;
      const t = e.touches[0];
      timer = setTimeout(() => {
        longPressed = true;
        navigator.vibrate?.(15);
        openConvMenu(Number(item.dataset.conv), t.clientX, t.clientY);
      }, 450);
    }, { passive: true });
    ["touchend", "touchmove", "touchcancel"].forEach((evt) => list.addEventListener(evt, () => clearTimeout(timer), { passive: true }));
    // Tras una pulsación larga no se abre el chat
    list.addEventListener("click", (e) => {
      if (longPressed) {
        e.stopPropagation();
        e.preventDefault();
        longPressed = false;
      }
    }, true);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menu.hidden) {
      e.stopImmediatePropagation();
      closeConvMenu();
    }
  }, true);
  window.addEventListener("resize", closeConvMenu);
  $$(".panel").forEach((p) => p.addEventListener("scroll", closeConvMenu, { passive: true }));
}

export function initSidebar() {
  $("#listSearch").addEventListener("input", renderLists);
  $("#chatFilters").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-filter]");
    if (chip) setFilter(chip.dataset.filter);
  });
  initConvMenu();
  registerAction("open-archived", () => setArchivedView(true));
  registerAction("close-archived", () => setArchivedView(false));
  ["conversations", "presence", "typing", "stories", "receipts", "active", "drafts"].forEach((evt) => on(evt, renderLists));

  // Píldora del filtro activo: al cargar las fuentes (cambian el ancho de los chips) y al cambiar el tamaño
  moveFilterIndicator({ instant: true });
  document.fonts?.ready.then(() => moveFilterIndicator({ instant: true }));
  addEventListener("resize", () => moveFilterIndicator({ instant: true }));
}
