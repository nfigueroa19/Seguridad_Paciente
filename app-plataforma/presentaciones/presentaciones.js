/* =====================================================================
   SUSANA SEGURA — presentaciones interactivas de los módulos
   - Los datos los genera herramientas/presentaciones/generar.py a partir de los
     PowerPoint de cada módulo: presentaciones/catalogo.json (qué presentación va en
     qué curso) y presentaciones/<id>/presentacion.json (diapositivas y actividades).
   - curso.js llama a SusanaPresentaciones.pintar(cursoId, contenedor) al abrir un
     curso: si el curso tiene presentación, se muestra su tarjeta en Documentos.
   - Al abrirla, cada diapositiva es su imagen y encima van, como botones reales,
     las opciones de los retos, las piezas que se mueven a su casilla o se sacuden,
     el cronómetro y el audio, tal como estaban animados en el PowerPoint.
   - Aislado: IIFE, clases .pi-, un solo global (window.SusanaPresentaciones).
   ===================================================================== */
(function () {
  'use strict';

  var BASE = './presentaciones/';
  var catalogo = null;   // promesa del catálogo
  var datos = {};        // id -> promesa de presentacion.json

  var dlg, escenario, fondo, capa, sr, vivo, hTitulo, hContador, hNota, bAnt, bSig, bSonido, bPantalla;
  var pres = null;       // presentación abierta
  var indice = 0;
  var resueltas = {};    // diapositivas con actividad ya resuelta en esta apertura (índice -> true)
  var sonido = true;
  var reloj = null;      // intervalo del cronómetro
  var audios = [];       // audios en reproducción
  var origenFoco = null;

  function pedir(url) {
    // no-cache: el navegador revalida, así una presentación regenerada se ve sin limpiar la caché
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function h(tag, attrs, hijos) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') el.className = attrs[k];
      else if (k === 'text') el.textContent = attrs[k];
      else el.setAttribute(k, attrs[k]);
    });
    (hijos || []).forEach(function (c) { if (c) el.append(c); });
    return el;
  }

  /* ---------- Tarjetas en Documentos ---------- */
  function pedirCatalogo() {
    if (!catalogo) {
      catalogo = pedir(BASE + 'catalogo.json').catch(function () { catalogo = null; return []; });
    }
    return catalogo;
  }

  function tarjeta(p) {
    var ficha = h('article', { class: 'game-card pi-tarjeta' }, [
      h('img', { class: 'game-card-cover', src: BASE + p.portada, alt: '', width: '1600', height: '900', loading: 'lazy' }),
      h('div', { class: 'game-card-body' }, [
        h('span', { class: 'game-card-tag', text: 'Presentación interactiva' }),
        h('h3', { text: p.titulo }),
        h('p', { text: p.descripcion }),
        h('ul', { class: 'game-card-meta' }, [
          h('li', { text: '🖼️ ' + p.diapositivas + ' diapositivas' }),
          p.actividades ? h('li', { text: '🧩 ' + p.actividades + (p.actividades === 1 ? ' actividad' : ' actividades') }) : null
        ]),
        h('button', { class: 'btn btn-acento', type: 'button', 'data-presentacion': p.id, text: '▶ Abrir presentación' })
      ])
    ]);
    return ficha;
  }

  // Pinta en `contenedor` las presentaciones del curso. Devuelve una promesa con true si hay alguna.
  function pintar(cursoId, contenedor) {
    contenedor.textContent = '';
    contenedor.hidden = true;
    return pedirCatalogo().then(function (lista) {
      var delCurso = (lista || []).filter(function (p) { return p.curso === cursoId; });
      // Se limpia aquí también: si se abrió otro curso mientras cargaba, la última llamada es la que queda.
      if (!delCurso.length) { contenedor.textContent = ''; contenedor.hidden = true; return false; }
      var rejilla = h('div', { class: 'game-grid' }, delCurso.map(tarjeta));
      contenedor.replaceChildren(rejilla);
      contenedor.hidden = false;
      return true;
    });
  }

  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-presentacion]');
    if (b) abrir(b.getAttribute('data-presentacion'), b);
  });

  /* ---------- Ventana ---------- */
  function crearVentana() {
    hTitulo = h('h2', { class: 'pi-titulo', id: 'pi-titulo' });
    bSonido = h('button', { type: 'button', class: 'pi-hbtn', 'aria-pressed': 'true', title: 'Activar o silenciar el audio', text: '🔊 Sonido' });
    bPantalla = h('button', { type: 'button', class: 'pi-hbtn', 'aria-pressed': 'false', text: '⛶ Pantalla completa' });
    var bCerrar = h('button', { type: 'button', class: 'pi-hbtn', 'aria-label': 'Cerrar la presentación', text: '✕ Cerrar' });
    fondo = h('img', { class: 'pi-fondo', alt: '', draggable: 'false' });
    capa = h('div', { class: 'pi-capa' });
    sr = h('p', { class: 'pi-sr' });
    escenario = h('div', { class: 'pi-escenario' }, [fondo, capa, sr]);
    vivo = h('p', { class: 'pi-sr', role: 'status', 'aria-live': 'polite' });
    bAnt = h('button', { type: 'button', class: 'pi-nav', text: '← Anterior' });
    bSig = h('button', { type: 'button', class: 'pi-nav', text: 'Siguiente →' });
    hContador = h('span', { class: 'pi-contador', 'aria-live': 'polite' });
    hNota = h('p', { class: 'pi-nota', hidden: '' });
    dlg = h('dialog', { class: 'pi', 'aria-labelledby': 'pi-titulo' }, [
      h('div', { class: 'pi-barra' }, [hTitulo, bSonido, bPantalla, bCerrar]),
      h('div', { class: 'pi-cuerpo' }, [escenario]),
      h('div', { class: 'pi-pie' }, [bAnt, hContador, bSig]),
      hNota,
      vivo
    ]);
    document.body.append(dlg);

    bAnt.addEventListener('click', function () { ir(indice - 1); });
    bSig.addEventListener('click', function () { ir(indice + 1); });
    bCerrar.addEventListener('click', function () { dlg.close(); });
    bSonido.addEventListener('click', function () {
      sonido = !sonido;
      bSonido.setAttribute('aria-pressed', String(sonido));
      bSonido.textContent = sonido ? '🔊 Sonido' : '🔇 Sin sonido';
      audios.forEach(function (a) { a.muted = !sonido; });
    });
    bPantalla.addEventListener('click', function () { ponerPantalla(!dlg.classList.contains('pi-max')); });
    document.addEventListener('fullscreenchange', function () {
      if (!document.fullscreenElement && dlg.classList.contains('pi-max')) ponerPantalla(false);
    });
    dlg.addEventListener('close', alCerrar);
    dlg.addEventListener('keydown', function (ev) {
      if (ev.target.closest('input, textarea')) return;
      if (ev.key === 'ArrowRight' || ev.key === 'PageDown') { ev.preventDefault(); ir(indice + 1); }
      else if (ev.key === 'ArrowLeft' || ev.key === 'PageUp') { ev.preventDefault(); ir(indice - 1); }
      else if (ev.key === 'Home') { ev.preventDefault(); ir(0); }
      else if (ev.key === 'End') { ev.preventDefault(); ir(pres.diapositivas.length - 1); }
    });
    // Pausar cronómetro y audio si la pestaña se oculta
    document.addEventListener('visibilitychange', function () {
      if (!dlg.open) return;
      if (document.hidden) { pausarReloj(); audios.forEach(function (a) { a.pause(); }); }
      else { reanudarReloj(); }
    });
  }

  // Un <dialog> modal no admite requestFullscreen: se agranda la ventana y se pide pantalla completa a la página.
  function ponerPantalla(si) {
    dlg.classList.toggle('pi-max', si);
    bPantalla.setAttribute('aria-pressed', String(si));
    bPantalla.textContent = si ? '⤢ Salir de pantalla completa' : '⛶ Pantalla completa';
    if (si) {
      if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(function () { /* se queda en ventana grande */ });
      }
    } else if (document.fullscreenElement) {
      try { document.exitFullscreen(); } catch (e) { /* nada */ }
    }
  }

  function abrir(id, desde) {
    if (!datos[id]) datos[id] = pedir(BASE + id + '/presentacion.json').catch(function (e) { delete datos[id]; throw e; });
    if (!dlg) crearVentana();
    origenFoco = desde || document.activeElement;
    datos[id].then(function (p) {
      pres = p;
      resueltas = {};
      hTitulo.textContent = p.titulo;
      escenario.style.setProperty('--pi-prop', p.proporcion || 16 / 9);
      if (!dlg.open) dlg.showModal();
      ir(0, true);
      bSig.focus();
    }).catch(function () {
      window.alert('No se pudo abrir la presentación. Revisa tu conexión e inténtalo de nuevo.');
    });
  }

  function alCerrar() {
    limpiarDiapositiva();
    if (dlg.classList.contains('pi-max')) ponerPantalla(false);
    if (origenFoco && document.contains(origenFoco)) origenFoco.focus();
  }

  /* ---------- Diapositivas ---------- */
  function url(archivo) { return BASE + pres.id + '/' + archivo; }

  function limpiarDiapositiva() {
    pararReloj();
    audios.forEach(function (a) { a.pause(); a.removeAttribute('src'); a.load(); });
    audios = [];
    capa.textContent = '';
  }

  function ir(n, forzar) {
    if (!pres) return;
    var total = pres.diapositivas.length;
    if (n < 0 || n >= total || (n === indice && !forzar)) return;
    // No se avanza más allá de una actividad sin resolver (ni con teclado ni con Fin).
    if (n > indice) {
      for (var k = indice; k < n; k++) {
        if (pendiente(k)) { n = k; break; }
      }
      if (n === indice && !forzar) { anunciar('Resuelve la actividad para continuar.'); return; }
    }
    indice = n;
    limpiarDiapositiva();
    var d = pres.diapositivas[n];
    fondo.src = url(d.img);
    sr.textContent = 'Diapositiva ' + (n + 1) + '. ' + (d.texto || '');
    hContador.textContent = 'Diapositiva ' + (n + 1) + ' de ' + total;
    bAnt.disabled = n === 0;
    actualizarNav();
    escenario.classList.remove('pi-entra');
    void escenario.offsetWidth; // reinicia la animación de entrada
    escenario.classList.add('pi-entra');
    montarActividad(d);
    if (d.audio) tocar(d.audio);
    // Precarga de la siguiente
    if (n + 1 < total) { var sig = new Image(); sig.src = url(pres.diapositivas[n + 1].img); }
  }

  function esActividad(d) {
    return (d.elementos || []).some(function (e) { return e.tipo === 'opcion' || e.tipo === 'mover'; });
  }
  function pendiente(n) { return esActividad(pres.diapositivas[n]) && !resueltas[n]; }

  function actualizarNav() {
    var bloqueada = pendiente(indice);
    bSig.disabled = indice === pres.diapositivas.length - 1 || bloqueada;
    hNota.hidden = !bloqueada;
    hNota.textContent = bloqueada ? 'Resuelve la actividad para continuar.' : '';
  }

  function resolver() { resueltas[indice] = true; actualizarNav(); }

  function posicionar(el, e, x, y) {
    el.style.left = (x == null ? e.x : x) + '%';
    el.style.top = (y == null ? e.y : y) + '%';
    el.style.width = e.w + '%';
    el.style.height = e.h + '%';
  }

  function marca(el, ok) {
    var m = el.querySelector('.pi-marca');
    if (!m) { m = h('span', { class: 'pi-marca', 'aria-hidden': 'true' }); el.append(m); }
    m.textContent = ok ? '✓' : '✕';
  }

  function anunciar(t) { vivo.textContent = ''; setTimeout(function () { vivo.textContent = t; }, 30); }

  function montarActividad(d) {
    var els = d.elementos || [];
    var piezas = els.filter(function (e) { return e.tipo === 'mover'; }).length;
    var colocadas = 0;
    var terminado = false;

    // Unir pieza con recuadro (definición o casilla) en cualquier orden: lo primero que se pulsa queda
    // elegido y lo segundo comprueba la pareja. La respuesta no se revela con un solo clic.
    var destinos = d.destinos || [];
    var selDestino = null;   // índice del recuadro elegido
    var selPieza = null;     // { e, b } de la pieza elegida
    var botonesDestino = [];
    var nombreDestino = destinos.some(function (x) { return x.etiqueta.length > 30; }) ? 'definición' : 'casilla';
    var nombrePieza = nombreDestino === 'definición' ? 'concepto' : 'imagen';

    function elegir(b, si) { b.classList.toggle('pi-elegido', si); b.setAttribute('aria-pressed', String(si)); if (!si) b.classList.remove('pi-error'); }
    function soltarDestino() { if (selDestino !== null) { elegir(botonesDestino[selDestino], false); selDestino = null; } }
    function soltarPieza() { if (selPieza) { elegir(selPieza.b, false); selPieza = null; } }

    function sacudir(b) {
      b.classList.remove('pi-sacude');
      void b.offsetWidth;
      b.classList.add('pi-sacude', 'pi-mal');
      marca(b, false);
      setTimeout(function () {
        if (b.classList.contains('pi-ok')) return; // ya se acertó: conservar la ✓
        b.classList.remove('pi-mal'); var m = b.querySelector('.pi-marca'); if (m) m.remove();
      }, 1200);
    }

    function colocar(e, b) {
      b.disabled = true;
      b.classList.remove('pi-mal', 'pi-sacude');
      b.classList.add('pi-ok');
      b.style.left = (e.x + e.dx) + '%';
      b.style.top = (e.y + e.dy) + '%';
      setTimeout(function () { marca(b, true); }, 900);
      colocadas++;
      anunciar('¡Correcto! ' + (e.etiqueta.indexOf('Imagen') === 0 ? 'La imagen pasa a su casilla.' : e.etiqueta + ' pasa a su definición.'));
      if (colocadas === piezas) {
        terminado = true;
        pararReloj();
        resolver();
        setTimeout(function () { aviso('¡Muy bien! Completaste la actividad.', d); }, 950);
      }
    }

    // Comprueba la pareja. `primero` dice qué se eligió antes: eso queda elegido si se falla.
    function comprobar(e, b, i, primero) {
      var bd = botonesDestino[i];
      if (e.tipo === 'mover' && e.destino === i) {
        elegir(b, false); elegir(bd, false);
        bd.classList.add('pi-hecho'); bd.disabled = true;
        selDestino = null; selPieza = null;
        colocar(e, b);
        return;
      }
      sacudir(b);
      bd.classList.remove('pi-error'); void bd.offsetWidth; bd.classList.add('pi-error');
      if (primero === 'destino') { soltarPieza(); } else { soltarDestino(); setTimeout(function () { bd.classList.remove('pi-error'); }, 700); }
      anunciar('Incorrecto. Ese ' + nombrePieza + ' no corresponde a ' + (nombreDestino === 'definición' ? 'esa definición' : 'esa casilla') + '. Intenta de nuevo.');
    }

    destinos.forEach(function (x, i) {
      var bd = h('button', { type: 'button', class: 'pi-destino', 'aria-pressed': 'false',
        'aria-label': (nombreDestino === 'definición' ? 'Definición: ' : 'Casilla: ') + x.etiqueta });
      posicionar(bd, x);
      bd.addEventListener('click', function () {
        if (terminado) return;
        if (selPieza) { comprobar(selPieza.e, selPieza.b, i, 'pieza'); return; }
        var antes = selDestino;
        soltarDestino();
        if (antes !== i) {
          selDestino = i; elegir(bd, true);
          anunciar('Elegiste ' + (nombreDestino === 'definición' ? 'la definición: ' : 'la casilla: ') + x.etiqueta + '. Ahora elige ' +
            (nombrePieza === 'concepto' ? 'el concepto' : 'la imagen') + ' que le corresponde.');
        }
      });
      botonesDestino.push(bd);
      capa.append(bd);
    });

    els.forEach(function (e) {
      var b;
      if (e.tipo === 'opcion') {
        b = h('button', { type: 'button', class: 'pi-opcion', 'aria-label': 'Opción: ' + e.etiqueta });
        b.style.setProperty('--pi-color', e.color);
        posicionar(b, e);
        b.addEventListener('click', function () {
          if (e.correcta) {
            b.classList.add('pi-ok'); marca(b, true);
            resolver();
            capa.querySelectorAll('.pi-opcion').forEach(function (o) { o.disabled = true; });
            anunciar('¡Correcto! ' + e.etiqueta + ' Ya puedes continuar.');
          } else {
            b.classList.add('pi-mal'); marca(b, false); b.disabled = true;
            anunciar('Incorrecto. Intenta de nuevo.');
          }
        });
      } else {
        b = h('button', { type: 'button', class: 'pi-pieza', 'aria-label': e.etiqueta, 'aria-pressed': 'false' }, [h('img', { src: url(e.img), alt: '' })]);
        posicionar(b, e);
        b.addEventListener('click', function () {
          if (terminado) return;
          if (!destinos.length) { // sin recuadros: comportamiento original del PowerPoint
            if (e.tipo === 'mover') colocar(e, b); else { sacudir(b); anunciar('Incorrecto. Esa no corresponde.'); }
            return;
          }
          if (selDestino !== null) { comprobar(e, b, selDestino, 'destino'); return; }
          var era = selPieza && selPieza.b === b;
          soltarPieza();
          if (!era) {
            selPieza = { e: e, b: b }; elegir(b, true);
            anunciar('Elegiste ' + e.etiqueta + '. Ahora elige ' + (nombreDestino === 'definición' ? 'la definición' : 'la casilla') + ' que le corresponde.');
          }
        });
      }
      capa.append(b);
    });

    if (d.cronometro) {
      var c = d.cronometro;
      var r = h('div', { class: 'pi-reloj', role: 'timer', 'aria-label': 'Tiempo restante' });
      posicionar(r, c);
      capa.append(r);
      reloj = { el: r, quedan: c.segundos, id: null, alAcabar: function () {
        terminado = true;
        capa.querySelectorAll('.pi-pieza:not(:disabled)').forEach(function (p) { p.disabled = true; });
        aviso('¡Se acabó el tiempo!', d, true);
      } };
      pintarReloj();
      reanudarReloj();
    }
  }

  function aviso(texto, d, reintentar) {
    var botones = [];
    if (reintentar || (d.elementos || []).some(function (e) { return e.tipo === 'mover'; })) {
      var bR = h('button', { type: 'button', class: 'btn btn-outline btn-sm', text: '↻ Repetir' });
      bR.style.background = '#fff';
      bR.addEventListener('click', function () { ir(indice, true); });
      botones.push(bR);
    }
    if (indice < pres.diapositivas.length - 1 && resueltas[indice]) {
      var bS = h('button', { type: 'button', class: 'btn btn-acento btn-sm', text: 'Continuar →' });
      bS.addEventListener('click', function () { ir(indice + 1); });
      botones.push(bS);
    }
    var caja = h('div', { class: 'pi-aviso', role: 'status' }, [h('span', { text: texto })].concat(botones));
    capa.append(caja);
    anunciar(texto);
    if (botones.length) botones[botones.length - 1].focus();
  }

  /* ---------- Cronómetro ---------- */
  function pintarReloj() {
    reloj.el.textContent = String(reloj.quedan);
    reloj.el.classList.toggle('pi-urgente', reloj.quedan <= 5);
  }
  function reanudarReloj() {
    if (!reloj || reloj.id || reloj.quedan <= 0 || document.hidden) return;
    reloj.id = setInterval(function () {
      reloj.quedan--;
      pintarReloj();
      if (reloj.quedan <= 0) { var fin = reloj.alAcabar; pausarReloj(); fin(); }
    }, 1000);
  }
  function pausarReloj() { if (reloj && reloj.id) { clearInterval(reloj.id); reloj.id = null; } }
  function pararReloj() { pausarReloj(); reloj = null; }

  /* ---------- Audio (como en el PowerPoint: suena al entrar en la diapositiva) ---------- */
  function tocar(lista) {
    lista.forEach(function (a) {
      var el = new Audio(url(a.src));
      el.volume = Math.max(0, Math.min(1, a.volumen == null ? 1 : a.volumen));
      el.muted = !sonido;
      audios.push(el);
      el.play().catch(function () { /* el navegador puede bloquearlo: el botón de sonido no cambia nada más */ });
    });
  }

  window.SusanaPresentaciones = { pintar: pintar, abrir: abrir };
})();
