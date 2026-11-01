// Textos derivados de los mensajes (vista previa, sistema, llamadas, pagos).
import { state, userName, isGroup } from "./state.js";
import { duration, money } from "./utils.js";
import { plainLabel } from "./dz-icons.js";

export function systemText(msg) {
  const mine = msg.senderId === state.me.id;
  const actor = userName(msg.senderId);
  // "Tú creaste…" / "Karla creó…"
  const verb = (me, other) => (mine ? me : other);
  const meta = msg.meta || {};
  switch (meta.action) {
    case "created":
      return `${actor} ${verb("creaste", "creó")} el grupo «${meta.name}»`;
    case "added":
      return `${actor} ${verb("añadiste", "añadió")} a ${(meta.userIds || []).map((id) => userName(id)).join(", ")}`;
    case "left":
      return `${actor} ${verb("saliste", "salió")} del grupo`;
    case "renamed":
      return `${actor} ${verb("cambiaste", "cambió")} el nombre del grupo a «${meta.name}»`;
    case "matched":
      return "¡Hicieron match en «Conocer»! Saluda y rompe el hielo.";
    case "game-result": {
      const picks = Object.entries(meta.answers || {});
      const [a, b] = picks.map(([, choice]) => choice);
      if (picks.length === 2 && a === b) return `¡Ambos eligieron ${plainLabel(a)}!`;
      return picks.map(([id, choice]) => `${userName(Number(id), { short: true })}: ${plainLabel(choice)}`).join(" · ");
    }
    case "pinned":
      return `${actor} ${verb("fijaste", "fijó")} un mensaje`;
    case "disappearing":
      return meta.seconds
        ? `${actor} ${verb("activaste", "activó")} los mensajes temporales. Los mensajes nuevos desaparecerán después de ${disappearLabel(meta.seconds).toLowerCase()}.`
        : `${actor} ${verb("desactivaste", "desactivó")} los mensajes temporales`;
    default:
      return msg.body || "";
  }
}

/** Duración de los mensajes temporales: 24 horas, 7 días, 90 días. */
export function disappearLabel(seconds) {
  if (!seconds) return "Desactivados";
  const days = seconds / 86400;
  return days < 1 ? `${Math.round(seconds / 3600)} horas` : days === 1 ? "24 horas" : `${days} días`;
}

/** "@karla" → "@Karla" (nombre del participante) en vistas previas. */
export function mentionsToNames(conv, text = "") {
  if (!text.includes("@") || !conv?.members) return text;
  return text.replace(/(^|[^\w@/])@([a-z0-9_.]{3,20})/gi, (m, pre, name) => {
    const member = conv.members.find((u) => u.username?.toLowerCase() === name.toLowerCase());
    return member ? `${pre}@${member.name.split(" ")[0]}` : m;
  });
}

export function callText(msg) {
  const { callType, status, duration: secs } = msg.meta || {};
  const mine = msg.senderId === state.me.id;
  const kind = callType === "video" ? "Videollamada" : "Llamada de voz";
  if (status === "completed") return `${kind} · ${duration(secs)}`;
  if (status === "busy") return `${kind} · Ocupado`;
  if (status === "declined") return mine ? `${kind} rechazada` : `${kind} rechazada`;
  return mine ? `${kind} sin respuesta` : `${kind} perdida`;
}

export function paymentText(msg) {
  const amount = money(msg.meta?.amountCents || 0, msg.meta?.currency || "USD");
  return msg.senderId === state.me.id ? `Enviaste ${amount}` : `${userName(msg.senderId, { short: true })} te envió ${amount}`;
}

/** Icono SVG que acompaña a la vista previa (o null para texto normal). */
export function previewIcon(msg) {
  if (!msg) return null;
  if (msg.deletedAt) return "ban";
  const icons = { image: "image", video: "video", audio: "mic", file: "file", sticker: "sticker", payment: "wallet", date: "calendar-heart", game: "dice", poll: "bar-chart", location: "map-pin" };
  if (msg.type === "call") return msg.meta?.callType === "video" ? "video" : "phone";
  if (msg.meta?.viewOnce) return "view-once";
  return icons[msg.type] || null;
}

/** Texto corto para la lista de chats y notificaciones (sin emojis: el icono va aparte). */
export function previewOf(conv, msg = conv.lastMessage) {
  if (!msg) return "Sin mensajes todavía";
  if (msg.deletedAt) return "Se eliminó este mensaje";
  if (msg.type === "system") return systemText(msg);
  if (msg.type === "call") return callText(msg);
  if (msg.type === "payment") return paymentText(msg);
  if (msg.type === "game") return `${msg.senderId === state.me.id ? "Tú: " : ""}${(msg.meta?.options || []).map(plainLabel).join(" o ")}`;
  if (msg.type === "date") return `${msg.senderId === state.me.id ? "Tú: " : ""}Propuesta de cita · ${msg.meta?.kind === "place" ? msg.meta.place : "Videollamada"}`;

  const labels = {
    image: msg.meta?.viewOnce ? "Foto de ver una vez" : msg.body || "Foto",
    video: msg.meta?.viewOnce ? "Video de ver una vez" : msg.body || `Video (${duration(msg.meta?.duration)})`,
    poll: `Encuesta: ${msg.body}`,
    location: msg.body || "Ubicación",
    audio: `Nota de voz (${duration(msg.meta?.duration)})`,
    file: msg.meta?.name || "Documento",
    sticker: "Sticker",
  };
  const text = labels[msg.type] || mentionsToNames(conv, msg.body || "");
  if (msg.senderId === state.me.id) return `Tú: ${text}`;
  if (isGroup(conv)) return `${userName(msg.senderId, { short: true })}: ${text}`;
  return text;
}

/** "escribiendo…" o "Mauricio está escribiendo…". */
export function typingText(conv) {
  const ids = [...(state.typing.get(conv.id)?.keys() || [])];
  if (!ids.length) return "";
  if (!isGroup(conv)) return "escribiendo…";
  const names = ids.map((id) => userName(id, { short: true }));
  return names.length === 1 ? `${names[0]} está escribiendo…` : `${names.join(", ")} están escribiendo…`;
}
