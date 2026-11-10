/* Pantalla de ingreso. El Worker ya redirige al aplicativo si hay sesión válida,
   así que aquí solo se valida usuario y clave. */
(() => {
  'use strict';
  const f = document.getElementById('f-login');
  const errorEl = document.getElementById('error');
  const entrar = document.getElementById('entrar');
  const clave = document.getElementById('clave');
  const verClave = document.getElementById('ver-clave');

  function mostrarError(texto, campo) {
    errorEl.textContent = texto;
    errorEl.hidden = false;
    f.querySelectorAll('.entrada').forEach((e) => e.classList.remove('invalida'));
    if (campo) campo.closest('.entrada').classList.add('invalida');
  }

  verClave.addEventListener('click', () => {
    const visible = clave.type === 'text';
    clave.type = visible ? 'password' : 'text';
    verClave.textContent = visible ? 'Ver' : 'Ocultar';
    verClave.setAttribute('aria-pressed', String(!visible));
    verClave.setAttribute('aria-label', visible ? 'Mostrar la clave' : 'Ocultar la clave');
  });

  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    errorEl.hidden = true;
    const usuario = f.usuario.value.trim();
    if (!usuario) return mostrarError('Escribe tu usuario.', f.usuario);
    if (!clave.value) return mostrarError('Escribe tu clave.', clave);

    entrar.disabled = true;
    entrar.textContent = 'Verificando…';
    try {
      const r = await fetch('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ usuario, clave: clave.value }),
        credentials: 'same-origin',
      });
      let d = null;
      try { d = await r.json(); } catch { /* sin cuerpo */ }
      if (!r.ok) throw new Error((d && d.error) || 'No se pudo iniciar sesión (error ' + r.status + ').');
      location.replace('/');
    } catch (e) {
      clave.value = '';
      mostrarError(e.message, clave);
      clave.focus();
      entrar.disabled = false;
      entrar.textContent = 'Entrar';
    }
  });
})();
