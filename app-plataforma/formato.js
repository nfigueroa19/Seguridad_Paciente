/* =====================================================================
   SUSANA SEGURA — barra de formato de texto (solo editores y administradores)
   La carga sesion.js antes de edicion.js. Estilo Word / Google Docs:
     SusanaFormato.activar(el, { linea: true })  → el texto de `el` se edita con formato
     SusanaFormato.desactivar(el)
     SusanaFormato.valor(el)                      → HTML limpio listo para guardar
     SusanaFormato.enLista(el)                    → ¿el cursor está en una lista?
   Mientras el campo tiene el cursor aparece una barra con: tamaño (− 16 +), negrita,
   cursiva, subrayado, tachado, color del texto y resaltado (paletas fijas), alineación,
   viñetas, lista numerada, enlace y quitar formato.
   Se apoya en document.execCommand: en desuso en el estándar, pero lo mantienen todos
   los navegadores y no hay otra forma sencilla de editar así.
   Lo que se guarda pasa por SusanaRico.limpiar (ver rico.js).
   ===================================================================== */
(function () {
  'use strict';

  var Rico = window.SusanaRico;
  if (!Rico) return;

  var TAMANOS = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72, 96];
  var TEXTO_NORMAL = '#1F2A24';

  // Paleta estilo Google Docs, con los colores de la plataforma en la primera fila.
  var PALETA = [
    ['#2E7D5B', '#1F5C41', '#3F9E77', '#F2994A', '#D9782E', '#D64545', '#1F2A24', '#52605A'],
    ['#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff'],
    ['#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff', '#9900ff', '#ff00ff'],
    ['#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc'],
    ['#dd7e6b', '#ea9999', '#f9cb9c', '#ffe599', '#b6d7a8', '#a2c4c9', '#a4c2f4', '#9fc5e8', '#b4a7d6', '#d5a6bd'],
    ['#cc4125', '#e06666', '#f6b26b', '#ffd966', '#93c47d', '#76a5af', '#6d9eeb', '#6fa8dc', '#8e7cc3', '#c27ba0'],
    ['#a61c00', '#cc0000', '#e69138', '#f1c232', '#6aa84f', '#45818e', '#3c78d8', '#3d85c6', '#674ea7', '#a64d79'],
    ['#85200c', '#990000', '#b45f06', '#bf9000', '#38761d', '#134f5c', '#1155cc', '#0b5394', '#351c75', '#741b47']
  ];

  function h(tag, attrs) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) if (arguments[i] != null) e.append(arguments[i]);
    return e;
  }

  // Iconos sencillos hechos con líneas (texto fijo, no viene de datos del usuario).
  function svg(contenido) {
    var s = document.createElement('span');
    s.className = 'ss-fb-ico';
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = '<svg viewBox="0 0 18 18" width="18" height="18" fill="currentColor">' + contenido + '</svg>';
    return s;
  }
  function lineas(lista) {
    return lista.map(function (l) { return '<rect x="' + l[0] + '" y="' + l[1] + '" width="' + l[2] + '" height="1.6" rx=".8"/>'; }).join('');
  }
  var ICONOS = {
    izq: lineas([[2, 3, 14], [2, 7, 9], [2, 11, 14], [2, 15, 9]]),
    centro: lineas([[2, 3, 14], [4.5, 7, 9], [2, 11, 14], [4.5, 15, 9]]),
    der: lineas([[2, 3, 14], [7, 7, 9], [2, 11, 14], [7, 15, 9]]),
    justif: lineas([[2, 3, 14], [2, 7, 14], [2, 11, 14], [2, 15, 14]]),
    vinetas: '<circle cx="3.4" cy="4" r="1.5"/><circle cx="3.4" cy="9" r="1.5"/><circle cx="3.4" cy="14" r="1.5"/>' + lineas([[7, 3.2, 9], [7, 8.2, 9], [7, 13.2, 9]]),
    numerada: '<text x="1.2" y="5.6" font-size="5.2" font-family="Arial">1</text><text x="1.2" y="10.6" font-size="5.2" font-family="Arial">2</text><text x="1.2" y="15.6" font-size="5.2" font-family="Arial">3</text>' + lineas([[7, 3.2, 9], [7, 8.2, 9], [7, 13.2, 9]]),
    enlace: '<g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M7.5 10.5l3-3"/><path d="M8.2 5.6l1-1a2.8 2.8 0 0 1 4 4l-1 1"/><path d="M9.8 12.4l-1 1a2.8 2.8 0 0 1-4-4l1-1"/></g>',
    borrar: '<g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 4h10M9 4v8"/><path d="M3 15l12-12"/></g>'
  };

  var barra = null, activo = null, guardado = null, ocultarT = null, paletaAbierta = null;
  var botones = {};
  var tamano, filaEnlace, urlEnlace, grupoLista, ultimoColor = '#D64545', ultimoResalte = '#ffff00';
  var barraColor, barraResalte;

  /* ---------- Selección ---------- */
  function guardarSeleccion() {
    var sel = window.getSelection();
    if (activo && sel.rangeCount && activo.contains(sel.anchorNode)) guardado = sel.getRangeAt(0).cloneRange();
  }
  function restaurar() {
    if (!activo) return false;
    activo.focus({ preventScroll: true });
    if (guardado) {
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(guardado);
    }
    return true;
  }
  function hayTextoSeleccionado() { return !!(guardado && !guardado.collapsed); }

  function aviso(texto) { if (window.Susana && window.Susana.avisar) window.Susana.avisar(texto, false); }

  /* ---------- Órdenes ---------- */
  function ejecutar(nombre, valor, conCss) {
    if (!restaurar()) return;
    document.execCommand('styleWithCSS', false, !!conCss);
    document.execCommand(nombre, false, valor == null ? null : valor);
    guardarSeleccion();
    actualizarEstado();
  }

  function aplicarTamano(px) {
    if (!restaurar()) return;
    if (!hayTextoSeleccionado()) { aviso('Selecciona primero el texto al que quieres cambiarle el tamaño.'); return; }
    document.execCommand('styleWithCSS', false, false);
    document.execCommand('fontSize', false, '7');
    // fontSize solo admite 1–7: se reemplazan las etiquetas <font> por un tamaño exacto en px.
    var nuevos = [];
    activo.querySelectorAll('font[size="7"], span[style*="xxx-large"]').forEach(function (f) {
      var s = document.createElement('span');
      nuevos.push(s);
      s.style.fontSize = px + 'px';
      while (f.firstChild) s.appendChild(f.firstChild);
      s.querySelectorAll('span[style*="font-size"]').forEach(function (hijo) {
        hijo.style.fontSize = '';
        if (!hijo.getAttribute('style')) hijo.replaceWith.apply(hijo, [].slice.call(hijo.childNodes));
      });
      f.replaceWith(s);
    });
    tamano.value = String(px);
    // El texto sigue seleccionado, para poder pulsar «+» o «−» varias veces seguidas.
    if (nuevos.length) {
      var rango = document.createRange();
      rango.setStartBefore(nuevos[0]);
      rango.setEndAfter(nuevos[nuevos.length - 1]);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(rango);
    }
    guardarSeleccion();
    actualizarEstado();
  }
  function pasoTamano(dir) {
    var actual = parseInt(tamano.value, 10) || 16;
    var nuevo = actual;
    if (dir > 0) {
      for (var i = 0; i < TAMANOS.length; i++) if (TAMANOS[i] > actual) { nuevo = TAMANOS[i]; break; }
      if (nuevo === actual) nuevo = Math.min(200, actual + 4);
    } else {
      for (var j = TAMANOS.length - 1; j >= 0; j--) if (TAMANOS[j] < actual) { nuevo = TAMANOS[j]; break; }
      if (nuevo === actual) nuevo = Math.max(6, actual - 1);
    }
    aplicarTamano(nuevo);
  }

  function aplicarColor(tipo, valor) {
    if (tipo === 'color') { ultimoColor = valor; barraColor.style.background = valor; ejecutar('foreColor', valor, true); }
    else { ultimoResalte = valor; barraResalte.style.background = valor === 'transparent' ? '#ffff00' : valor; ejecutar('hiliteColor', valor, true); }
  }

  function aplicarEnlace() {
    var url = urlEnlace.value.trim();
    if (!url) return;
    if (!/^(https?:|mailto:|tel:|#|media\/)/i.test(url)) url = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(url) ? 'mailto:' + url : 'https://' + url;
    if (!Rico.ENLACE.test(url)) { aviso('Esa dirección no es válida. Usa https://…, un correo o #sección.'); return; }
    if (!hayTextoSeleccionado()) {
      restaurar();
      document.execCommand('insertHTML', false, '<a href="' + url.replace(/"/g, '%22') + '">' + url.replace(/[<>&]/g, '') + '</a>');
    } else {
      ejecutar('createLink', url);
    }
    cerrarEnlace();
  }
  function abrirEnlace() {
    cerrarPaleta();
    guardarSeleccion();
    var a = guardado && guardado.commonAncestorContainer;
    a = a && (a.nodeType === 1 ? a : a.parentElement);
    a = a && a.closest && a.closest('a');
    urlEnlace.value = a ? a.getAttribute('href') : '';
    filaEnlace.hidden = false;
    urlEnlace.focus();
  }
  function cerrarEnlace() {
    filaEnlace.hidden = true;
    restaurar();
    posicionar();
  }

  /* ---------- Paletas ---------- */
  function cerrarPaleta() {
    if (paletaAbierta) { paletaAbierta.hidden = true; paletaAbierta = null; }
  }
  function crearPaleta(tipo) {
    var caja = h('div', { class: 'ss-fb-paleta', role: 'dialog', 'aria-label': tipo === 'color' ? 'Color del texto' : 'Color de resaltado', hidden: '' });
    var auto = h('button', { type: 'button', class: 'ss-fb-auto' }, tipo === 'color' ? 'Color normal' : 'Sin resaltado');
    auto.addEventListener('click', function () { aplicarColor(tipo, tipo === 'color' ? TEXTO_NORMAL : 'transparent'); cerrarPaleta(); });
    caja.append(auto);
    PALETA.forEach(function (fila, i) {
      if (i === 0) caja.append(h('div', { class: 'ss-fb-rotulo' }, 'Colores de la plataforma'));
      if (i === 1) caja.append(h('div', { class: 'ss-fb-rotulo' }, 'Más colores'));
      var f = h('div', { class: 'ss-fb-gama' });
      fila.forEach(function (c) {
        var b = h('button', { type: 'button', class: 'ss-fb-muestra', title: c, 'aria-label': 'Color ' + c });
        b.style.background = c;
        b.addEventListener('click', function () { aplicarColor(tipo, c); cerrarPaleta(); });
        f.append(b);
      });
      caja.append(f);
    });
    return caja;
  }
  function alternarPaleta(caja, ancla) {
    var abrir = caja.hidden;
    cerrarPaleta();
    if (!abrir) return;
    guardarSeleccion();
    caja.hidden = false;
    paletaAbierta = caja;
    var r = ancla.getBoundingClientRect(), b = barra.getBoundingClientRect();
    caja.style.left = Math.max(0, Math.min(r.left - b.left, b.width - caja.offsetWidth)) + 'px';
    var abajo = b.bottom + caja.offsetHeight + 8 <= window.innerHeight;
    caja.style.top = abajo ? (b.height + 6) + 'px' : (-caja.offsetHeight - 6) + 'px';
  }

  /* ---------- La barra ---------- */
  function boton(clave, contenido, titulo, fn, extraClase) {
    var b = h('button', { type: 'button', class: 'ss-fb-btn' + (extraClase ? ' ' + extraClase : ''), title: titulo, 'aria-label': titulo, 'aria-pressed': 'false' }, contenido);
    b.addEventListener('mousedown', function (ev) { ev.preventDefault(); }); // el clic no le quita la selección al texto
    b.addEventListener('click', function (ev) { ev.preventDefault(); if (clave !== 'color' && clave !== 'resalte') cerrarPaleta(); fn(); });
    botones[clave] = b;
    return b;
  }
  function sep() { return h('span', { class: 'ss-fb-sep' }); }

  function crearBarra() {
    if (barra) return;

    var menos = boton('menos', '−', 'Reducir tamaño de letra', function () { pasoTamano(-1); }, 'ss-fb-paso');
    var mas = boton('mas', '+', 'Aumentar tamaño de letra', function () { pasoTamano(1); }, 'ss-fb-paso');
    tamano = h('input', { type: 'text', inputmode: 'numeric', class: 'ss-fb-tam', title: 'Tamaño de letra', 'aria-label': 'Tamaño de letra', value: '16', maxlength: '3' });
    tamano.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        var n = parseInt(tamano.value, 10);
        if (n >= 6 && n <= 200) aplicarTamano(n); else aviso('Escribe un tamaño entre 6 y 200.');
      } else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); restaurar(); }
    });

    barraColor = h('span', { class: 'ss-fb-tira' }); barraColor.style.background = ultimoColor;
    barraResalte = h('span', { class: 'ss-fb-tira' }); barraResalte.style.background = ultimoResalte;
    var paletaColor = crearPaleta('color'), paletaResalte = crearPaleta('resalte');
    var bColor = boton('color', h('span', { class: 'ss-fb-letra' }, 'A'), 'Color del texto', function () { alternarPaleta(paletaColor, bColor); });
    bColor.append(barraColor);
    var bResalte = boton('resalte', h('span', { class: 'ss-fb-letra ss-fb-marca' }, 'ab'), 'Color de resaltado', function () { alternarPaleta(paletaResalte, bResalte); });
    bResalte.append(barraResalte);

    urlEnlace = h('input', { type: 'text', class: 'ss-fb-url', placeholder: 'https://… o correo o #seccion', 'aria-label': 'Dirección del enlace', maxlength: '500' });
    urlEnlace.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); aplicarEnlace(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); cerrarEnlace(); }
    });
    filaEnlace = h('div', { class: 'ss-fb-fila ss-fb-fila-enlace', hidden: '' },
      urlEnlace,
      h('button', { type: 'button', class: 'ss-fb-btn ss-fb-texto', onclick: aplicarEnlace }, 'Aplicar'),
      h('button', { type: 'button', class: 'ss-fb-btn ss-fb-texto', onclick: function () { ejecutar('unlink'); cerrarEnlace(); } }, 'Quitar enlace'),
      h('button', { type: 'button', class: 'ss-fb-btn ss-fb-texto', onclick: cerrarEnlace }, 'Cancelar'));

    grupoLista = [
      boton('ul', svg(ICONOS.vinetas), 'Lista con viñetas', function () { ejecutar('insertUnorderedList'); }),
      boton('ol', svg(ICONOS.numerada), 'Lista numerada', function () { ejecutar('insertOrderedList'); })
    ];

    var fila = h('div', { class: 'ss-fb-fila' },
      menos, tamano, mas, sep(),
      boton('bold', 'B', 'Negrita (Ctrl+B)', function () { ejecutar('bold'); }, 'ss-fb-n'),
      boton('italic', 'I', 'Cursiva (Ctrl+I)', function () { ejecutar('italic'); }, 'ss-fb-k'),
      boton('underline', 'U', 'Subrayado (Ctrl+U)', function () { ejecutar('underline'); }, 'ss-fb-s'),
      boton('strikeThrough', 'S', 'Tachado', function () { ejecutar('strikeThrough'); }, 'ss-fb-t'),
      bColor, bResalte, sep(),
      boton('justifyLeft', svg(ICONOS.izq), 'Alinear a la izquierda', function () { ejecutar('justifyLeft', null, true); }),
      boton('justifyCenter', svg(ICONOS.centro), 'Centrar', function () { ejecutar('justifyCenter', null, true); }),
      boton('justifyRight', svg(ICONOS.der), 'Alinear a la derecha', function () { ejecutar('justifyRight', null, true); }),
      boton('justifyFull', svg(ICONOS.justif), 'Justificar', function () { ejecutar('justifyFull', null, true); }),
      sep(), grupoLista[0], grupoLista[1], sep(),
      boton('link', svg(ICONOS.enlace), 'Insertar enlace', abrirEnlace),
      boton('clear', svg(ICONOS.borrar), 'Borrar formato', function () { ejecutar('removeFormat'); ejecutar('unlink'); }));

    barra = h('div', { class: 'ss-formato', role: 'toolbar', 'aria-label': 'Formato del texto', hidden: '' }, fila, filaEnlace, paletaColor, paletaResalte);
    // Pulsar en la barra no debe quitarle el foco al campo (salvo en sus propios campos de texto).
    barra.addEventListener('mousedown', function (ev) { if (!ev.target.closest('input')) ev.preventDefault(); });
    barra.addEventListener('focusin', function () { clearTimeout(ocultarT); });
    barra.addEventListener('focusout', function (ev) { if (!barra.contains(ev.relatedTarget) && ev.relatedTarget !== activo) programarOcultar(); });
    document.body.append(barra);
    document.addEventListener('mousedown', function (ev) { if (paletaAbierta && !paletaAbierta.contains(ev.target) && !ev.target.closest('.ss-fb-btn')) cerrarPaleta(); });
    // Si el campo desaparece (se guardó o cerró el editor), la barra se esconde sola.
    setInterval(function () {
      if (barra.hidden) return;
      if (!activo || !activo.isConnected || !activo._formato) ocultarYa();
    }, 400);
    window.addEventListener('scroll', posicionar, true);
    window.addEventListener('resize', posicionar);
  }

  function ocultarYa() {
    if (barra) barra.hidden = true;
    cerrarPaleta();
    activo = null; guardado = null;
  }

  // Si el cursor entra en un campo con formato, aparece la barra (aunque el foco del navegador no avise).
  document.addEventListener('selectionchange', function () {
    var sel = window.getSelection();
    var n = sel.rangeCount ? sel.anchorNode : null;
    n = n && (n.nodeType === 1 ? n : n.parentElement);
    var campo = n && n.closest && n.closest('.ss-rico');
    if (campo && campo._formato && campo !== activo) mostrar(campo);
    if (activo && (!activo.isConnected || !activo._formato)) ocultarYa();
    if (activo) { guardarSeleccion(); actualizarEstado(); }
  });

  function posicionar() {
    if (!barra || barra.hidden || !activo) return;
    var r = activo.getBoundingClientRect();
    var alto = barra.offsetHeight, ancho = barra.offsetWidth;
    var arriba = r.top - alto - 8;
    barra.style.left = Math.max(8, Math.min(r.left, window.innerWidth - ancho - 8)) + 'px';
    barra.style.top = (arriba >= 8 ? arriba : Math.min(r.bottom + 8, window.innerHeight - alto - 8)) + 'px';
  }

  function actualizarEstado() {
    if (!barra || barra.hidden) return;
    ['bold', 'italic', 'underline', 'strikeThrough', 'justifyLeft', 'justifyCenter', 'justifyRight', 'justifyFull'].forEach(function (c) {
      var on = false;
      try { on = document.queryCommandState(c); } catch (e) { /* sin estado */ }
      botones[c].setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    var ul = false, ol = false;
    var nodo = guardado && guardado.commonAncestorContainer;
    nodo = nodo && (nodo.nodeType === 1 ? nodo : nodo.parentElement);
    var dentro = !!(nodo && activo && activo.contains(nodo));
    if (dentro) { ul = !!nodo.closest('ul'); ol = !!nodo.closest('ol'); }
    botones.ul.setAttribute('aria-pressed', ul ? 'true' : 'false');
    botones.ol.setAttribute('aria-pressed', ol ? 'true' : 'false');
    botones.link.setAttribute('aria-pressed', dentro && nodo.closest('a') ? 'true' : 'false');
    if (dentro && document.activeElement !== tamano) {
      // El tamaño que se muestra es el del primer carácter de la selección.
      var ini = guardado.startContainer;
      if (ini.nodeType === 1 && ini.childNodes[guardado.startOffset]) ini = ini.childNodes[guardado.startOffset];
      ini = ini.nodeType === 1 ? ini : ini.parentElement;
      var px = ini && Math.round(parseFloat(getComputedStyle(ini).fontSize));
      if (px) tamano.value = String(px);
    }
  }

  function mostrar(el) {
    crearBarra();
    clearTimeout(ocultarT);
    activo = el;
    var linea = !!(el._formato && el._formato.linea);
    grupoLista.forEach(function (b) { b.hidden = linea; });
    barra.hidden = false;
    filaEnlace.hidden = true;
    cerrarPaleta();
    posicionar();
    actualizarEstado();
  }
  function programarOcultar() {
    clearTimeout(ocultarT);
    ocultarT = setTimeout(function () {
      var f = document.activeElement;
      if (barra && (barra.contains(f) || f === activo)) return;
      ocultarYa();
    }, 180);
  }

  /* ---------- Campos ---------- */
  function alPegar(ev) {
    var el = ev.currentTarget;
    ev.preventDefault();
    var datos = ev.clipboardData || window.clipboardData;
    var html = datos.getData('text/html');
    if (html && !(el._formato && el._formato.linea)) {
      document.execCommand('insertHTML', false, Rico.limpiar(html));
    } else {
      var texto = datos.getData('text');
      if (el._formato && el._formato.linea) texto = texto.replace(/\s*\n\s*/g, ' ');
      document.execCommand('insertText', false, texto);
    }
  }
  function alEnfocar(ev) { mostrar(ev.currentTarget); }
  function alDesenfocar(ev) {
    if (barra && barra.contains(ev.relatedTarget)) return;
    programarOcultar();
  }

  function activar(el, opciones) {
    el._formato = opciones || {};
    el.contentEditable = 'true';
    el.spellcheck = true;
    el.classList.add('ss-rico');
    el.addEventListener('paste', alPegar);
    el.addEventListener('focus', alEnfocar);
    el.addEventListener('blur', alDesenfocar);
    if (document.activeElement === el) mostrar(el);
  }
  function desactivar(el) {
    el.removeEventListener('paste', alPegar);
    el.removeEventListener('focus', alEnfocar);
    el.removeEventListener('blur', alDesenfocar);
    el.removeAttribute('contenteditable');
    el.classList.remove('ss-rico');
    if (activo === el) ocultarYa();
    delete el._formato;
  }

  /** HTML limpio del campo, listo para guardar ('' si no hay texto). */
  function valor(el) {
    var html = Rico.limpiar(el.innerHTML.replace(/&nbsp;/g, ' ').replace(/(<br\s*\/?>\s*)+$/i, ''));
    return Rico.vacio(html) ? '' : html.trim();
  }

  /** ¿El cursor está dentro de una lista? (para que Enter cree otro punto y no guarde). */
  function enLista(el) {
    var sel = window.getSelection();
    var n = sel.rangeCount ? sel.anchorNode : null;
    n = n && (n.nodeType === 1 ? n : n.parentElement);
    return !!(n && el.contains(n) && n.closest('li'));
  }

  window.SusanaFormato = { activar: activar, desactivar: desactivar, valor: valor, enLista: enLista };
})();
