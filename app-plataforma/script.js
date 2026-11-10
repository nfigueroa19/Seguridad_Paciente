/* =====================================================================
   SUSANA SEGURA — interacción visual básica
   Solo muestra la sección activa del sidebar y abre/cierra el menú en móvil.
   Sin estado, almacenamiento ni lógica de negocio.
   ===================================================================== */
(function () {
  'use strict';

  var VISTA_INICIAL = 'inicio';

  var shell = document.querySelector('.shell');
  var botonMenu = document.querySelector('[data-action="menu"]');
  var enlaces = document.querySelectorAll('.sidebar-nav a');
  var vistas = document.querySelectorAll('.view');
  var crumb = document.getElementById('crumb-actual');
  var contenido = document.getElementById('content');

  /* ---------- Secciones ---------- */
  function existeVista(id) {
    return document.getElementById('view-' + id) !== null;
  }

  function mostrarVista(id, moverFoco) {
    var titulo = '';

    vistas.forEach(function (vista) {
      var activa = vista.id === 'view-' + id;
      vista.hidden = !activa;
      if (activa) titulo = vista.dataset.title;
    });

    enlaces.forEach(function (enlace) {
      var activo = enlace.getAttribute('href') === '#' + id;
      enlace.classList.toggle('active', activo);
      if (activo) enlace.setAttribute('aria-current', 'page');
      else enlace.removeAttribute('aria-current');
    });

    if (crumb) crumb.textContent = titulo;
    document.title = titulo + ' · Susana Segura';
    cerrarMenu();

    if (moverFoco) {
      window.scrollTo(0, 0);
      contenido.focus({ preventScroll: true });
    }
  }

  // Los hashes que no son secciones (p. ej. #content del enlace "Ir al contenido") no cambian la vista.
  function alCambiarHash() {
    var id = location.hash.slice(1);
    if (existeVista(id)) mostrarVista(id, true);
  }

  /* ---------- Menú móvil ---------- */
  function abrirMenu() {
    shell.classList.add('menu-open');
    botonMenu.setAttribute('aria-expanded', 'true');
    botonMenu.setAttribute('aria-label', 'Cerrar menú');
  }

  function cerrarMenu() {
    shell.classList.remove('menu-open');
    botonMenu.setAttribute('aria-expanded', 'false');
    botonMenu.setAttribute('aria-label', 'Abrir menú');
  }

  botonMenu.addEventListener('click', function () {
    if (shell.classList.contains('menu-open')) cerrarMenu();
    else abrirMenu();
  });

  document.querySelector('[data-action="close-menu"]').addEventListener('click', cerrarMenu);

  document.addEventListener('keydown', function (evento) {
    if (evento.key === 'Escape' && shell.classList.contains('menu-open')) {
      cerrarMenu();
      botonMenu.focus();
    }
  });

  /* ---------- Arranque ---------- */
  window.addEventListener('hashchange', alCambiarHash);

  var idInicial = location.hash.slice(1);
  mostrarVista(existeVista(idInicial) ? idInicial : VISTA_INICIAL, false);
})();
