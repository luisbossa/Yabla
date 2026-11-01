const express = require("express");
const auth = require("../controllers/authController");
const pages = require("../controllers/pageController");
const upload = require("../middleware/upload");
const h = require("../utils/asyncHandler");
const { requireAuth, guestOnly } = require("../middleware/auth");
const rateLimit = require("../middleware/rateLimit");

const MIN = 60 * 1000;
// Probar contraseñas: por IP (muchas cuentas desde un sitio) y por cuenta (una cuenta desde muchos sitios)
const loginLimits = [
  rateLimit({ name: "login-ip", max: 30, windowMs: 15 * MIN }),
  rateLimit({ name: "login-user", max: 10, windowMs: 15 * MIN, by: rateLimit.byLogin, message: "Demasiados intentos con esta cuenta. Espera unos minutos y vuelve a probar." }),
];
const registerLimit = rateLimit({ name: "register", max: 10, windowMs: 60 * MIN, message: "Se crearon demasiadas cuentas desde tu conexión. Inténtalo más tarde." });

const router = express.Router();

router.get("/", pages.landing);

router.get("/register", guestOnly, auth.showRegister);
router.post("/register", guestOnly, h(registerLimit), upload.image.single("avatar"), h(auth.register));
router.get("/login", guestOnly, auth.showLogin);
router.post("/login", ...loginLimits.map(h), h(auth.login));
router.post("/logout", auth.logout);
// Si se llega a /logout por GET (recargar, volver atrás, enlace) también se cierra la sesión y se va al inicio
router.get("/logout", auth.logout);

router.get("/chat", requireAuth, pages.chat);
router.get("/u/:username", requireAuth, h(pages.profileLink));

// URLs de la versión estática anterior
router.get("/index.html", (req, res) => res.redirect(301, "/"));
router.get("/pages/register.html", (req, res) => res.redirect(301, "/register"));
router.get("/pages/dashboard.html", (req, res) => res.redirect(301, "/chat"));

module.exports = router;
