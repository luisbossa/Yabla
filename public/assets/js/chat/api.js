// Endpoints del backend.
const req = Yabla.request;

const form = (data) => {
  const fd = new FormData();
  Object.entries(data).forEach(([k, v]) => v !== undefined && v !== null && fd.append(k, v));
  return fd;
};

// En Vercel los adjuntos del chat se suben directo a Vercel Blob (las peticiones no pueden pasar
// de 4,5 MB y los videos llegan a 16 MB); el mensaje solo lleva la URL del archivo.
const { blobUploads } = JSON.parse(document.getElementById("clientConfig").textContent);
let blobClient = null;

async function uploadToBlob(file) {
  blobClient ||= import("https://esm.sh/@vercel/blob@2.8.0/client");
  // "token": upload() con token fijo; "oidc": uploadPresigned() (conexión nueva de Vercel)
  const { upload, uploadPresigned } = await blobClient;
  const send = blobUploads === "oidc" ? uploadPresigned : upload;
  const name = (file.name || "archivo").normalize("NFD").replace(/[^\w.-]+/g, "-").slice(-80);
  const blob = await send(`chat/${name}`, file, { access: "public", handleUploadUrl: "/api/blob/upload", contentType: file.type || undefined }).catch((err) => {
    blobClient = null; // si falló la descarga de la librería, se reintenta la próxima vez
    throw Object.assign(new Error("No se pudo subir el archivo. Revisa tu conexión e inténtalo de nuevo."), { cause: err });
  });
  return blob.url;
}

async function withUploadedFile(data) {
  if (!blobUploads || !(data.file instanceof Blob)) return data;
  const { file, ...rest } = data;
  return { ...rest, mediaUrl: await uploadToBlob(file), fileName: file.name || undefined };
}

export const api = {
  bootstrap: () => req("/api/bootstrap"),

  // Notificaciones push de este dispositivo
  pushKey: () => req("/api/push/key"),
  pushSubscribe: (data) => req("/api/push/subscribe", { method: "POST", body: data }),
  pushUnsubscribe: (endpoint) => req("/api/push/subscribe", { method: "DELETE", body: { endpoint } }),
  pushPreview: (endpoint, preview) => req("/api/push/preview", { method: "PATCH", body: { endpoint, preview } }),
  pushTest: () => req("/api/push/test", { method: "POST" }),

  searchUsers: (q = "") => req(`/api/users?q=${encodeURIComponent(q)}`),
  toggleBlock: (userId) => req(`/api/users/${userId}/block`, { method: "POST" }),

  updateProfile: (formData) => req("/api/me", { method: "PATCH", body: formData }),
  updateSettings: (settings) => req("/api/me/settings", { method: "PATCH", body: settings }),
  changePassword: (data) => req("/api/me/password", { method: "PATCH", body: data }),
  qr: () => req("/api/me/qr"),

  openDirect: (userId) => req("/api/conversations", { method: "POST", body: { userId } }),
  conversation: (id) => req(`/api/conversations/${id}`),
  deleteConversation: (id) => req(`/api/conversations/${id}`, { method: "DELETE" }),
  createGroup: (formData) => req("/api/conversations", { method: "POST", body: formData }),
  messages: (id, before) => req(`/api/conversations/${id}/messages${before ? `?before=${before}` : ""}`),
  media: (id) => req(`/api/conversations/${id}/media`),
  send: async (id, data) => req(`/api/conversations/${id}/messages`, { method: "POST", body: form(await withUploadedFile(data)) }),
  convSettings: (id, settings) => req(`/api/conversations/${id}/settings`, { method: "PATCH", body: settings }),
  clear: (id) => req(`/api/conversations/${id}/clear`, { method: "POST" }),
  addMembers: (id, userIds) => req(`/api/conversations/${id}/members`, { method: "POST", body: { userIds } }),
  leave: (id) => req(`/api/conversations/${id}/members/me`, { method: "DELETE" }),

  editMessage: (id, text) => req(`/api/messages/${id}`, { method: "PATCH", body: { text } }),
  deleteMessage: (id) => req(`/api/messages/${id}`, { method: "DELETE" }),
  react: (id, emoji) => req(`/api/messages/${id}/reactions`, { method: "POST", body: { emoji } }),
  star: (id) => req(`/api/messages/${id}/star`, { method: "POST" }),
  starred: () => req("/api/stars"),
  searchMessages: (q) => req(`/api/search?q=${encodeURIComponent(q)}`),

  // Encuestas, ubicación y "ver una vez"
  createPoll: (id, data) => req(`/api/conversations/${id}/polls`, { method: "POST", body: data }),
  vote: (messageId, options) => req(`/api/messages/${messageId}/vote`, { method: "POST", body: { options } }),
  closePoll: (messageId) => req(`/api/messages/${messageId}/close-poll`, { method: "POST" }),
  sendLocation: (id, data) => req(`/api/conversations/${id}/location`, { method: "POST", body: data }),
  openViewOnce: (messageId) => req(`/api/messages/${messageId}/open`, { method: "POST" }),
  forward: (id, conversationIds) => req(`/api/messages/${id}/forward`, { method: "POST", body: { conversationIds } }),
  linkPreview: (url) => req(`/api/link-preview?url=${encodeURIComponent(url)}`),
  pin: (id) => req(`/api/messages/${id}/pin`, { method: "POST" }),
  messageInfo: (id) => req(`/api/messages/${id}/info`),
  hideMessages: (ids) => req("/api/messages/hide", { method: "POST", body: { ids } }),
  setDisappearing: (id, seconds) => req(`/api/conversations/${id}/disappearing`, { method: "PATCH", body: { seconds } }),
  scheduled: (id) => req(`/api/conversations/${id}/scheduled`),
  schedule: (id, data) => req(`/api/conversations/${id}/scheduled`, { method: "POST", body: data }),
  cancelScheduled: (id) => req(`/api/scheduled/${id}`, { method: "DELETE" }),
  sendScheduledNow: (id) => req(`/api/scheduled/${id}/send`, { method: "POST" }),

  stories: () => req("/api/stories"),
  createStory: (formData) => req("/api/stories", { method: "POST", body: formData }),
  viewStory: (id) => req(`/api/stories/${id}/view`, { method: "POST" }),
  storyViewers: (id) => req(`/api/stories/${id}/viewers`),
  deleteStory: (id) => req(`/api/stories/${id}`, { method: "DELETE" }),

  // Conocer (citas)
  datingOptions: () => req("/api/dating/options"),
  datingProfile: () => req("/api/dating/profile"),
  saveDatingProfile: (data) => req("/api/dating/profile", { method: "PUT", body: data }),
  uploadDatingPhotos: (files) => {
    const fd = new FormData();
    [...files].forEach((f) => fd.append("photos", f));
    return req("/api/dating/photos", { method: "POST", body: fd });
  },
  pauseDating: (paused) => req("/api/dating/profile/pause", { method: "PATCH", body: { paused } }),
  verifyDating: (file) => req("/api/dating/verify", { method: "POST", body: form({ selfie: file }) }),
  deck: (filters = {}) => req(`/api/dating/deck?${new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== undefined && v !== null && v !== false))}`),
  swipe: (toId, action) => req("/api/dating/swipe", { method: "POST", body: { toId, action } }),
  undoSwipe: () => req("/api/dating/undo", { method: "POST" }),
  datingMatches: () => req("/api/dating/matches"),
  datingLikes: () => req("/api/dating/likes"),
  unmatch: (id) => req(`/api/dating/matches/${id}`, { method: "DELETE" }),
  report: (data) => req("/api/dating/report", { method: "POST", body: data }),
  thisOrThat: (conversationId) => req(`/api/conversations/${conversationId}/this-or-that`, { method: "POST", body: {} }),
  proposeDate: (conversationId, data) => req(`/api/conversations/${conversationId}/date`, { method: "POST", body: data }),
  answer: (messageId, data) => req(`/api/messages/${messageId}/answer`, { method: "POST", body: data }),

  wallet: () => req("/api/wallet"),
  sendMoney: (data) => req("/api/wallet/send", { method: "POST", body: data }),
};
