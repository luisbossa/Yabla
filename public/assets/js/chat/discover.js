// «Conocer»: descubrir personas deslizando tarjetas (estilo Tinder), match, filtros,
// panel lateral de matches y ayudas para el chat de un match (rompehielos).
import { $, $$, icon, escapeHTML, toast, toastError, prefs, isMobile, listTime } from "./utils.js";
import { state, on, emit, getConv, upsertConversation, activeConv } from "./state.js";
import { api } from "./api.js";
import { socket } from "./socket.js";
import { openModal, closeModal, onModalOpen, registerAction } from "./ui.js";
import { openChat, closeChat } from "./conversation.js";
import { previewOf, previewIcon } from "./format.js";
import { labelHTML, plainLabel, lookingHTML } from "./dz-icons.js";

const app = $("#app");
const deckEl = $("#dzDeck");

export const dz = {
  options: null,
  profile: null,
  superlikesLeft: 3,
  cards: [],
  matches: [],
  likes: { count: 0, photos: [] },
  loading: false,
  lastPassId: null,
};

const LOOKING = { pareja: "💞 Busca pareja", algo_casual: "🍹 Algo casual", amistad: "🤝 Amistad", no_se: "🤷 Aún no sabe" };
const filters = () => ({ verified: false, common: false, ...prefs.get("dzFilters", {}) });

// ==========================================================================
// Datos
// ==========================================================================
/** Aviso de validación de «Conocer»: icono, título, texto y animación (vuelve a sacudirse si se repite). */
export function dzAlert(el, text, { title = "Revisa este paso", tone = "error" } = {}) {
  el.className = `dz-alert is-${tone}`;
  el.innerHTML = `
    <span class="dz-alert-ico">${icon(tone === "ok" ? "check" : "alert")}</span>
    <span class="dz-alert-text"><strong>${escapeHTML(title)}</strong><span>${escapeHTML(text)}</span></span>
    <button type="button" class="dz-alert-x" aria-label="Cerrar aviso">${icon("x", "icon-sm")}</button>`;
  el.hidden = false;
  void el.offsetWidth; // reinicia la animación
  el.classList.add("is-anim");
  el.onclick = (e) => e.target.closest(".dz-alert-x") && (el.hidden = true);
}

/** Marca un campo con error, muestra el motivo debajo y lo lleva a la vista. */
export function markInvalid(field, text) {
  if (!field) return;
  clearInvalid(field.closest("form"));
  field.classList.add("is-invalid");
  if (text) field.insertAdjacentHTML("afterend", `<p class="dz-inline-error">${icon("alert", "icon-sm")}${escapeHTML(text)}</p>`);
  field.scrollIntoView({ block: "center", behavior: "smooth" });
  if (/INPUT|SELECT|TEXTAREA/.test(field.tagName)) field.focus({ preventScroll: true });
}

export function clearInvalid(root) {
  root?.querySelectorAll(".is-invalid").forEach((x) => x.classList.remove("is-invalid"));
  root?.querySelectorAll(".dz-inline-error").forEach((x) => x.remove());
}

export async function loadProfile() {
  const { profile, superlikesLeft } = await api.datingProfile();
  dz.profile = profile;
  dz.superlikesLeft = superlikesLeft;
  renderPanel();
  return profile;
}

async function loadDeck() {
  if (!dz.profile || dz.profile.paused || dz.loading) return renderDeck();
  dz.loading = true;
  try {
    const f = filters();
    const { cards, superlikesLeft } = await api.deck({ ageMin: f.ageMin, ageMax: f.ageMax, maxKm: f.maxKm, verified: f.verified, common: f.common });
    dz.cards = cards;
    dz.superlikesLeft = superlikesLeft;
  } catch (err) {
    toastError(err.message);
  } finally {
    dz.loading = false;
  }
  renderDeck();
}

export async function refreshMatches() {
  try {
    const [{ matches }, likes] = await Promise.all([api.datingMatches(), api.datingLikes()]);
    dz.matches = matches;
    dz.likes = likes;
  } catch {
    /* «Conocer» es opcional */
  }
  renderPanel();
}

export const matchForConversation = (conversationId) => dz.matches.find((m) => m.conversationId === Number(conversationId));

// ==========================================================================
// Vista: ¿se muestra la pila de tarjetas?
// ==========================================================================
function syncView() {
  const show = state.tab === "discover" && !app.classList.contains("chat-open");
  $("#discover").hidden = !show;
  app.classList.toggle("in-discover", show);
  // En móvil la pila ocupa la pantalla (como un chat abierto)
  if (!show) app.classList.remove("discover-open");
  else if (isMobile() && !app.dataset.dzBack) app.classList.add("discover-open");
  if (show && !dz.cards.length) loadDeck();
}

// ==========================================================================
// Tarjetas
// ==========================================================================
function cardHTML(c, top) {
  const photos = c.photos.length ? c.photos : [c.avatar];
  const bars = photos.length > 1 ? `<div class="dz-bars">${photos.map((_, i) => `<i class="${i === 0 ? "is-on" : ""}"></i>`).join("")}</div>` : "";
  const common = new Set(c.common);
  const prompt = c.prompts[0];
  return `
    <article class="dz-card ${top ? "is-top" : "is-next"}" data-card="${c.userId}" data-photo="0" tabindex="${top ? 0 : -1}" aria-label="${escapeHTML(`${c.firstName}, ${c.age} años`)}">
      <div class="dz-photo" style="background-image:url('${escapeHTML(photos[0])}')">
        ${bars}
        <span class="dz-stamp is-like">ME GUSTA</span>
        <span class="dz-stamp is-pass">PASO</span>
        <span class="dz-stamp is-super">SÚPER</span>
        ${c.superlikedMe ? `<span class="dz-badge is-super">${icon("star-fill", "icon-sm")}Te dio súper like</span>` : ""}
        <button class="dz-more" data-dz-more aria-label="Ver perfil">${icon("info")}</button>
        <div class="dz-info">
          <h3>${escapeHTML(c.firstName)} <span>${c.age}</span>${c.verified ? icon("shield-check", "dz-verified") : ""}</h3>
          <p>${icon("map-pin", "icon-sm")}${escapeHTML(c.provinceName)}${c.distanceKm ? ` · a ~${c.distanceKm} km` : ""}</p>
          <p class="dz-aff">${icon("flame", "icon-sm")}<b>${c.affinity} %</b> de afinidad${c.common.length ? ` · ${c.common.length} ${c.common.length === 1 ? "interés" : "intereses"} en común` : ""}</p>
        </div>
      </div>
      <div class="dz-details">
        <span class="dz-looking">${lookingHTML(c.lookingFor)}</span>
        ${c.about ? `<p class="dz-about">${escapeHTML(c.about)}</p>` : ""}
        <div class="dz-tags">${c.interests.map((i) => `<span class="${common.has(i) ? "is-common" : ""}">${labelHTML(i)}</span>`).join("")}</div>
        ${prompt ? `<div class="dz-prompt"><small>${escapeHTML(prompt.q)}</small><p>${escapeHTML(prompt.a)}</p></div>` : ""}
      </div>
    </article>`;
}

function emptyHTML() {
  if (!dz.profile) {
    return `
      <div class="dz-welcome">
        <span class="dz-welcome-art">${icon("flame")}</span>
        <h3>Conoce gente nueva en Yabla</h3>
        <p>Crea tu perfil de citas, desliza y, cuando ambos se gusten, se abrirá un chat. Solo mayores de 18.</p>
        <button class="btn btn-primary" data-open="modal-dating">${icon("heart-fill", "icon-sm")}Crear mi perfil de citas</button>
      </div>`;
  }
  if (dz.profile.paused) {
    return `
      <div class="dz-welcome">
        <span class="dz-welcome-art is-muted">${icon("bell-off")}</span>
        <h3>Tu perfil está en pausa</h3>
        <p>No apareces para otras personas, pero conservas tus matches y chats.</p>
        <button class="btn btn-primary" data-action="dz-resume">Reactivar mi perfil</button>
      </div>`;
  }
  if (dz.loading) return `<div class="dz-welcome"><span class="spinner"></span></div>`;
  return `
    <div class="dz-welcome">
      <span class="dz-welcome-art">${icon("sparkles")}</span>
      <h3>Ya viste a todos por aquí</h3>
      <p>Amplía la distancia o la edad en los filtros, o vuelve más tarde: siempre se une gente nueva.</p>
      <button class="btn btn-ghost" data-open="modal-dating-filters">${icon("sliders", "icon-sm")}Ajustar filtros</button>
    </div>`;
}

function renderDeck() {
  const [top, next] = dz.cards;
  deckEl.innerHTML = (next ? cardHTML(next, false) : "") + (top ? cardHTML(top, true) : "");
  $("#dzEmpty").hidden = Boolean(top);
  $("#dzEmpty").innerHTML = top ? "" : emptyHTML();
  $("#dzActions").hidden = !top;
  $("#dzSuperLeft b").textContent = dz.superlikesLeft;
  $("#dzSuperLeft").classList.toggle("is-empty", !dz.superlikesLeft);
  $('[data-swipe="undo"]').disabled = !dz.lastPassId;
  bindDrag(deckEl.querySelector(".dz-card.is-top"));
}

// ==========================================================================
// Deslizar
// ==========================================================================
const THRESHOLD = 110;

function bindDrag(card) {
  if (!card) return;
  let start = null;
  let moved = false;

  card.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest("button")) return;
    start = { x: e.clientX, y: e.clientY };
    moved = false;
    card.setPointerCapture(e.pointerId);
    card.classList.add("is-dragging");
  });

  card.addEventListener("pointermove", (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
    card.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 18}deg)`;
    const like = Math.max(0, Math.min(1, dx / THRESHOLD));
    const pass = Math.max(0, Math.min(1, -dx / THRESHOLD));
    const sup = Math.max(0, Math.min(1, -dy / THRESHOLD)) * (Math.abs(dx) < THRESHOLD ? 1 : 0);
    card.style.setProperty("--like", like);
    card.style.setProperty("--pass", pass);
    card.style.setProperty("--super", sup);
  });

  const end = (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    start = null;
    card.classList.remove("is-dragging");
    if (dx > THRESHOLD) return decide("like");
    if (dx < -THRESHOLD) return decide("pass");
    if (dy < -THRESHOLD) return decide("superlike");
    card.style.transform = "";
    ["--like", "--pass", "--super"].forEach((v) => card.style.removeProperty(v));
    // Toque sin arrastrar: cambia de foto (mitad izquierda / derecha)
    if (!moved && !e.target.closest(".dz-details")) {
      const r = card.getBoundingClientRect();
      changePhoto(card, e.clientX < r.left + r.width / 2 ? -1 : 1);
    }
  };
  card.addEventListener("pointerup", end);
  card.addEventListener("pointercancel", end);
}

function changePhoto(card, step) {
  const c = dz.cards.find((x) => String(x.userId) === card.dataset.card);
  if (!c || c.photos.length < 2) return;
  const i = (Number(card.dataset.photo) + step + c.photos.length) % c.photos.length;
  card.dataset.photo = i;
  card.querySelector(".dz-photo").style.backgroundImage = `url('${c.photos[i]}')`;
  card.querySelectorAll(".dz-bars i").forEach((b, j) => b.classList.toggle("is-on", j === i));
}

let deciding = false;
async function decide(action) {
  const card = deckEl.querySelector(".dz-card.is-top");
  const c = dz.cards[0];
  if (!card || !c || deciding) return;
  if (action === "superlike" && !dz.superlikesLeft) {
    card.style.transform = "";
    return toast("Ya usaste tus súper likes de hoy. Vuelve mañana", { icon: "star" });
  }
  deciding = true;
  // La tarjeta sale volando hacia su lado
  const out = { like: "translate(140%, 10%) rotate(28deg)", pass: "translate(-140%, 10%) rotate(-28deg)", superlike: "translate(0, -130%) rotate(0deg)" }[action];
  card.style.setProperty(action === "like" ? "--like" : action === "pass" ? "--pass" : "--super", 1);
  card.classList.add("is-leaving");
  card.style.transform = out;
  dz.cards.shift();
  dz.lastPassId = action === "pass" ? c.userId : null;
  setTimeout(() => {
    deciding = false;
    renderDeck();
    if (dz.cards.length < 3) loadMore();
  }, 260);

  try {
    const res = await api.swipe(c.userId, action);
    dz.superlikesLeft = res.superlikesLeft;
    $("#dzSuperLeft b").textContent = dz.superlikesLeft;
    if (res.match) await refreshMatches();
  } catch (err) {
    toastError(err.message);
    dz.cards.unshift(c); // no se guardó: vuelve a la pila
    renderDeck();
  }
}

async function loadMore() {
  if (dz.loading) return;
  const known = new Set(dz.cards.map((c) => c.userId));
  try {
    const f = filters();
    const { cards } = await api.deck({ ageMin: f.ageMin, ageMax: f.ageMax, maxKm: f.maxKm, verified: f.verified, common: f.common });
    cards.filter((c) => !known.has(c.userId)).forEach((c) => dz.cards.push(c));
    if (!deckEl.querySelector(".dz-card")) renderDeck();
  } catch {
    /* se reintentará */
  }
}

async function undo() {
  if (!dz.lastPassId) return;
  try {
    const { card } = await api.undoSwipe();
    dz.lastPassId = null;
    if (card) dz.cards.unshift(card);
    renderDeck();
    toast("Deshiciste el último paso", { icon: "rotate-ccw" });
  } catch (err) {
    toastError(err.message);
  }
}

// ==========================================================================
// ¡Es un match!
// ==========================================================================
let matchConversation = null;

async function showMatch({ conversationId, user, me }) {
  matchConversation = conversationId;
  $("#dzMatchTitle").textContent = `Tú y ${user.firstName} se gustan`;
  $("#dzMatchMe").src = me.photo || state.me.avatar;
  $("#dzMatchThem").src = user.photos?.[0] || user.avatar;
  $("#dzMatchCommon").innerHTML = user.common?.length
    ? `Tienen en común: ${user.common.slice(0, 3).map((i) => `<b>${labelHTML(i)}</b>`).join("")}`
    : `Rompe el hielo: pregúntale por ${escapeHTML(plainLabel(user.interests?.[0] || "su plan ideal").toLowerCase())}`;
  openModal("modal-match");
  await refreshMatches();
}

async function goToMatchChat() {
  closeModal("modal-match");
  if (!matchConversation) return;
  if (!getConv(matchConversation)) {
    try {
      const { conversation } = await api.conversation(matchConversation);
      upsertConversation(conversation);
      emit("conversations");
    } catch {
      return;
    }
  }
  openChat(matchConversation);
}

// ==========================================================================
// Panel lateral
// ==========================================================================
function profileCompleteness(p) {
  let n = 0;
  if (p.photos.length) n += 25;
  if (p.photos.length >= 3) n += 15;
  if (p.about) n += 15;
  if (p.interests.length >= 3) n += 20;
  if (p.prompts.length) n += 15;
  if (p.verified) n += 10;
  return Math.min(100, n);
}

function renderPanel() {
  const p = dz.profile;
  $("#dzMePhoto").src = p?.photos?.[0] || state.me.avatar;
  $("#dzMeTitle").innerHTML = p ? `Mi perfil de citas${p.verified ? icon("shield-check", "dz-verified") : ""}` : "Crea tu perfil de citas";
  $("#dzMeSub").textContent = p ? `${p.paused ? "En pausa" : "Activo"} · ${profileCompleteness(p)} % completo` : "Solo lo verán otras personas de «Conocer»";

  $("#dzLikesCount").textContent = dz.likes.count;
  $("#dzLikesPics").innerHTML = dz.likes.photos.slice(0, 3).map((src) => `<img src="${escapeHTML(src)}" alt="">`).join("") || `<span class="dz-likes-empty">${icon("heart")}</span>`;

  // Nuevos matches: aún sin mensajes (solo el aviso del match)
  const fresh = dz.matches.filter((m) => {
    const conv = getConv(m.conversationId);
    return !conv || !conv.lastMessage || conv.lastMessage.type === "system";
  });
  $("#dzNew").innerHTML = fresh.length
    ? fresh
        .map(
          (m) => `
        <button class="dz-new-item" data-conv="${m.conversationId}" title="${escapeHTML(m.user.name)}">
          <span class="dz-new-pic"><img src="${escapeHTML(m.user.photos?.[0] || m.user.avatar)}" alt=""></span>
          <span>${escapeHTML(m.user.firstName)}</span>
        </button>`
        )
        .join("")
    : `<p class="muted small dz-new-empty">Tus nuevos matches aparecerán aquí.</p>`;

  // Chats de matches con conversación
  const chats = dz.matches
    .map((m) => ({ m, conv: getConv(m.conversationId) }))
    .filter(({ conv }) => conv?.lastMessage && conv.lastMessage.type !== "system")
    .sort((a, b) => b.conv.lastMessage.createdAt - a.conv.lastMessage.createdAt);
  $("#dzChats").innerHTML = chats.length
    ? chats
        .map(
          ({ m, conv }) => `
        <li>
          <button class="conv ${conv.unread ? "has-unread" : ""} ${conv.id === state.activeId ? "is-active" : ""}" data-conv="${conv.id}">
            <span class="avatar"><img src="${escapeHTML(m.user.photos?.[0] || m.user.avatar)}" alt=""></span>
            <span class="conv-body">
              <span class="conv-row"><span class="conv-name">${escapeHTML(m.user.name)} ${icon("heart-fill", "dz-heart")}</span><span class="conv-time">${listTime(conv.lastMessage.createdAt)}</span></span>
              <span class="conv-row"><span class="conv-preview">${previewIcon(conv.lastMessage) ? icon(previewIcon(conv.lastMessage), "preview-icon") : ""}${escapeHTML(previewOf(conv))}</span>${conv.unread ? `<b class="badge">${conv.unread}</b>` : ""}</span>
            </span>
          </button>
        </li>`
        )
        .join("")
    : `<li class="empty-list">${icon("heart")}Aún no hablas con ningún match.</li>`;

  // Insignia de la barra: likes nuevos o matches sin abrir
  const badge = $('[data-badge="discover"]');
  if (badge) badge.hidden = !(dz.likes.count || fresh.length);
}

// ==========================================================================
// Rompehielos (chat de un match)
// ==========================================================================
export function icebreakerHTML(conv) {
  const m = matchForConversation(conv.id);
  if (!m) return "";
  const u = m.user;
  const ideas = [];
  (u.common || []).slice(0, 2).forEach((i) => ideas.push(`¡Vi que te gusta ${plainLabel(i).toLowerCase()}! ¿Qué es lo que más te gusta de eso?`));
  if (u.prompts?.[0]) ideas.push(`«${u.prompts[0].a}». ¡Contame más de eso!`);
  ideas.push(`¡Hola ${u.firstName}! ¿Cuál sería tu plan ideal para este finde?`);
  return `
    <div class="dz-ice">
      <div class="dz-ice-pics"><img src="${escapeHTML(state.me.avatar)}" alt=""><span>${icon("heart-fill")}</span><img src="${escapeHTML(u.photos?.[0] || u.avatar)}" alt=""></div>
      <strong>Hicieron match · ${escapeHTML(listTime(m.createdAt))}</strong>
      ${u.common?.length ? `<p>Tienen en común: ${u.common.map((i) => `<span>${labelHTML(i)}</span>`).join("")}</p>` : ""}
      <div class="dz-ice-ideas">${ideas.slice(0, 3).map((t) => `<button data-icebreaker="${escapeHTML(t)}">${escapeHTML(t)}</button>`).join("")}</div>
      <div class="dz-ice-games">
        <button data-dz-game>${icon("dice", "icon-sm")}Esto o aquello</button>
        <button data-open="modal-propose-date">${icon("calendar-heart", "icon-sm")}Proponer una cita</button>
      </div>
    </div>`;
}

export async function sendThisOrThat(conv = activeConv()) {
  try {
    await api.thisOrThat(conv.id);
  } catch (err) {
    toastError(err.message);
  }
}

// ==========================================================================
// Reportar
// ==========================================================================
let reportTarget = null;
export function openReport(userId, name) {
  reportTarget = { userId, name };
  openModal("modal-report");
}

// ==========================================================================
// Inicio
// ==========================================================================
export function initDiscover() {
  registerAction("dz-likes", () => {
    const n = dz.likes.count;
    toast(n ? `${n} persona${n === 1 ? "" : "s"} te dieron like. ¡Sigue deslizando para encontrarlas!` : "Aún no tienes likes. ¡Completa tu perfil para recibir más!", { icon: "heart" });
    if (isMobile()) app.classList.add("discover-open");
  });
  registerAction("dz-resume", async () => {
    try {
      await api.pauseDating(false);
      await loadProfile();
      loadDeck();
      toast("Tu perfil vuelve a estar activo", { tone: "success", icon: "flame" });
    } catch (err) {
      toastError(err.message);
    }
  });
  registerAction("dz-back", () => {
    app.classList.remove("discover-open");
    app.dataset.dzBack = "1";
  });
  registerAction("dz-open", () => {
    delete app.dataset.dzBack;
    app.classList.add("discover-open");
  });

  // Tocar «Conocer» con un chat abierto vuelve a la pila de tarjetas
  document.querySelector('.rail [data-tab="discover"]')?.addEventListener("click", () => {
    if (app.classList.contains("chat-open")) closeChat();
    delete app.dataset.dzBack;
    setTimeout(syncView);
  });

  // Botones de la pila
  $("#dzActions").addEventListener("click", (e) => {
    const action = e.target.closest("[data-swipe]")?.dataset.swipe;
    if (action === "undo") undo();
    else if (action) decide(action);
  });
  // Ver más / menos del perfil en la tarjeta
  deckEl.addEventListener("click", (e) => {
    if (e.target.closest("[data-dz-more]")) e.target.closest(".dz-card").classList.toggle("is-expanded");
  });


  // Filtros
  onModalOpen("modal-dating-filters", () => {
    const f = filters();
    $("#dzAgeMin").value = f.ageMin ?? dz.profile?.ageMin ?? 21;
    $("#dzAgeMax").value = f.ageMax ?? dz.profile?.ageMax ?? 40;
    $("#dzKm").value = f.maxKm ?? dz.profile?.maxKm ?? 200;
    $("#dzOnlyVerified").checked = f.verified;
    $("#dzOnlyCommon").checked = f.common;
    syncFilterLabels();
  });
  const syncFilterLabels = () => {
    let min = Number($("#dzAgeMin").value);
    let max = Number($("#dzAgeMax").value);
    if (min > max) [min, max] = [max, min];
    $("#dzAgeLabel").textContent = `${min}–${max}${max >= 99 ? "+" : ""}`;
    $("#dzKmLabel").textContent = `${$("#dzKm").value} km`;
  };
  $("#dzFilters").addEventListener("input", syncFilterLabels);
  $("#dzFilters").addEventListener("submit", (e) => {
    e.preventDefault();
    let ageMin = Number($("#dzAgeMin").value);
    let ageMax = Number($("#dzAgeMax").value);
    if (ageMin > ageMax) [ageMin, ageMax] = [ageMax, ageMin];
    prefs.set("dzFilters", { ageMin, ageMax, maxKm: Number($("#dzKm").value), verified: $("#dzOnlyVerified").checked, common: $("#dzOnlyCommon").checked });
    closeModal("modal-dating-filters");
    dz.cards = [];
    loadDeck();
    toast("Filtros aplicados", { icon: "sliders" });
  });

  // Match
  $("#dzMatchChat").addEventListener("click", goToMatchChat);
  socket.on("dating:match", (payload) => showMatch(payload));
  socket.on("dating:like", ({ superlike }) => {
    dz.likes.count += 1;
    renderPanel();
    if (superlike) toast("¡Alguien te dio un súper like!", { icon: "star" });
  });
  socket.on("dating:unmatch", () => refreshMatches());

  // Reportar
  onModalOpen("modal-report", () => {
    const reasons = dz.options?.reasons || {};
    $("#reportReasons").innerHTML = Object.entries(reasons)
      .map(([id, label]) => `<button type="button" class="radio-row" data-reason="${id}"><span class="radio-dot"></span><span><strong>${escapeHTML(label)}</strong></span></button>`)
      .join("");
    $("#reportDetails").value = "";
    $("#reportSubmit").disabled = true;
    $("#reportForm").dataset.reason = "";
  });
  $("#reportReasons").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-reason]");
    if (!btn) return;
    $$("#reportReasons .radio-row").forEach((r) => r.classList.toggle("is-selected", r === btn));
    $("#reportForm").dataset.reason = btn.dataset.reason;
    $("#reportSubmit").disabled = false;
  });
  $("#reportForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!reportTarget) return;
    try {
      const { blockedIds } = await api.report({ userId: reportTarget.userId, reason: $("#reportForm").dataset.reason, details: $("#reportDetails").value });
      state.blockedIds = new Set(blockedIds);
      emit("blocked");
      closeModal("modal-report");
      dz.cards = dz.cards.filter((c) => c.userId !== reportTarget.userId);
      renderDeck();
      await refreshMatches();
      toast(`Reportaste a ${reportTarget.name}. No volverás a verle.`, { icon: "flag" });
    } catch (err) {
      toastError(err.message);
    }
  });

  // Proponer una cita desde el chat de un match
  onModalOpen("modal-propose-date", () => {
    const d = new Date(Date.now() + 2 * 864e5);
    d.setHours(19, 0, 0, 0);
    const pad = (n) => String(n).padStart(2, "0");
    $("#proposeWhen").value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T19:00`;
    $("#proposePlace").value = "";
    $$('#proposeForm [data-name="dateKind"] button').forEach((x) => x.classList.toggle("is-selected", x.dataset.value === "video"));
    $("#proposePlaceField").hidden = true;
    $("#proposeAlert").hidden = true;
    clearInvalid($("#proposeForm"));
  });
  $('#proposeForm [data-name="dateKind"]').addEventListener("click", (e) => {
    const btn = e.target.closest("[data-value]");
    if (!btn) return;
    $$('#proposeForm [data-name="dateKind"] button').forEach((x) => x.classList.toggle("is-selected", x === btn));
    $("#proposePlaceField").hidden = btn.dataset.value !== "place";
  });
  $("#proposeForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = $("#proposeForm");
    const alertEl = $("#proposeAlert");
    clearInvalid(form);
    alertEl.hidden = true;
    const kind = $('#proposeForm [data-name="dateKind"] .is-selected')?.dataset.value || "video";
    const place = $("#proposePlace").value.trim();
    const when = new Date($("#proposeWhen").value).getTime();
    if (kind === "place" && !place) {
      markInvalid($("#proposePlace"), "Escribe dónde se verán.");
      return dzAlert(alertEl, "Para una cita en persona necesitamos el lugar.", { title: "Falta el lugar" });
    }
    if (!Number.isFinite(when) || when < Date.now()) {
      markInvalid($("#proposeWhen"), Number.isFinite(when) ? "Esa fecha ya pasó." : "Elige día y hora.");
      return dzAlert(alertEl, "Elige un día y una hora en el futuro.", { title: "Revisa la fecha" });
    }
    try {
      await api.proposeDate(activeConv().id, { kind, place, when });
      closeModal("modal-propose-date");
    } catch (err) {
      dzAlert(alertEl, err.message, { title: "No se pudo enviar" });
    }
  });
  $("#proposeForm").addEventListener("input", (e) => {
    if (e.target.classList.contains("is-invalid")) {
      clearInvalid($("#proposeForm"));
      $("#proposeAlert").hidden = true;
    }
  });

  on("tab", syncView);
  on("active", syncView);
  on("conversations", renderPanel);
  on("profile-dating", async () => {
    await loadProfile();
    dz.cards = [];
    loadDeck();
  });

  api
    .datingOptions()
    .then((o) => (dz.options = o))
    .catch(() => {});
  loadProfile()
    .then(refreshMatches)
    .catch(() => {});
}
