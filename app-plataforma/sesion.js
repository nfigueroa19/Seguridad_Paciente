/* =====================================================================
   SUSANA SEGURA — sesión
   - Muestra quién está dentro (chip de la barra superior), cierra sesión y
     permite cambiar la propia clave.
   - Si la persona es editora o administradora, carga el modo de edición
     (edicion.js). El resto del personal nunca descarga ese código.
   - Ofrece utilidades compartidas en window.Susana (api, h, avisar, modal).
   Todo se inserta con textContent, nunca con innerHTML.
   ===================================================================== */
(function () {
  'use strict';

  var ETIQUETA_ROL = { admin: 'Administrador/a', editor: 'Editor/a', usuario: 'Personal' };

  /* ---------- Utilidades compartidas ---------- */
  function h(tag, attrs) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === false || v == null) return;
      if (k === 'class') el.className = v;
      else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var hijos = [].concat(arguments[i]);
      hijos.forEach(function (c) { if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c)); });
    }
    return el;
  }

  var temporizador;
  function avisar(texto, ok) {
    var a = document.getElementById('ss-aviso');
    if (!a) {
      a = h('div', { id: 'ss-aviso', role: 'status', 'aria-live': 'polite' });
      document.body.append(a);
    }
    a.textContent = texto;
    a.className = ok === false ? 'mal' : 'ok';
    a.hidden = false;
    clearTimeout(temporizador);
    temporizador = setTimeout(function () { a.hidden = true; }, ok === false ? 8000 : 3500);
  }

  function irAlLogin() { location.replace('/login'); }

  function api(metodo, ruta, cuerpo) {
    return fetch('/api/' + ruta, {
      method: metodo,
      headers: cuerpo ? { 'content-type': 'application/json' } : {},
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      credentials: 'same-origin'
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (datos) {
        if (r.status === 401) { irAlLogin(); throw new Error('Tu sesión terminó. Inicia sesión de nuevo.'); }
        if (!r.ok) throw new Error((datos && datos.error) || 'Error ' + r.status);
        return datos;
      });
    });
  }

  /** Ventana modal accesible (<dialog>). Esc la cierra; el fondo no, para no perder lo escrito. */
  function modal(titulo, clase) {
    var dlg = h('dialog', { class: 'ss-modal ' + (clase || ''), 'aria-label': titulo });
    var cuerpo = h('div', { class: 'ss-modal-cuerpo' });
    dlg.append(
      h('div', { class: 'ss-modal-cab' }, h('h2', {}, titulo),
        h('button', { type: 'button', class: 'ss-cerrar', 'aria-label': 'Cerrar', onclick: function () { dlg.close(); } }, '✕')),
      cuerpo);
    dlg.addEventListener('close', function () { dlg.remove(); });
    document.body.append(dlg);
    dlg.showModal();
    return { dlg: dlg, cuerpo: cuerpo, cerrar: function () { dlg.close(); } };
  }

  /** Ejecuta una acción deshabilitando el botón y mostrando el error si falla. */
  function accion(boton, fn) {
    if (boton) boton.disabled = true;
    return Promise.resolve().then(fn).catch(function (e) { avisar(e.message, false); }).then(function () {
      if (boton) boton.disabled = false;
    });
  }

  var Susana = window.Susana = { yo: null, h: h, api: api, avisar: avisar, modal: modal, accion: accion };

  /* ---------- Cambiar mi clave ---------- */
  function dialogoClave() {
    var m = modal('Cambiar mi clave', 'ss-chico');
    var actual = h('input', { type: 'password', autocomplete: 'current-password', required: true });
    var nueva = h('input', { type: 'password', autocomplete: 'new-password', minlength: 10, required: true });
    var repite = h('input', { type: 'password', autocomplete: 'new-password', required: true });
    var guardar = h('button', { class: 'btn', type: 'submit' }, 'Guardar clave');
    var form = h('form', {},
      h('label', {}, 'Clave actual', actual),
      h('label', {}, h('span', {}, 'Clave nueva ', h('small', {}, '(mínimo 10 caracteres)')), nueva),
      h('label', {}, 'Repite la clave nueva', repite),
      h('div', { class: 'ss-fila' }, guardar, h('button', { class: 'btn btn-outline', type: 'button', onclick: m.cerrar }, 'Cancelar')));
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (nueva.value !== repite.value) return avisar('Las claves nuevas no coinciden.', false);
      accion(guardar, function () {
        return api('POST', 'clave', { actual: actual.value, nueva: nueva.value }).then(function () {
          avisar('Clave cambiada. Se cerraron tus otras sesiones.');
          m.cerrar();
        });
      });
    });
    m.cuerpo.append(form);
    actual.focus();
  }

  /* ---------- Chip de usuario ---------- */
  function pintarChip(yo) {
    var avatar = document.querySelector('.user-chip-avatar');
    var nombre = document.querySelector('.user-chip-txt b');
    var rol = document.querySelector('.user-chip-txt small');
    var salir = document.querySelector('.user-chip .btn-link');
    if (avatar) avatar.textContent = yo.usuario.slice(0, 2).toUpperCase();
    if (nombre) nombre.textContent = yo.usuario;
    if (rol) rol.textContent = ETIQUETA_ROL[yo.rol] || yo.rol;
    if (salir) {
      var clave = h('button', { class: 'btn-link', type: 'button', onclick: dialogoClave }, 'Cambiar clave');
      salir.before(clave);
      salir.addEventListener('click', function () {
        api('POST', 'logout').catch(function () {}).then(irAlLogin);
      });
    }
  }

  function cargarEdicion() {
    var css = h('link', { rel: 'stylesheet', href: './edicion.css' });
    // async = false: los scripts insertados así se ejecutan en el orden en que se añaden (formato.js antes que edicion.js).
    var formato = h('script', { src: './formato.js' }); formato.async = false;
    var js = h('script', { src: './edicion.js' }); js.async = false;
    document.head.append(css);
    document.head.append(formato);
    document.head.append(js);
  }

  fetch('/api/yo', { credentials: 'same-origin', cache: 'no-store' })
    .then(function (r) {
      if (r.status === 401) { irAlLogin(); return null; }
      return r.ok ? r.json() : null;
    })
    .then(function (yo) {
      if (!yo) return;
      Susana.yo = yo;
      pintarChip(yo);
      if (yo.rol === 'admin' || yo.rol === 'editor') cargarEdicion();
    })
    .catch(function () { /* sin conexión: el aplicativo sigue mostrándose */ });
})();
