/* Visor general de documentos (PDF, Word, Excel, PowerPoint, CSV, TXT, imágenes).
 *
 * Todo ocurre en el navegador: el archivo se descarga con la sesión del usuario y se dibuja aquí.
 * No se envía a ningún servicio externo (los visores de Google/Microsoft exigen un enlace público,
 * y estos documentos son privados). Las librerías están en vendor/ y se cargan solo al abrir
 * el primer documento de ese tipo.
 *
 * Uso: cualquier <a href="media/documentos/…"> se abre en el visor al hacer clic (clic con
 * Ctrl/Cmd o botón central conservan el comportamiento normal). También: SusanaVisor.abrir(url, titulo).
 * Word y PowerPoint (.docx, .doc, .pptx, .ppt) se muestran como PDF convertido en la nube al subirlos; hasta que
 * exista ese PDF se avisa y se espera (no hay visor alterno: dibujaba mal fuentes, formas y efectos).
 */
(function () {
  'use strict';

  var VENDOR = 'vendor/';
  var MAX_FILAS = 2000;     // filas por hoja de cálculo que se dibujan
  var MAX_COLS = 60;
  var MAX_TEXTO = 1024 * 1024; // 1 MB de texto plano

  var TIPOS = {
    pdf: 'pdf', docx: 'docx', xlsx: 'hoja', xls: 'hoja', csv: 'hoja', pptx: 'pptx',
    txt: 'texto', png: 'imagen', jpg: 'imagen', jpeg: 'imagen',
    doc: 'antiguo', ppt: 'antiguo'
  };

  // Formatos que la nube convierte a PDF al subirlos (herramientas/documentos, flujo convertir-documento.yml).
  var CON_PDF = { docx: 1, doc: 1, pptx: 1, ppt: 1 };

  var cargados = {};
  function cargarScript(src) {
    if (!cargados[src]) {
      cargados[src] = new Promise(function (ok, mal) {
        var s = document.createElement('script');
        s.src = src; s.async = true;
        s.onload = ok;
        s.onerror = function () { delete cargados[src]; mal(new Error('No se pudo cargar ' + src)); };
        document.head.appendChild(s);
      });
    }
    return cargados[src];
  }

  function h(tag, attrs, hijos) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    [].concat(hijos || []).forEach(function (c) { e.append(c); });
    return e;
  }

  function extension(url) {
    var m = String(url).split(/[?#]/)[0].match(/\.([A-Za-z0-9]{1,5})$/);
    return m ? m[1].toLowerCase() : '';
  }
  function esDocumentoPrivado(a) {
    if (!a || !a.getAttribute) return false;
    var href = a.getAttribute('href') || '';
    if (/^[a-z]+:/i.test(href) && a.origin !== location.origin) return false;
    return /(^|\/)media\/documentos\//.test(a.pathname) && !!TIPOS[extension(a.pathname)];
  }

  /* ---------- Ventana ---------- */
  var herr, hBuscar, hPrev, hNext, hCuenta, hPag, hTotal, hPantalla, ctl = null;
  var dlg, cuerpo, titulo, iconoBarra, enlaceDescarga, estado, previoFoco, sesion = 0, urlsTemporales = [];

  function armar() {
    if (dlg) return;
    titulo = h('h2', { id: 'visor-titulo', class: 'visor-titulo' });
    iconoBarra = h('span', { class: 'visor-icono' });
    enlaceDescarga = h('a', { class: 'btn btn-outline btn-sm visor-descarga', download: '' }, '⬇ Descargar');
    var cerrar = h('button', { type: 'button', class: 'btn btn-outline btn-sm visor-cerrar', 'aria-label': 'Cerrar visor' }, '✕ Cerrar');
    estado = h('p', { class: 'visor-estado', role: 'status', 'aria-live': 'polite' });
    cuerpo = h('div', { class: 'visor-cuerpo', tabindex: '0' });
    hBuscar = h('input', { type: 'search', class: 'visor-buscar', placeholder: 'Buscar en el documento', 'aria-label': 'Buscar en el documento', autocomplete: 'off' });
    hPrev = h('button', { type: 'button', class: 'visor-hbtn', 'aria-label': 'Resultado anterior', title: 'Anterior (Mayús+Intro)' }, '‹');
    hNext = h('button', { type: 'button', class: 'visor-hbtn', 'aria-label': 'Resultado siguiente', title: 'Siguiente (Intro)' }, '›');
    hCuenta = h('span', { class: 'visor-cuenta', 'aria-live': 'polite' });
    hPag = h('input', { type: 'number', class: 'visor-pag', min: '1', value: '1', 'aria-label': 'Ir a la página' });
    hTotal = h('span', { class: 'visor-total' });
    hPantalla = h('button', { type: 'button', class: 'visor-hbtn visor-pantalla', 'aria-pressed': 'false', title: 'Pantalla completa' }, '⛶ Pantalla completa');
    herr = h('div', { class: 'visor-herr', role: 'toolbar', 'aria-label': 'Herramientas del documento', hidden: '' }, [
      h('div', { class: 'visor-grupo' }, [hBuscar, hPrev, hNext, hCuenta]),
      h('div', { class: 'visor-grupo' }, [h('label', {}, ['Página ', hPag, ' de ', hTotal])]),
      hPantalla
    ]);
    dlg = h('dialog', { class: 'visor', 'aria-labelledby': 'visor-titulo' }, [
      h('div', { class: 'visor-barra' }, [iconoBarra, titulo, enlaceDescarga, cerrar]),
      herr, estado, cuerpo
    ]);
    document.body.appendChild(dlg);
    hBuscar.addEventListener('input', function () { if (ctl) ctl.buscar(hBuscar.value); });
    hBuscar.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); if (ctl) ctl.siguiente(e.shiftKey ? -1 : 1); }
    });
    hPrev.addEventListener('click', function () { if (ctl) ctl.siguiente(-1); });
    hNext.addEventListener('click', function () { if (ctl) ctl.siguiente(1); });
    hPag.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); if (ctl) ctl.irA(parseInt(hPag.value, 10)); } });
    hPag.addEventListener('change', function () { if (ctl) ctl.irA(parseInt(hPag.value, 10)); });
    hPantalla.addEventListener('click', alternarPantalla);
    cuerpo.addEventListener('scroll', function () { if (ctl) ctl.alDesplazar(); });
    dlg.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f' && ctl) { e.preventDefault(); hBuscar.focus(); hBuscar.select(); }
    });
    document.addEventListener('fullscreenchange', function () {
      // Si quien mira sale de la pantalla completa del navegador (Esc), la ventana vuelve a su tamaño normal.
      if (!document.fullscreenElement && dlg._max) ponerPantalla(false);
      else if (ctl) setTimeout(ctl.reajustar, 200);
    });
    window.addEventListener('resize', function () { if (ctl) ctl.reajustarPronto(); });
    cerrar.addEventListener('click', cerrarVisor);
    dlg.addEventListener('cancel', function (e) { e.preventDefault(); cerrarVisor(); });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) cerrarVisor(); });
  }

  // Pantalla completa: la ventana ocupa toda la pantalla y, si el navegador lo permite, el navegador también entra
  // en pantalla completa (un <dialog> no se puede poner en pantalla completa por sí mismo, por eso se usa la página).
  function ponerPantalla(si) {
    dlg._max = si;
    dlg.classList.toggle('visor-max', si);
    hPantalla.setAttribute('aria-pressed', si ? 'true' : 'false');
    hPantalla.textContent = si ? '⤢ Salir de pantalla completa' : '⛶ Pantalla completa';
    if (si) {
      if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(function () { /* se queda en ventana grande */ });
      }
    } else if (document.fullscreenElement) {
      try { document.exitFullscreen(); } catch (e) { /* nada */ }
    }
    if (ctl) setTimeout(ctl.reajustar, 200);
  }
  function alternarPantalla() { ponerPantalla(!dlg._max); }

  function cerrarVisor() {
    if (dlg && dlg._max) ponerPantalla(false);
    sesion++;
    if (dlg && dlg.open) dlg.close();
    limpiar();
    document.documentElement.classList.remove('visor-abierto');
    if (previoFoco && previoFoco.focus) { try { previoFoco.focus(); } catch (e) { /* sin foco */ } }
  }
  function limpiar() {
    ctl = null;
    if (herr) { herr.hidden = true; hBuscar.value = ''; hCuenta.textContent = ''; }
    if (cuerpo) cuerpo.textContent = '';
    urlsTemporales.forEach(function (u) { URL.revokeObjectURL(u); });
    urlsTemporales = [];
  }

  function mensaje(texto, conDescarga) {
    cuerpo.textContent = '';
    estado.textContent = '';
    var caja = h('div', { class: 'visor-aviso' }, [h('p', {}, texto)]);
    if (conDescarga) {
      var a = h('a', { class: 'btn btn-sm', href: enlaceDescarga.href, download: '' }, '⬇ Descargar el archivo');
      caja.append(a);
    }
    cuerpo.append(caja);
  }

  /* ---------- Apertura ---------- */
  function abrir(url, nombre) {
    armar();
    var ext = extension(url);
    var tipo = TIPOS[ext];
    var mia = ++sesion;
    limpiar();
    titulo.textContent = nombre || decodeURIComponent(url.split(/[?#]/)[0].split('/').pop());
    iconoBarra.textContent = '';
    if (window.SusanaRico) iconoBarra.append(window.SusanaRico.iconoArchivo(url));
    enlaceDescarga.href = url;
    enlaceDescarga.setAttribute('download', titulo.textContent);
    previoFoco = document.activeElement;
    if (!dlg.open) dlg.showModal();
    document.documentElement.classList.add('visor-abierto');

    // Word y PowerPoint: se muestran SOLO como PDF (la nube convierte el original al subirlo, <archivo>.pdf).
    // El dibujo en el navegador no respeta fuentes, formas ni efectos, así que no se ofrece como alternativa:
    // mientras el PDF no existe se avisa y se vuelve a intentar solo.
    if (CON_PDF[ext]) return mostrarPdfConvertido(url, mia, 0);
    return abrirDirecto(url, ext, tipo, mia);
  }

  var ESPERA_MS = 6000, MAX_INTENTOS = 30; // hasta unos 3 minutos
  function mostrarPdfConvertido(url, mia, intento) {
    if (mia !== sesion) return;
    return fetch(url + '.pdf', { credentials: 'same-origin' }).then(function (r) {
      if (r.status === 401) throw new Error('Tu sesión terminó. Vuelve a iniciar sesión.');
      if (!r.ok || !/pdf/i.test(r.headers.get('content-type') || '')) return null;
      return r.arrayBuffer();
    }).then(function (buf) {
      if (mia !== sesion) return;
      if (!buf) {
        if (intento >= MAX_INTENTOS) {
          return mensaje('No se pudo preparar este documento para verlo. Puedes descargarlo para abrirlo. ' +
            'Si acabas de subirlo, ciérralo y ábrelo de nuevo en un momento; si sigue igual, vuelve a subirlo.', true);
        }
        if (intento === 0) mensaje('Subiendo y preparando el documento…', true);
        setTimeout(function () { mostrarPdfConvertido(url, mia, intento + 1); }, ESPERA_MS);
        return;
      }
      cuerpo.textContent = '';
      estado.textContent = 'Cargando documento…';
      return verPdf(buf, 'pdf', mia).then(function () { if (mia === sesion) estado.textContent = ''; });
    }).catch(function (e) {
      if (mia !== sesion) return;
      console.error('[visor]', e);
      mensaje((e && e.message ? e.message + ' ' : '') + 'No se pudo mostrar el documento. Puedes descargarlo para abrirlo.', true);
    });
  }

  function abrirDirecto(url, ext, tipo, mia) {
    if (!tipo) return mensaje('Este tipo de archivo no se puede mostrar aquí.', true);
    if (tipo === 'antiguo') {
      return mensaje('Los formatos antiguos de Word y PowerPoint (.' + ext + ') no se pueden mostrar en el navegador. ' +
        'Descárgalo para abrirlo, o pide que se suba como .' + (ext === 'doc' ? 'docx' : 'pptx') + ' o PDF.', true);
    }

    estado.textContent = 'Cargando documento…';
    fetch(url, { credentials: 'same-origin' }).then(function (r) {
      if (r.status === 401) throw new Error('Tu sesión terminó. Vuelve a iniciar sesión.');
      if (!r.ok) throw new Error('No se encontró el archivo (' + r.status + ').');
      return r.arrayBuffer();
    }).then(function (buf) {
      if (mia !== sesion) return;
      var f = { pdf: verPdf, docx: verDocx, hoja: verHoja, pptx: verPptx, texto: verTexto, imagen: verImagen }[tipo];
      return f(buf, ext, mia);
    }).then(function () {
      if (mia === sesion) estado.textContent = '';
    }).catch(function (e) {
      if (mia !== sesion) return;
      console.error('[visor]', e);
      mensaje((e && e.message && !/^Failed|^NetworkError/i.test(e.message) ? e.message + ' ' : '') +
        'No se pudo mostrar el documento. Puedes descargarlo para abrirlo.', true);
    });
  }

  /* ---------- PDF (PDF.js) ---------- */
  var pdfjs;
  function normalizar(t) { return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }

  function verPdf(buf, ext, mia) {
    pdfjs = pdfjs || import('./' + VENDOR + 'pdfjs/pdf.min.mjs').then(function (m) {
      m.GlobalWorkerOptions.workerSrc = new URL(VENDOR + 'pdfjs/pdf.worker.min.mjs', document.baseURI).href;
      return m;
    });
    var lib;
    return pdfjs.then(function (m) {
      lib = m;
      return lib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
    }).then(function (pdf) {
      if (mia !== sesion) return pdf.destroy();
      var n = pdf.numPages;
      var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      var ancho = 0, rel = [], marcos = [], vistas = null, paginaActual = 1;
      var textos = null, aciertos = [], idx = -1, consulta = '', temporizador = null;

      function anchoDisponible() {
        var tope = dlg._max ? 2200 : 1000;
        return Math.max(280, Math.min(cuerpo.clientWidth - 24, tope));
      }

      /* ----- Páginas: hueco con su tamaño real y dibujo perezoso (lienzo + capa de texto) ----- */
      function pintarPagina(marco) {
        if (mia !== sesion || marco._hecho) return;
        marco._hecho = true;
        var miAncho = ancho;
        return pdf.getPage(marco._n).then(function (pg) {
          if (miAncho !== ancho) return;
          var vp = pg.getViewport({ scale: ancho / pg.getViewport({ scale: 1 }).width });
          var lienzo = h('canvas', {});
          lienzo.width = Math.floor(vp.width * dpr); lienzo.height = Math.floor(vp.height * dpr);
          lienzo.style.width = vp.width + 'px'; lienzo.style.height = vp.height + 'px';
          marco.style.height = ''; marco.textContent = ''; marco.classList.remove('visor-pagina-vacia');
          marco.append(lienzo);
          var dibujo = pg.render({ canvasContext: lienzo.getContext('2d'), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise;
          // Capa de texto (transparente): permite seleccionar, copiar y resaltar los resultados de la búsqueda.
          var capa = h('div', { class: 'textLayer' });
          capa.style.setProperty('--scale-factor', String(vp.scale));
          marco.append(capa);
          var texto = new lib.TextLayer({ textContentSource: pg.streamTextContent(), container: capa, viewport: vp }).render()
            .then(function () {
              marco._capa = capa; resaltar(marco);
              if (idx >= 0 && aciertos[idx] && aciertos[idx].p === marco._n) marcarEn(aciertos[idx], marco);
            }).catch(function () { /* sin texto seleccionable */ });
          return Promise.all([dibujo, texto]);
        }).catch(function (e) { console.error('[visor] página', marco._n, e); });
      }

      function construir() {
        if (vistas) vistas.disconnect();
        cuerpo.textContent = '';
        marcos = [];
        ancho = anchoDisponible();
        vistas = new IntersectionObserver(function (items) {
          items.forEach(function (it) {
            if (!it.isIntersecting) return;
            vistas.unobserve(it.target);
            pintarPagina(it.target);
          });
        }, { root: cuerpo, rootMargin: '1500px 0px' });
        for (var i = 1; i <= n; i++) {
          var m = h('div', { class: 'visor-pagina visor-pagina-vacia', 'aria-label': 'Página ' + i + ' de ' + n }, h('span', { class: 'visor-pagina-num' }, 'Página ' + i + ' de ' + n));
          m._n = i; m.style.width = ancho + 'px'; m.style.height = Math.round(ancho * rel[i - 1]) + 'px';
          marcos.push(m); cuerpo.append(m); vistas.observe(m);
        }
        cuerpo.append(h('p', { class: 'visor-nota' }, 'Fin del documento · ' + n + (n === 1 ? ' página' : ' páginas')));
      }

      /* ----- Ir a una página y saber en cuál estoy ----- */
      function irA(p) {
        if (!(p >= 1)) { hPag.value = paginaActual; return; }
        p = Math.min(p, n);
        var m = marcos[p - 1];
        if (m) cuerpo.scrollTo({ top: m.offsetTop - 8 });
        paginaActual = p; hPag.value = p;
      }
      function alDesplazar() {
        var ref = cuerpo.scrollTop + cuerpo.clientHeight / 3, p = 1;
        for (var i = 0; i < marcos.length; i++) { if (marcos[i].offsetTop <= ref) p = i + 1; else break; }
        if (p !== paginaActual) { paginaActual = p; if (document.activeElement !== hPag) hPag.value = p; }
      }

      /* ----- Búsqueda ----- */
      function cargarTextos() {
        if (textos) return Promise.resolve(textos);
        var tareas = [];
        for (var i = 1; i <= n; i++) {
          tareas.push(pdf.getPage(i).then(function (pg) { return pg.getTextContent(); })
            .then(function (c) { return normalizar(c.items.map(function (it) { return it.str; }).join(' ')); },
              function () { return ''; }));
        }
        return Promise.all(tareas).then(function (t) { textos = t; return t; });
      }
      function resaltar(marco) {
        if (!marco._capa) return;
        var spans = marco._capa.querySelectorAll('span');
        for (var i = 0; i < spans.length; i++) {
          var s = spans[i];
          var acierto = consulta && normalizar(s.textContent).indexOf(consulta) >= 0;
          s.classList.toggle('visor-hit', !!acierto);
          s.classList.remove('visor-hit-actual');
        }
      }
      function marcarActual() {
        marcos.forEach(function (m) { if (m._capa) [].forEach.call(m._capa.querySelectorAll('.visor-hit-actual'), function (x) { x.classList.remove('visor-hit-actual'); }); });
        if (idx < 0 || !aciertos[idx]) return;
        var a = aciertos[idx];
        var m = marcos[a.p - 1];
        irA(a.p);
        // Si la página aún no está dibujada, se marca al terminar de dibujarla (ver pintarPagina).
        if (m._capa) marcarEn(a, m);
      }
      function marcarEn(a, m) {
        var hits = m._capa.querySelectorAll('.visor-hit');
        var el = hits[Math.min(a.k, hits.length - 1)];
        if (el) { el.classList.add('visor-hit-actual'); el.scrollIntoView({ block: 'center', inline: 'nearest' }); }
      }
      function actualizarCuenta() {
        if (!consulta) hCuenta.textContent = '';
        else if (!aciertos.length) hCuenta.textContent = textos && textos.every(function (t) { return !t; }) ? 'Sin texto que buscar' : 'Sin resultados';
        else hCuenta.textContent = (idx + 1) + ' de ' + aciertos.length;
      }
      function buscar(texto) {
        clearTimeout(temporizador);
        temporizador = setTimeout(function () {
          consulta = normalizar(texto.trim());
          aciertos = []; idx = -1;
          marcos.forEach(resaltar);
          if (!consulta) { actualizarCuenta(); return; }
          hCuenta.textContent = 'Buscando…';
          cargarTextos().then(function (t) {
            if (mia !== sesion || consulta !== normalizar(hBuscar.value.trim())) return;
            t.forEach(function (tx, i) {
              var k = 0, pos = tx.indexOf(consulta);
              while (pos >= 0) { aciertos.push({ p: i + 1, k: k++ }); pos = tx.indexOf(consulta, pos + consulta.length); }
            });
            marcos.forEach(resaltar);
            idx = aciertos.length ? 0 : -1;
            actualizarCuenta();
            marcarActual();
          });
        }, 250);
      }
      function siguiente(dir) {
        if (!aciertos.length) return;
        idx = (idx + dir + aciertos.length) % aciertos.length;
        actualizarCuenta(); marcarActual();
      }

      /* ----- Cambios de tamaño (pantalla completa, giro del móvil) ----- */
      function reajustar() {
        if (mia !== sesion) return;
        if (Math.abs(anchoDisponible() - ancho) < 40) return;
        var p = paginaActual;
        construir();
        irA(p);
        if (consulta) { /* los resultados se vuelven a resaltar al dibujar cada página */ }
      }
      var tRes = null;
      function reajustarPronto() { clearTimeout(tRes); tRes = setTimeout(reajustar, 250); }

      // Tamaño real de cada página (hay PDFs con páginas apaisadas), y arranque.
      var tam = [];
      for (var k = 1; k <= n; k++) tam.push(pdf.getPage(k).then(function (pg) { var v = pg.getViewport({ scale: 1 }); return v.height / v.width; }, function () { return 1.414; }));
      return Promise.all(tam).then(function (r) {
        if (mia !== sesion) return;
        rel = r;
        estado.textContent = '';
        construir();
        hTotal.textContent = String(n); hPag.max = String(n); hPag.value = '1';
        hBuscar.value = ''; hCuenta.textContent = '';
        herr.hidden = false;
        ctl = { buscar: buscar, siguiente: siguiente, irA: irA, alDesplazar: alDesplazar, reajustar: reajustar, reajustarPronto: reajustarPronto };
      });
    });
  }

  /* ---------- Word (docx-preview) ---------- */
  function verDocx(buf, ext, mia) {
    return cargarScript(VENDOR + 'docx-preview/jszip.min.js')
      .then(function () { return cargarScript(VENDOR + 'docx-preview/docx-preview.min.js'); })
      .then(function () {
        if (mia !== sesion) return;
        var hoja = h('div', { class: 'visor-docx' });
        cuerpo.append(hoja);
        return window.docx.renderAsync(buf, hoja, null, {
          inWrapper: true, ignoreWidth: false, ignoreHeight: true, breakPages: true,
          useBase64URL: true, renderHeaders: true, renderFooters: true, renderFootnotes: true
        });
      });
  }

  /* ---------- Excel / CSV (SheetJS) ---------- */
  function verHoja(buf, ext, mia) {
    return cargarScript(VENDOR + 'sheetjs/xlsx.mini.min.js').then(function () {
      if (mia !== sesion) return;
      var libro = ext === 'csv'
        ? window.XLSX.read(new TextDecoder('utf-8').decode(buf), { type: 'string', dense: true })
        : window.XLSX.read(buf, { type: 'array', dense: true, cellDates: true });
      var nombres = libro.SheetNames;
      if (!nombres.length) return mensaje('El libro no tiene hojas.', true);
      var pestanas = h('div', { class: 'visor-pestanas', role: 'tablist' });
      var zona = h('div', { class: 'visor-hoja' });
      cuerpo.append(nombres.length > 1 ? pestanas : document.createComment(''), zona);

      function mostrar(i) {
        [].forEach.call(pestanas.children, function (b, k) { b.setAttribute('aria-selected', k === i ? 'true' : 'false'); });
        zona.textContent = '';
        var filas = window.XLSX.utils.sheet_to_json(libro.Sheets[nombres[i]], { header: 1, raw: false, defval: '', blankrows: false });
        if (!filas.length) { zona.append(h('p', { class: 'visor-aviso' }, 'Esta hoja está vacía.')); return; }
        var cols = Math.min(MAX_COLS, filas.reduce(function (m, f) { return Math.max(m, f.length); }, 0));
        var tabla = h('table', { class: 'visor-tabla' });
        var cuerpoT = h('tbody');
        filas.slice(0, MAX_FILAS).forEach(function (f) {
          var tr = h('tr');
          for (var c = 0; c < cols; c++) tr.append(h('td', {}, String(f[c] == null ? '' : f[c])));
          cuerpoT.append(tr);
        });
        tabla.append(cuerpoT);
        zona.append(tabla);
        if (filas.length > MAX_FILAS) {
          zona.append(h('p', { class: 'visor-nota' }, 'Se muestran las primeras ' + MAX_FILAS + ' de ' + filas.length + ' filas. Descarga el archivo para ver el resto.'));
        }
      }
      nombres.forEach(function (n, i) {
        var b = h('button', { type: 'button', role: 'tab', 'aria-selected': 'false' }, n);
        b.addEventListener('click', function () { mostrar(i); });
        pestanas.append(b);
      });
      mostrar(0);
    });
  }

  /* ---------- PowerPoint (pptx-preview) ---------- */
  function verPptx(buf, ext, mia) {
    return cargarScript(VENDOR + 'pptx-preview/pptx-preview.umd.js').then(function () {
      if (mia !== sesion) return;
      var lib = window.pptxPreview;
      if (!lib) throw new Error('El visor de presentaciones no se cargó.');
      var ancho = Math.max(260, Math.min(cuerpo.clientWidth - 48, 960));
      var caja = h('div', { class: 'visor-pptx' });
      caja.style.width = (ancho + 20) + 'px'; // sitio para la barra de desplazamiento interna
      cuerpo.append(caja);
      var alto = Math.max(240, cuerpo.clientHeight - 24);
      var visor = lib.init(caja, { width: ancho, height: alto, mode: 'list' });
      return visor.preview(buf);
    });
  }

  /* ---------- Texto e imágenes ---------- */
  function verTexto(buf) {
    var t = new TextDecoder('utf-8').decode(buf.byteLength > MAX_TEXTO ? buf.slice(0, MAX_TEXTO) : buf);
    cuerpo.append(h('pre', { class: 'visor-texto' }, t));
    if (buf.byteLength > MAX_TEXTO) cuerpo.append(h('p', { class: 'visor-nota' }, 'Se muestra solo el primer megabyte. Descarga el archivo para verlo completo.'));
  }
  function verImagen(buf, ext) {
    var url = URL.createObjectURL(new Blob([buf], { type: ext === 'png' ? 'image/png' : 'image/jpeg' }));
    urlsTemporales.push(url);
    cuerpo.append(h('img', { class: 'visor-imagen', src: url, alt: titulo.textContent }));
  }

  /* ---------- Enganche global ---------- */
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || a.hasAttribute('download') || !esDocumentoPrivado(a)) return;
    e.preventDefault();
    var copia = a.cloneNode(true);
    [].forEach.call(copia.querySelectorAll('.ss-tipo'), function (n) { n.remove(); });
    abrir(a.href, (copia.textContent || '').replace(/^[^\p{L}\p{N}]+/u, '').trim());
  });

  window.SusanaVisor = { abrir: abrir, cerrar: cerrarVisor };
})();
