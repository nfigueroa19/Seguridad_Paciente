/* Visor general de documentos (PDF, Word, Excel, PowerPoint, CSV, TXT, imágenes).
 *
 * Todo ocurre en el navegador: el archivo se descarga con la sesión del usuario y se dibuja aquí.
 * No se envía a ningún servicio externo (los visores de Google/Microsoft exigen un enlace público,
 * y estos documentos son privados). Las librerías están en vendor/ y se cargan solo al abrir
 * el primer documento de ese tipo.
 *
 * Uso: cualquier <a href="media/documentos/…"> se abre en el visor al hacer clic (clic con
 * Ctrl/Cmd o botón central conservan el comportamiento normal). También: SusanaVisor.abrir(url, titulo).
 * Formatos antiguos (.doc, .ppt) no tienen visor fiable en el navegador: se ofrece la descarga.
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
  var dlg, cuerpo, titulo, enlaceDescarga, estado, previoFoco, sesion = 0, urlsTemporales = [];

  function armar() {
    if (dlg) return;
    titulo = h('h2', { id: 'visor-titulo', class: 'visor-titulo' });
    enlaceDescarga = h('a', { class: 'btn btn-outline btn-sm visor-descarga', download: '' }, '⬇ Descargar');
    var cerrar = h('button', { type: 'button', class: 'btn btn-outline btn-sm visor-cerrar', 'aria-label': 'Cerrar visor' }, '✕ Cerrar');
    estado = h('p', { class: 'visor-estado', role: 'status', 'aria-live': 'polite' });
    cuerpo = h('div', { class: 'visor-cuerpo', tabindex: '0' });
    dlg = h('dialog', { class: 'visor', 'aria-labelledby': 'visor-titulo' }, [
      h('div', { class: 'visor-barra' }, [titulo, enlaceDescarga, cerrar]),
      estado, cuerpo
    ]);
    document.body.appendChild(dlg);
    cerrar.addEventListener('click', cerrarVisor);
    dlg.addEventListener('cancel', function (e) { e.preventDefault(); cerrarVisor(); });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) cerrarVisor(); });
  }

  function cerrarVisor() {
    sesion++;
    if (dlg && dlg.open) dlg.close();
    limpiar();
    document.documentElement.classList.remove('visor-abierto');
    if (previoFoco && previoFoco.focus) { try { previoFoco.focus(); } catch (e) { /* sin foco */ } }
  }
  function limpiar() {
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
    enlaceDescarga.href = url;
    enlaceDescarga.setAttribute('download', titulo.textContent);
    previoFoco = document.activeElement;
    if (!dlg.open) dlg.showModal();
    document.documentElement.classList.add('visor-abierto');

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
  function verPdf(buf, ext, mia) {
    pdfjs = pdfjs || import('./' + VENDOR + 'pdfjs/pdf.min.mjs').then(function (m) {
      m.GlobalWorkerOptions.workerSrc = new URL(VENDOR + 'pdfjs/pdf.worker.min.mjs', document.baseURI).href;
      return m;
    });
    return pdfjs.then(function (lib) {
      return lib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
    }).then(function (pdf) {
      if (mia !== sesion) return pdf.destroy();
      var ancho = Math.max(280, Math.min(cuerpo.clientWidth - 24, 1000));
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var marcos = [];
      var cola = Promise.resolve();
      var vistas = new IntersectionObserver(function (items) {
        items.forEach(function (it) {
          if (!it.isIntersecting) return;
          vistas.unobserve(it.target);
          cola = cola.then(function () { return pintarPagina(it.target); });
        });
      }, { root: cuerpo, rootMargin: '600px 0px' });

      function pintarPagina(marco) {
        if (mia !== sesion || marco._hecho) return;
        marco._hecho = true;
        return pdf.getPage(marco._n).then(function (pg) {
          var vp = pg.getViewport({ scale: ancho / pg.getViewport({ scale: 1 }).width });
          var lienzo = h('canvas', {});
          lienzo.width = Math.floor(vp.width * dpr); lienzo.height = Math.floor(vp.height * dpr);
          lienzo.style.width = vp.width + 'px'; lienzo.style.height = vp.height + 'px';
          marco.style.height = ''; marco.textContent = '';
          marco.append(lienzo);
          return pg.render({ canvasContext: lienzo.getContext('2d'), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise;
        }).catch(function (e) { console.error('[visor] página', marco._n, e); });
      }

      var p1 = pdf.getPage(1).then(function (pg) {
        var v = pg.getViewport({ scale: 1 });
        var alto = Math.round(ancho * v.height / v.width);
        for (var i = 1; i <= pdf.numPages; i++) {
          var m = h('div', { class: 'visor-pagina', 'aria-label': 'Página ' + i + ' de ' + pdf.numPages });
          m._n = i; m.style.width = ancho + 'px'; m.style.height = alto + 'px';
          marcos.push(m); cuerpo.append(m); vistas.observe(m);
        }
      });
      return p1;
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
      var ancho = Math.max(280, Math.min(cuerpo.clientWidth - 24, 960));
      var caja = h('div', { class: 'visor-pptx' });
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
    abrir(a.href, (a.textContent || '').replace(/^[^\p{L}\p{N}]+/u, '').trim());
  });

  window.SusanaVisor = { abrir: abrir, cerrar: cerrarVisor };
})();
