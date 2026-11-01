// Subida directa del navegador a Vercel Blob para los adjuntos del chat: Vercel no acepta
// peticiones de más de 4,5 MB y los videos llegan a 16 MB. El servidor solo firma el permiso.
const { head, issueSignedToken } = require("@vercel/blob");
const { handleUpload, handleUploadPresigned } = require("@vercel/blob/client");
const config = require("../config");
const upload = require("../middleware/upload");
const { httpError } = require("../middleware/errorHandler");

// Solo se aceptan URLs de nuestro almacén de Blob en los mensajes
const BLOB_HOST = /^[a-z0-9]+\.public\.blob\.vercel-storage\.com$/i;

function checkPathname(pathname) {
  if (!pathname.startsWith("chat/") || upload.BLOCKED.test(pathname)) throw httpError(400, "Ese tipo de archivo no está permitido.");
}

/**
 * POST /api/blob/upload: lo llama upload() (con token fijo) o uploadPresigned() (conexión OIDC)
 * de @vercel/blob/client para obtener el permiso de subida.
 */
exports.token = async (req, res) => {
  if (config.blobMode === "token") {
    const result = await handleUpload({
      body: req.body,
      request: req,
      token: config.blobToken,
      onBeforeGenerateToken: async (pathname) => {
        checkPathname(pathname);
        return { maximumSizeInBytes: config.videoUploadLimit, addRandomSuffix: true, tokenPayload: String(req.user.id) };
      },
    });
    return res.json(result);
  }
  if (config.blobMode === "oidc") {
    const result = await handleUploadPresigned({
      body: req.body,
      request: req,
      getSignedToken: async (pathname) => {
        checkPathname(pathname);
        const validUntil = Date.now() + 10 * 60 * 1000;
        const token = await issueSignedToken({ pathname, operations: ["put"], maximumSizeInBytes: config.videoUploadLimit, validUntil });
        return { token, urlOptions: { addRandomSuffix: true, maximumSizeInBytes: config.videoUploadLimit, validUntil } };
      },
    });
    return res.json(result);
  }
  throw httpError(404, "Las subidas directas no están activadas.");
};

/**
 * Datos reales de un archivo ya subido a Blob (tamaño y tipo los da Vercel, no el navegador).
 * Devuelve un objeto con la forma de multer para reutilizar la validación de los mensajes.
 */
exports.fileFromUrl = async (url, originalname) => {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw httpError(422, "Archivo no válido.");
  }
  if (!config.blobMode || parsed.protocol !== "https:" || !BLOB_HOST.test(parsed.hostname) || !parsed.pathname.startsWith("/chat/")) {
    throw httpError(422, "Archivo no válido.");
  }
  const blob = await head(url, { token: config.blobToken || undefined }).catch(() => null);
  if (!blob) throw httpError(422, "El archivo no se subió correctamente. Inténtalo de nuevo.");
  return { url: blob.url, size: blob.size, mimetype: blob.contentType || "application/octet-stream", originalname: String(originalname || blob.pathname.split("/").pop()) };
};
