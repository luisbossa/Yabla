const path = require("path");
const express = require("express");
const expressLayouts = require("express-ejs-layouts");
const config = require("./config");
const db = require("./config/database");
const sessionMiddleware = require("./config/session");
const { loadUser } = require("./middleware/auth");
const { notFound, errorHandler } = require("./middleware/errorHandler");
const viewHelpers = require("./utils/viewHelpers");
const h = require("./utils/asyncHandler");
const pages = require("./controllers/pageController");
const webRoutes = require("./routes/web");
const apiRoutes = require("./routes/api");

const app = express();

app.disable("x-powered-by");
if (config.isProduction) app.set("trust proxy", 1);

// Vistas EJS con layout
app.set("view engine", "ejs");
app.set("views", path.join(config.root, "views"));
app.use(expressLayouts);
app.set("layout", "layouts/main");
Object.assign(app.locals, viewHelpers);

// Cabeceras de seguridad básicas
app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    // Cámara, micrófono y pantalla (llamadas) y ubicación (compartir ubicación): solo la propia app
    "Permissions-Policy": "camera=(self), microphone=(self), display-capture=(self), geolocation=(self), payment=(), usb=()",
    // Otras webs abiertas desde Yabla no pueden controlar esta pestaña
    "Cross-Origin-Opener-Policy": "same-origin",
  });
  // En producción, el navegador recuerda usar siempre HTTPS
  if (config.isProduction) res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
});

// Comprobación de salud para la plataforma de despliegue (sin sesión)
app.get("/healthz", (req, res, next) => {
  db.get("SELECT 1")
    .then(() => res.json({ status: "ok", uptime: Math.round(process.uptime()) }))
    .catch(next);
});

// Archivos estáticos y subidas antiguas guardadas en la base de datos.
// En Vercel, public/ lo sirve directamente su CDN (vercel.json) y esto solo actúa en local.
// Van antes de la sesión para no consultar la tabla de sesiones en cada imagen.
app.use(
  express.static(path.join(config.root, "public"), {
    maxAge: config.isProduction ? "7d" : 0,
    setHeaders(res, filePath) {
      const name = path.basename(filePath);
      // El service worker y el manifiesto se revisan siempre: así las actualizaciones llegan enseguida
      if (name === "sw.js") res.set({ "Cache-Control": "no-cache", "Service-Worker-Allowed": "/" });
      if (name === "manifest.webmanifest") res.set({ "Content-Type": "application/manifest+json; charset=utf-8", "Cache-Control": "no-cache" });
      if (name === "offline.html") res.set("Cache-Control", "no-cache");
    },
  })
);
app.get("/uploads/:id", h(pages.upload));

// rawBody: los webhooks de Pusher se verifican con la firma del cuerpo original
app.use(express.json({ limit: "100kb", verify: (req, res, buf) => (req.rawBody = buf) }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));
app.use(sessionMiddleware);
app.use(h(loadUser));

app.use("/api", apiRoutes);
app.use("/", webRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
