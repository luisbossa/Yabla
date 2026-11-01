// Controles comunes de las pantallas de acceso: tema y mostrar contraseña.
(() => {
  const setIcon = (btn, name) => btn.querySelector("use").setAttribute("href", `/assets/images/icons.svg#i-${name}`);

  document.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
    const sync = () => setIcon(btn, Yabla.getTheme() === "dark" ? "sun" : "moon");
    btn.addEventListener("click", () => {
      Yabla.toggleTheme();
      sync();
    });
    sync();
  });

  document.querySelectorAll(".toggle-password").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = document.getElementById(btn.dataset.target);
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      setIcon(btn, show ? "eye-off" : "eye");
      btn.setAttribute("aria-label", show ? "Ocultar contraseña" : "Mostrar contraseña");
      btn.classList.remove("is-swapping");
      void btn.offsetWidth; // reinicia la animación del icono
      btn.classList.add("is-swapping");
    });
  });

  // Formularios que recargan la página (iniciar sesión): el botón muestra que está enviando
  // y no se puede pulsar dos veces. Si el navegador bloquea el envío (campo vacío), no llega aquí.
  document.querySelectorAll('form[method="post"]').forEach((form) => {
    form.addEventListener("submit", () => {
      const submit = form.querySelector('[type="submit"]');
      submit?.classList.add("is-pending");
      submit?.setAttribute("aria-busy", "true");
    });
  });
  // Al volver atrás, el navegador puede mostrar la página tal como quedó: se quita el estado de envío
  window.addEventListener("pageshow", () => {
    document.querySelectorAll(".btn.is-pending").forEach((b) => {
      b.classList.remove("is-pending");
      b.removeAttribute("aria-busy");
    });
  });
})();
