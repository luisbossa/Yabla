// Conecta el formulario de login de la landing (generado por Framer) con el backend.
// Framer vuelve a pintar el formulario al hidratar, por eso se escucha en el documento.
(() => {
  const visible = (el) => el && el.offsetParent !== null;

  function fields() {
    const pick = (name) => [...document.querySelectorAll(`input[name="${name}"]`)].find(visible);
    // El campo se llama "Email" en el diseño de Framer, pero ahora es el nombre de usuario
    return { username: pick("Email"), password: pick("Password") };
  }

  // Estilos y animaciones del aviso (la landing es de Framer y no carga base.css).
  // Arriba y centrado con márgenes (no con transform): en Safari de iPhone la barra de
  // direcciones está abajo y tapaba el aviso; con varias líneas se ve como tarjeta, no píldora.
  const TOAST_CSS = `
    #landingAuthError {
      position: fixed; left: 0; right: 0; top: max(16px, calc(env(safe-area-inset-top) + 10px)); z-index: 1000;
      display: flex; align-items: center; gap: 12px;
      width: -webkit-max-content; width: max-content; max-width: min(420px, calc(100vw - 32px));
      margin: 0 auto; padding: 12px 18px 12px 12px; box-sizing: border-box;
      border: 1px solid rgba(239, 68, 68, .22); border-radius: 18px;
      background: rgba(255, 255, 255, .94);
      -webkit-backdrop-filter: saturate(180%) blur(14px); backdrop-filter: saturate(180%) blur(14px);
      box-shadow: 0 1px 2px rgba(38, 36, 36, .06), 0 18px 40px -16px rgba(38, 36, 36, .35);
      color: #262424; text-align: left;
      font: 400 14px/1.4 Inter, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif;
      -webkit-font-smoothing: antialiased;
      pointer-events: none; will-change: transform, opacity;
    }
    #landingAuthError[hidden] { display: none; }
    #landingAuthError .lae-icon {
      display: grid; place-items: center; flex: none;
      width: 36px; height: 36px; border-radius: 12px; background: #ef4444;
      box-shadow: 0 8px 16px -8px rgba(239, 68, 68, .8);
    }
    #landingAuthError .lae-icon svg { display: block; }
    #landingAuthError .lae-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    #landingAuthError .lae-title { font-weight: 600; font-size: 14.5px; color: #262424; }
    #landingAuthError .lae-msg { color: #5f6164; font-size: 13.5px; }
    /* Entrada: baja desde arriba con un pequeño rebote; el icono "salta" */
    #landingAuthError.is-in { animation: lae-in .45s cubic-bezier(.2, .9, .3, 1.25) both; }
    #landingAuthError.is-in .lae-icon { animation: lae-pop .5s .12s cubic-bezier(.2, .9, .3, 1.4) both; }
    /* Error repetido mientras está visible: se sacude */
    #landingAuthError.is-shake { animation: lae-shake .42s ease-in-out; }
    /* Salida: sube y se desvanece */
    #landingAuthError.is-out { animation: lae-out .3s ease-in both; }
    @keyframes lae-in {
      from { opacity: 0; transform: translateY(-18px) scale(.96); }
      to { opacity: 1; transform: none; }
    }
    @keyframes lae-out {
      from { opacity: 1; transform: none; }
      to { opacity: 0; transform: translateY(-14px) scale(.97); }
    }
    @keyframes lae-pop {
      from { transform: scale(.3) rotate(-25deg); }
      to { transform: none; }
    }
    @keyframes lae-shake {
      0%, 100% { transform: none; }
      20%, 60% { transform: translateX(-8px); }
      40%, 80% { transform: translateX(8px); }
    }
    /* Campo que falta: borde rojo suave */
    @media (prefers-reduced-motion: reduce) {
      #landingAuthError.is-in, #landingAuthError.is-in .lae-icon, #landingAuthError.is-shake { animation: lae-fade .2s both; }
      #landingAuthError.is-out { animation: lae-fade .2s reverse both; }
      @keyframes lae-fade { from { opacity: 0; } to { opacity: 1; } }
    }`;

  // Mensaje de error bajo el formulario, con animación de entrada, sacudida y salida
  function showError(message, title = "No pudimos iniciar sesión") {
    let box = document.getElementById("landingAuthError");
    if (!box) {
      document.head.append(Object.assign(document.createElement("style"), { textContent: TOAST_CSS }));
      box = Object.assign(document.createElement("p"), { id: "landingAuthError", hidden: true });
      box.setAttribute("role", "alert");
      box.addEventListener("animationend", (e) => {
        if (e.animationName === "lae-out" || (e.animationName === "lae-fade" && box.classList.contains("is-out"))) box.hidden = true;
      });
      document.body.append(box);
    }
    // Icono SVG de alerta (mismo estilo que los avisos del chat), título y motivo
    box.innerHTML =
      '<span class="lae-icon">' +
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">' +
      '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg></span>' +
      '<span class="lae-text"><strong class="lae-title"></strong><span class="lae-msg"></span></span>';
    box.querySelector(".lae-title").textContent = title;
    box.querySelector(".lae-msg").textContent = message;

    // Si ya estaba visible se sacude; si no, entra
    const visible = !box.hidden && !box.classList.contains("is-out");
    box.hidden = false;
    box.classList.remove("is-in", "is-out", "is-shake");
    void box.offsetWidth; // reinicia la animación aunque se repita la misma clase
    box.classList.add(visible ? "is-shake" : "is-in");

    clearTimeout(showError.timer);
    showError.timer = setTimeout(() => {
      box.classList.remove("is-in", "is-shake");
      box.classList.add("is-out");
    }, 3500);
  }

  let sending = false;
  async function login(e) {
    e.preventDefault();
    e.stopPropagation();
    if (sending) return;

    const { username, password } = fields();
    const missing = !username?.value.trim() ? username : !password?.value ? password : null;
    if (missing) {
      const both = !username?.value.trim() && !password?.value;
      showError(both ? "Escribe tu usuario y tu contraseña." : missing === username ? "Escribe tu usuario." : "Escribe tu contraseña.", "Faltan datos");
      // Se resalta el campo que falta (aro rojo en landing-extra.css) y se pone el cursor ahí
      missing.classList.add("lae-missing");
      missing.addEventListener("input", () => missing.classList.remove("lae-missing"), { once: true });
      missing.focus({ preventScroll: true });
      return;
    }

    document.querySelectorAll(".lae-missing").forEach((el) => el.classList.remove("lae-missing"));
    sending = true;
    try {
      const res = await fetch("/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          login: username.value.trim(),
          password: password.value,
          next: new URLSearchParams(location.search).get("next") || "/chat",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "No se pudo iniciar sesión.");
      location.href = data.redirect || "/chat";
    } catch (err) {
      showError(err.message);
    } finally {
      sending = false;
    }
  }

  // Clic en el botón "Login" (es un enlace dentro del botón de Framer)
  document.addEventListener("click", (e) => {
    // El ojito de la contraseña también es un botón del formulario, pero no envía
    if (e.target.closest(".yl-eye")) return;
    if (e.target.closest('form a[href="/chat"], form button')) login(e);
  }, true);

  // Enter dentro de los campos: Framer lo maneja por su cuenta (y lleva a /thanks),
  // así que se intercepta antes en la tecla y también en el envío del formulario
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing && e.target.closest('form input[name="Email"], form input[name="Password"]')) login(e);
  }, true);
  document.addEventListener("submit", (e) => {
    if (e.target.closest("form")) login(e);
  }, true);
})();

// Ojito para ver u ocultar la contraseña del formulario de la landing.
// Framer genera (y a veces vuelve a pintar) el formulario, así que el botón se añade
// cuando aparece el campo y se recoloca si cambia el tamaño de la ventana.
(() => {
  const ICON = (name) => `<svg aria-hidden="true"><use href="/assets/images/icons.svg#i-${name}"></use></svg>`;

  // A la derecha del campo; si el botón «Entrar» está dentro del campo (escritorio), justo a su izquierda
  function place(input, eye) {
    const r = input.getBoundingClientRect();
    const submit = [...input.form?.querySelectorAll('button, [type="submit"]') || []].find((b) => {
      if (b === eye || !b.offsetParent) return false;
      const br = b.getBoundingClientRect();
      return br.left > r.left && br.left < r.right && br.top < r.bottom && br.bottom > r.top;
    });
    // Junto a «Entrar»: solo el icono, con aire antes del botón
    const sb = submit?.getBoundingClientRect();
    const size = 34;
    const right = sb ? r.right - sb.left + 16 : 10; // deja sitio para la línea divisoria
    eye.classList.toggle("is-paired", Boolean(sb));
    eye.style.width = eye.style.height = `${size}px`;
    eye.style.right = `${Math.round(right)}px`;
    input.style.paddingRight = `${Math.round(right + size + 8)}px`;
  }

  function toggle(input, eye) {
    const show = input.type === "password";
    const { selectionStart: start, selectionEnd: end } = input;
    input.type = show ? "text" : "password";
    eye.innerHTML = ICON(show ? "eye-off" : "eye");
    eye.classList.remove("is-swap");
    void eye.offsetWidth; // reinicia la animación del icono
    eye.classList.add("is-swap");
    eye.setAttribute("aria-label", show ? "Ocultar contraseña" : "Mostrar contraseña");
    eye.setAttribute("aria-pressed", String(show));
    eye.title = eye.getAttribute("aria-label");
    // Se mantiene el foco y la posición del cursor para seguir escribiendo
    input.focus();
    try { input.setSelectionRange(start, end); } catch { /* algunos tipos no lo admiten */ }
  }

  function enhance() {
    document.querySelectorAll('input[name="Password"]').forEach((input) => {
      const wrap = input.parentElement;
      let eye = wrap.querySelector(".yl-eye");
      if (!eye) {
        eye = document.createElement("button");
        eye.type = "button";
        eye.className = "yl-eye";
        eye.innerHTML = ICON("eye");
        eye.setAttribute("aria-label", "Mostrar contraseña");
        eye.setAttribute("aria-pressed", "false");
        eye.title = "Mostrar contraseña";
        // Sin esto, el clic quitaría el foco del campo antes de cambiar el tipo
        eye.addEventListener("mousedown", (e) => e.preventDefault());
        eye.addEventListener("click", () => toggle(input, eye));
        wrap.style.position = "relative";
        wrap.appendChild(eye);
      }
      if (input.offsetParent) place(input, eye);
    });
  }

  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      enhance();
    });
  };

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  addEventListener("resize", schedule);
  addEventListener("load", schedule);
  schedule();
})();
