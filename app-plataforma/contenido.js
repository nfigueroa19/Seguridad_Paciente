/* =====================================================================
   SUSANA SEGURA — contenido editable
   Pide /api/contenido y lo aplica sobre la página:
   - Los elementos con data-texto="clave" cambian su texto.
   - Los contenedores data-zona="zona" se rellenan con sus tarjetas.
   El HTML ya trae los valores por defecto: si la API no responde (sin red, o
   sitio servido sin API), la página se queda tal cual, sin errores visibles.
   Los textos con formato se insertan solo después de SusanaRico.limpiar (rico.js);
   los demás, con textContent.
   ===================================================================== */
(function () {
  'use strict';

  // rico.js se carga antes; si faltara, se cae a texto plano.
  function Rico() { return window.SusanaRico || { poner: function (el, v) { el.textContent = v; }, aTexto: function (v) { return v; } }; }

  function aplicarTextos(textos) {
    document.querySelectorAll('[data-texto]').forEach(function (el) {
      var clave = el.getAttribute('data-texto');
      if (!Object.prototype.hasOwnProperty.call(textos, clave)) return;
      // Los nombres de las secciones (barra lateral) se usan como título de página: siempre texto plano.
      if (el.hasAttribute('data-vista') || el.closest('[data-vista]')) el.textContent = Rico().aTexto(textos[clave]);
      else Rico().poner(el, textos[clave]);
    });

    // El nombre de una sección en la barra lateral también es el título de su página y el de la miga de pan.
    document.querySelectorAll('[data-vista]').forEach(function (el) {
      var vista = document.getElementById('view-' + el.getAttribute('data-vista'));
      if (!vista || !el.textContent) return;
      vista.dataset.title = el.textContent;
      if (!vista.hidden) {
        var crumb = document.getElementById('crumb-actual');
        if (crumb) crumb.textContent = el.textContent;
        document.title = el.textContent + ' · Susana Segura';
      }
    });
  }

  function crearTarjeta(t) {
    var art = document.createElement('article');
    art.className = 'module-card';

    if (t.icono) {
      var icono = document.createElement('span');
      icono.className = 'module-card-icon';
      icono.setAttribute('aria-hidden', 'true');
      icono.textContent = t.icono;
      art.appendChild(icono);
    }

    var h3 = document.createElement('h3');
    Rico().poner(h3, t.titulo);
    art.appendChild(h3);

    if (t.texto) {
      var p = document.createElement('div');
      p.className = 'module-card-texto';
      Rico().poner(p, t.texto);
      art.appendChild(p);
    }

    if (t.boton && t.enlace) {
      var a = document.createElement('a');
      a.className = 'btn btn-outline btn-sm';
      a.href = t.enlace;
      a.textContent = t.boton;
      if (/^https?:\/\//i.test(t.enlace)) {
        a.target = '_blank';
        a.rel = 'noopener';
      }
      art.appendChild(a);
    }
    return art;
  }

  function aplicarTarjetas(zonas) {
    document.querySelectorAll('[data-zona]').forEach(function (cont) {
      var zona = cont.getAttribute('data-zona');
      if (!Array.isArray(zonas[zona])) return;
      cont.replaceChildren.apply(cont, zonas[zona].map(crearTarjeta));
      // El aviso «Sección en maquetación» solo se muestra mientras la zona no tenga tarjetas.
      document.querySelectorAll('[data-vacio="' + zona + '"]').forEach(function (aviso) {
        aviso.style.display = zonas[zona].length ? 'none' : '';
      });
    });
  }

  function cargar() {
    return fetch('/api/contenido', { cache: 'no-store', credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (datos) {
        if (datos && datos.textos) aplicarTextos(datos.textos);
        // En modo edición (edicion.js) las tarjetas las pinta el editor, con las ocultas incluidas.
        if (datos && datos.tarjetas && !document.body.classList.contains('ss-editando')) aplicarTarjetas(datos.tarjetas);
      });
  }

  // edicion.js (solo editores y admins) reutiliza estas funciones.
  window.SusanaContenido = { aplicarTextos: aplicarTextos, aplicarTarjetas: aplicarTarjetas, crearTarjeta: crearTarjeta, cargar: cargar };

  cargar().catch(function () { /* se mantiene el contenido por defecto del HTML */ });
})();
