const multer = require("multer");
const { put, del } = require("@vercel/blob");
const config = require("../config");
const File = require("../models/File");

// En memoria: el archivo se guarda después en Vercel Blob o en la base de datos (no hay disco en serverless)
const storage = multer.memoryStorage();
const limits = { fileSize: config.uploadLimit };

function onlyImages(req, file, cb) {
  if (file.mimetype.startsWith("image/") && file.mimetype !== "image/svg+xml") return cb(null, true);
  cb(Object.assign(new Error("Solo se permiten imágenes."), { status: 400 }));
}

const BLOCKED = /\.(exe|bat|cmd|com|msi|sh|ps1|js|html?|svg)$/i;
function safeFiles(req, file, cb) {
  if (BLOCKED.test(file.originalname)) return cb(Object.assign(new Error("Ese tipo de archivo no está permitido."), { status: 400 }));
  cb(null, true);
}

// Adjuntos del chat: hasta 16 MB para que quepan los videos; el controlador limita el resto a 4 MB.
// Con Vercel Blob los adjuntos no pasan por aquí: el navegador los sube directamente (ver blobController).
const chatUpload = multer({ storage, limits: { fileSize: config.videoUploadLimit }, fileFilter: safeFiles });

module.exports = {
  image: multer({ storage, limits, fileFilter: onlyImages }),
  file: multer({ storage, limits, fileFilter: safeFiles }),
  chat: {
    single(field) {
      const handler = chatUpload.single(field);
      return (req, res, next) => {
        // Mensaje de «demasiado grande» acorde a los dos límites (lo usa el errorHandler)
        req.uploadLimitMessage = `El archivo es demasiado grande: videos hasta ${config.videoUploadLimit / 1024 / 1024} MB; fotos y documentos hasta ${config.uploadLimit / 1024 / 1024} MB.`;
        handler(req, res, next);
      };
    },
  },

  BLOCKED,

  /** Guarda el archivo subido y devuelve su URL pública (o null si no hay archivo). */
  async save(file) {
    if (!file) return null;
    if (!config.blobMode) return `/uploads/${await File.save(file)}`;
    const blob = await put(`uploads/${File.newId(file.originalname)}`, file.buffer, {
      access: "public",
      contentType: file.mimetype,
      token: config.blobToken || undefined, // sin token: OIDC
    });
    return blob.url;
  },

  /** Borra un archivo subido (de Vercel Blob o de la base de datos). Las URL ajenas se ignoran. */
  async remove(url) {
    if (!url) return;
    if (url.startsWith("/uploads/")) return File.remove(url.slice("/uploads/".length));
    if (config.blobMode && /^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\//i.test(url)) {
      await del(url, { token: config.blobToken || undefined });
    }
  },
};
