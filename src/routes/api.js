const express = require("express");
const auth = require("../controllers/authController");
const users = require("../controllers/userController");
const conversations = require("../controllers/conversationController");
const messages = require("../controllers/messageController");
const stories = require("../controllers/storyController");
const wallet = require("../controllers/walletController");
const dating = require("../controllers/datingController");
const push = require("../controllers/pushController");
const live = require("../controllers/realtimeController");
const calls = require("../controllers/callController");
const blob = require("../controllers/blobController");
const cron = require("../controllers/cronController");
const special = require("../controllers/specialMessageController");
const upload = require("../middleware/upload");
const h = require("../utils/asyncHandler");
const { requireApiAuth } = require("../middleware/auth");
const rateLimit = require("../middleware/rateLimit");

const MIN = 60 * 1000;
// Límites por usuario (o por IP sin sesión) contra abusos: spam, fuerza bruta y peticiones costosas
const limit = (name, max, windowMs = MIN, by = rateLimit.byUser) => h(rateLimit({ name, max, windowMs, by }));

const router = express.Router();

// Pública: disponibilidad del nombre de usuario durante el registro
router.get("/username-available", limit("username-check", 60, MIN, (req) => req.ip), h(auth.checkUsername));

// Sin sesión: los llaman Pusher (firma propia) y el cron externo (CRON_SECRET)
router.post("/realtime/webhook", h(live.webhook));
router.get("/cron/tick", h(cron.tick));

router.use(requireApiAuth);

// Tiempo real (Pusher): permisos de canales y avisos que antes iban por Socket.IO
router.post("/realtime/auth", h(live.auth));
router.post("/realtime/hello", h(live.hello));
router.post("/realtime/typing", h(live.typing));
router.post("/realtime/receipt", h(live.receipt));
router.post("/realtime/visibility", h(live.visibility));

// Llamadas (la señalización WebRTC va directa entre navegadores por Pusher)
router.post("/calls", limit("call", 20), h(calls.invite));
router.post("/calls/:id/accept", h(calls.accept));
router.post("/calls/:id/reject", h(calls.reject));
router.post("/calls/:id/end", h(calls.end));
router.post("/calls/:id/timeout", h(calls.timeout));

// Subida directa de adjuntos a Vercel Blob
router.post("/blob/upload", limit("upload", 40), h(blob.token));

// Usuario actual
router.get("/bootstrap", h(users.bootstrap));
router.patch("/me", upload.image.single("avatar"), h(users.updateProfile));
router.patch("/me/settings", h(users.updateSettings));
router.patch("/me/password", limit("password", 10, 15 * MIN), h(users.changePassword));
router.get("/me/qr", h(users.qr));

// Notificaciones push de este dispositivo
router.get("/push/key", h(push.key));
router.post("/push/subscribe", h(push.subscribe));
router.delete("/push/subscribe", h(push.unsubscribe));
router.patch("/push/preview", h(push.preview));
router.post("/push/test", h(push.test));
router.post("/conversations/:id/read", h(push.markRead));

// Usuarios
router.get("/users", h(users.search));
router.post("/users/:id/block", h(users.toggleBlock));

// Conversaciones
router.post("/conversations", upload.image.single("avatar"), h(conversations.create));
router.use("/conversations/:id", h(conversations.loadMembership));
router.get("/conversations/:id", h(conversations.show));
router.delete("/conversations/:id", h(conversations.remove));
router.get("/conversations/:id/messages", h(conversations.messages));
router.post("/conversations/:id/messages", limit("send", 120), upload.chat.single("file"), h(conversations.send));
router.get("/conversations/:id/media", h(conversations.media));
router.get("/conversations/:id/export", limit("export", 10), h(conversations.exportChat));
router.post("/conversations/:id/polls", limit("send", 120), h(special.createPoll));
router.post("/conversations/:id/location", limit("send", 120), h(special.sendLocation));
router.patch("/conversations/:id", upload.image.single("avatar"), h(conversations.updateGroup));
router.patch("/conversations/:id/settings", h(conversations.updateSettings));
router.post("/conversations/:id/clear", h(conversations.clear));
router.patch("/conversations/:id/disappearing", h(conversations.updateDisappearing));
router.get("/conversations/:id/scheduled", h(conversations.scheduled));
router.post("/conversations/:id/scheduled", h(conversations.schedule));
router.post("/conversations/:id/members", h(conversations.addMembers));
router.post("/conversations/:id/this-or-that", h(dating.thisOrThat));
router.post("/conversations/:id/date", h(dating.proposeDate));
router.delete("/conversations/:id/members/me", h(conversations.leave));

// Mensajes
router.get("/stars", h(messages.starred));
router.get("/search", limit("search", 60), h(messages.search));
router.get("/link-preview", limit("link-preview", 60), h(messages.linkPreview));
router.post("/messages/hide", h(messages.hide));
router.delete("/scheduled/:id", h(messages.cancelScheduled));
router.post("/scheduled/:id/send", h(messages.sendScheduledNow));
router.use("/messages/:id", h(messages.load));
router.patch("/messages/:id", h(messages.edit));
router.delete("/messages/:id", h(messages.remove));
router.post("/messages/:id/reactions", h(messages.react));
router.post("/messages/:id/star", h(messages.star));
router.post("/messages/:id/forward", h(messages.forward));
router.post("/messages/:id/pin", h(messages.pin));
router.post("/messages/:id/answer", h(dating.answer));
router.post("/messages/:id/vote", limit("vote", 60), h(special.vote));
router.post("/messages/:id/close-poll", h(special.closePoll));
router.post("/messages/:id/open", h(special.openViewOnce));
router.get("/messages/:id/info", h(messages.info));

// Estados
router.get("/stories", h(stories.feed));
router.post("/stories", upload.image.single("media"), h(stories.create));
router.post("/stories/:id/view", h(stories.view));
router.get("/stories/:id/viewers", h(stories.viewers));
router.delete("/stories/:id", h(stories.remove));

// Conocer (citas)
router.get("/dating/options", h(dating.options));
router.get("/dating/profile", h(dating.profile));
router.put("/dating/profile", h(dating.saveProfile));
router.post("/dating/photos", upload.image.array("photos", 6), h(dating.uploadPhotos));
router.patch("/dating/profile/pause", h(dating.setPaused));
router.post("/dating/verify", upload.image.single("selfie"), h(dating.verify));
router.get("/dating/deck", h(dating.deck));
router.post("/dating/swipe", h(dating.swipe));
router.post("/dating/undo", h(dating.undo));
router.get("/dating/matches", h(dating.matches));
router.get("/dating/likes", h(dating.likes));
router.delete("/dating/matches/:id", h(dating.unmatch));
router.post("/dating/report", h(dating.report));

// Billetera
router.get("/wallet", h(wallet.show));
router.post("/wallet/send", limit("wallet", 20), h(wallet.send));

module.exports = router;
