const crypto = require("crypto");
const config = require("../config");
const User = require("../models/User");
const Conversation = require("../models/Conversation");
const File = require("../models/File");
const realtime = require("../services/realtime");
const live = require("./realtimeController");

exports.landing = (req, res) => {
  if (req.user) return res.redirect("/chat");
  res.render("pages/landing", { layout: false });
};

exports.chat = (req, res) => {
  // Identifica esta sesión en los avisos en vivo (p. ej. "se cerraron las otras sesiones")
  if (!req.session.tag) req.session.tag = crypto.randomBytes(12).toString("hex");
  res.render("pages/chat", {
    title: "Chats",
    styles: ["dashboard"],
    bodyClass: "is-app",
    clientConfig: {
      iceServers: config.iceServers,
      userId: req.user.id,
      sessionTag: req.session.tag,
      pusher: live.clientConfig(),
      blobUploads: config.blobMode, // "token", "oidc" o null
      uploadLimit: config.uploadLimit,
      videoUploadLimit: config.videoUploadLimit,
    },
  });
};

/** Enlace del QR de perfil: abre (o crea) el chat con ese usuario. */
exports.profileLink = async (req, res) => {
  const target = await User.findByUsername(req.params.username);
  if (!target || target.id === req.user.id) return res.redirect("/chat");

  const { id, created } = await Conversation.getOrCreateDirect(req.user.id, target.id);
  if (created) await realtime.conversation(id, [target.id]);
  else await Conversation.updateMember(id, req.user.id, { hidden: 0 });
  res.redirect(`/chat?c=${id}`);
};

/** Archivos subidos (guardados en la base de datos). */
exports.upload = async (req, res, next) => {
  const file = await File.find(req.params.id);
  if (!file) return next();
  const inline = /^(image|audio|video)\//.test(file.mime);
  const data = file.data; // Buffer (File.find)
  const total = data.length;
  res.set({
    "Content-Type": file.mime,
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=31536000, immutable",
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name || file.id)}`,
  });

  // Peticiones por partes (Range): Safari/iPhone las exige para reproducir video y permiten adelantarlo
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.get("range") || "");
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : total - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : total - 1;
    start = Math.max(0, start);
    end = Math.min(end, total - 1);
    if (start > end || start >= total) {
      res.set("Content-Range", `bytes */${total}`);
      return res.status(416).end();
    }
    res.status(206).set({ "Content-Range": `bytes ${start}-${end}/${total}`, "Content-Length": end - start + 1 });
    return res.end(data.subarray(start, end + 1));
  }
  res.set("Content-Length", total);
  res.end(data);
};
