/* =====================================================================
   SUSANA SEGURA — texto con formato (lo cargan todos los usuarios)
   Los textos editables se guardan como HTML mínimo (negrita, cursiva, subrayado,
   tachado, color, tamaño, alineación, listas, enlaces). Antes de pintarlos, SIEMPRE
   pasan por limpiar(): solo sobreviven las etiquetas y estilos de la lista permitida,
   así que nada de lo guardado puede ejecutar código.
   El Worker aplica la MISMA lista al guardar (contenido-api/src/index.js, limpiarHtml):
   si se cambia aquí, hay que cambiarla allá.
   Un texto antiguo sin etiquetas es HTML válido, así que sigue viéndose igual.
   ===================================================================== */
(function () {
  'use strict';

  var PERMITIDAS = { B: 1, STRONG: 1, I: 1, EM: 1, U: 1, S: 1, STRIKE: 1, BR: 1, P: 1, DIV: 1, SPAN: 1, UL: 1, OL: 1, LI: 1, A: 1 };
  // Etiquetas cuyo contenido se descarta por completo (el resto de las no permitidas conserva su texto).
  var ELIMINAR = { SCRIPT: 1, STYLE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, NOSCRIPT: 1, TEMPLATE: 1, SVG: 1, MATH: 1, TEXTAREA: 1, TITLE: 1, HEAD: 1, SELECT: 1, BUTTON: 1, FORM: 1, INPUT: 1, AUDIO: 1, VIDEO: 1, CANVAS: 1 };

  var COLOR = /^(#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\))$/i;
  var TAMANO = /^(\d{1,3}(\.\d{1,2})?)(px|pt|em|rem)$/i;
  var ALINEACION = /^(left|right|center|justify)$/i;
  var ENLACE = /^(https?:\/\/[^\s"'<>]+|mailto:[^\s"'<>]+|tel:[+0-9 ()-]+|#[a-z0-9-]{1,40}|media\/documentos\/[A-Za-z0-9_\-./%]+)$/i;

  function tamanoValido(v) {
    var m = TAMANO.exec(v);
    if (!m) return false;
    var n = parseFloat(m[1]);
    var px = m[3].toLowerCase() === 'px' ? n : m[3].toLowerCase() === 'pt' ? n * 4 / 3 : n * 16;
    return px >= 6 && px <= 200;
  }

  // Deja solo color, tamaño y alineación, con valores comprobados.
  function estiloSeguro(texto) {
    var salida = [];
    String(texto || '').split(';').forEach(function (decl) {
      var i = decl.indexOf(':');
      if (i < 0) return;
      var prop = decl.slice(0, i).trim().toLowerCase();
      var val = decl.slice(i + 1).trim();
      if (prop === 'color' && COLOR.test(val)) salida.push('color:' + val);
      else if (prop === 'background-color' && (COLOR.test(val) || /^transparent$/i.test(val))) salida.push('background-color:' + val);
      else if (prop === 'font-size' && tamanoValido(val)) salida.push('font-size:' + val);
      else if (prop === 'text-align' && ALINEACION.test(val)) salida.push('text-align:' + val.toLowerCase());
    });
    return salida.join(';');
  }

  function copiar(origen, destino) {
    for (var n = origen.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) { destino.appendChild(document.createTextNode(n.nodeValue)); continue; }
      if (n.nodeType !== 1) continue; // comentarios y demás: fuera
      var tag = n.tagName.toUpperCase();
      if (ELIMINAR[tag]) continue;
      if (!PERMITIDAS[tag]) { copiar(n, destino); continue; } // se quita la etiqueta, se conserva el texto
      var nuevo = document.createElement(tag.toLowerCase());
      var estilo = estiloSeguro(n.getAttribute('style'));
      if (estilo) nuevo.setAttribute('style', estilo);
      if (tag === 'A') {
        var href = (n.getAttribute('href') || '').trim();
        if (!ENLACE.test(href)) { copiar(n, destino); continue; } // enlace no permitido: queda el texto
        nuevo.setAttribute('href', href);
        if (/^https?:/i.test(href)) { nuevo.setAttribute('target', '_blank'); nuevo.setAttribute('rel', 'noopener noreferrer'); }
      }
      copiar(n, nuevo);
      destino.appendChild(nuevo);
    }
  }

  /** HTML (como texto) → HTML seguro (como texto). */
  function limpiar(html) {
    var texto = String(html == null ? '' : html);
    if (texto.indexOf('<') < 0) return texto; // sin etiquetas: nada que limpiar
    var doc = new DOMParser().parseFromString('<!doctype html><body>' + texto, 'text/html');
    var caja = document.createElement('div');
    copiar(doc.body, caja);
    return caja.innerHTML;
  }

  /** Texto plano de un valor con formato (para títulos de pestaña, listas, etc.). */
  function aTexto(html) {
    var texto = String(html == null ? '' : html);
    if (texto.indexOf('<') < 0 && texto.indexOf('&') < 0) return texto;
    var doc = new DOMParser().parseFromString('<!doctype html><body>' + texto.replace(/<(br|\/p|\/div|\/li)\b[^>]*>/gi, ' '), 'text/html');
    return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function vacio(html) { return aTexto(html) === ''; }

  /** Pinta un valor con formato dentro de un elemento. */
  function poner(el, valor) {
    var limpio = limpiar(valor);
    if (limpio.indexOf('<') < 0 && limpio.indexOf('&') < 0) el.textContent = limpio;
    else el.innerHTML = limpio;
    el.classList.add('rico');
    return el;
  }


  /* Icono de tipo de archivo + extensión (PDF, DOCX, PPTX…). Se usa en las listas de documentos. */
  var TIPOS_ICONO = {
    pdf: ['#D93025', 'PDF'], doc: ['#2B579A', 'W'], docx: ['#2B579A', 'W'],
    xls: ['#217346', 'X'], xlsx: ['#217346', 'X'], csv: ['#217346', 'CSV'],
    ppt: ['#C43E1C', 'P'], pptx: ['#C43E1C', 'P'],
    txt: ['#5F6368', 'TXT'], png: ['#7B4FBF', 'IMG'], jpg: ['#7B4FBF', 'IMG'], jpeg: ['#7B4FBF', 'IMG']
  };
  function extensionDe(ruta) {
    var m = String(ruta || '').split(/[?#]/)[0].match(/\.([A-Za-z0-9]{1,5})$/);
    return m ? m[1].toLowerCase() : '';
  }
  /** Devuelve un <span> con el icono del tipo de archivo y su extensión en mayúsculas. */
  function iconoArchivo(ruta) {
    var ext = extensionDe(ruta);
    var t = TIPOS_ICONO[ext] || ['#5F6368', ''];
    var caja = document.createElement('span');
    caja.className = 'ss-tipo';
    caja.setAttribute('aria-hidden', 'true');
    var letra = t[1];
    var tam = letra.length > 1 ? 7.5 : 12;
    caja.innerHTML = '<svg viewBox="0 0 24 28" width="22" height="26" focusable="false">' +
      '<path d="M3 1.5h12l6 6V25a1.5 1.5 0 0 1-1.5 1.5h-16.5A1.5 1.5 0 0 1 1.5 25V3A1.5 1.5 0 0 1 3 1.5z" fill="' + t[0] + '"/>' +
      '<path d="M15 1.5v6h6z" fill="#fff" fill-opacity=".45"/>' +
      '<text x="11.5" y="20.5" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="' + tam + '" fill="#fff">' + letra + '</text></svg>' +
      '<span class="ss-tipo-ext"></span>';
    caja.lastChild.textContent = ext ? ext.toUpperCase() : '';
    caja.lastChild.style.color = t[0];
    return caja;
  }


  /* Icono de tipo de archivo + extensión (PDF, DOCX, PPTX…). Se usa en las listas de documentos. */
  var TIPOS_ICONO = {
    pdf: ['#D93025', 'PDF'], doc: ['#2B579A', 'W'], docx: ['#2B579A', 'W'],
    xls: ['#217346', 'X'], xlsx: ['#217346', 'X'], csv: ['#217346', 'CSV'],
    ppt: ['#C43E1C', 'P'], pptx: ['#C43E1C', 'P'],
    txt: ['#5F6368', 'TXT'], png: ['#7B4FBF', 'IMG'], jpg: ['#7B4FBF', 'IMG'], jpeg: ['#7B4FBF', 'IMG']
  };
  function extensionDe(ruta) {
    var m = String(ruta || '').split(/[?#]/)[0].match(/\.([A-Za-z0-9]{1,5})$/);
    return m ? m[1].toLowerCase() : '';
  }
  /** Devuelve un <span> con el icono del tipo de archivo y su extensión en mayúsculas. */
  function iconoArchivo(ruta) {
    var ext = extensionDe(ruta);
    var t = TIPOS_ICONO[ext] || ['#5F6368', ''];
    var caja = document.createElement('span');
    caja.className = 'ss-tipo';
    caja.setAttribute('aria-hidden', 'true');
    var letra = t[1];
    var tam = letra.length > 1 ? 7.5 : 12;
    caja.innerHTML = '<svg viewBox="0 0 24 28" width="22" height="26" focusable="false">' +
      '<path d="M3 1.5h12l6 6V25a1.5 1.5 0 0 1-1.5 1.5h-16.5A1.5 1.5 0 0 1 1.5 25V3A1.5 1.5 0 0 1 3 1.5z" fill="' + t[0] + '"/>' +
      '<path d="M15 1.5v6h6z" fill="#fff" fill-opacity=".45"/>' +
      '<text x="11.5" y="20.5" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="' + tam + '" fill="#fff">' + letra + '</text></svg>' +
      '<span class="ss-tipo-ext"></span>';
    caja.lastChild.textContent = ext ? ext.toUpperCase() : '';
    caja.lastChild.style.color = t[0];
    return caja;
  }

  window.SusanaRico = { limpiar: limpiar, aTexto: aTexto, vacio: vacio, poner: poner, ENLACE: ENLACE, iconoArchivo: iconoArchivo, extensionDe: extensionDe };
})();
