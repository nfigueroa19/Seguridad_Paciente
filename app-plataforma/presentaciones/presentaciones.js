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
   - Los módulos con macros (.pptm) traen sus juegos (mapa, unir, sopa, detective, monitor, candado) y retos
     con puntaje en d.juego / d.formas; ver «Juegos y retos de los módulos con macros».
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
      puntos = { retos: {} };
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
    limpiezas.forEach(function (fn) { fn(); });
    limpiezas = [];
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
    if (d.juego) return d.juego !== 'cierre';
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
    if (d.juego) { montarJuego(d); return; }
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

  /* ---------- Juegos y retos de los módulos con macros (.pptm) ----------
     Cada forma interactiva llega en d.formas (caja, forma, relleno, texto) y se reconstruye como botón HTML sobre el
     fondo. La lógica es la de las macros VBA del PowerPoint (Interactividad): mismos colores, mensajes y puntajes.
     La unión (categoría ↔ descripción) acepta cualquier orden, como en los módulos 0 a 2. */
  var COLOR = {
    rojo: '#C62828', gris: '#969696', verde: '#196C33', lima: '#8DC63F', palido: '#C8E6C9', rosa: '#FBE2E2',
    rosaOpc: '#F4C7C7', naranja: '#AF5A19', seleccion: '#F0A050', blanco: '#FFFFFF', claro: '#EAF5EC'
  };
  var CLICABLES = {
    mapa: /^(Zona_|Boton_Reiniciar$)/,
    une: /^(Une_[ID]_|Boton_Reiniciar$)/,
    sopa: /^Sopa_\d_\d$/,
    detective: /^(Det_[BE]|Boton_Reiniciar$)/,
    monitor: /^Mon_(Iniciar|Suspender|Siguiente)$/,
    candado: /^Can_(P_\d|O_[AB]|K_\d|Borrar)$/,
    reto: /^Op_/,
    cierre: /^Boton_Puntaje$/
  };
  var limpiezas = [];   // funciones que apagan temporizadores al salir de la diapositiva
  var puntos = { retos: {} };   // puntaje de la presentación abierta (se reinicia al abrirla)

  function rgba(hex, a) {
    if (a == null || a >= 1) return hex;
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  function pintarTexto(el, parrafos) {
    el.textContent = '';
    parrafos.forEach(function (p) {
      var pe = h('p', { class: 'pi-p' });
      pe.style.textAlign = p.al;
      pe.style.marginBottom = (p.sa || 0) + 'cqw';
      p.r.forEach(function (r) {
        var s = h('span', { text: r.t });
        s.style.fontSize = r.sz + 'cqw';
        s.style.color = r.c;
        s.style.fontWeight = r.b ? '700' : '400';
        pe.append(s);
      });
      el.append(pe);
    });
  }

  function crearForma(f, clicable) {
    var el = h(clicable ? 'button' : 'div', { class: 'pi-f' + (clicable ? ' pi-clic' : '') });
    if (clicable) el.type = 'button';
    el.style.left = f.x + '%'; el.style.top = f.y + '%'; el.style.width = f.w + '%'; el.style.height = f.h + '%';
    el.style.padding = f.i[1] + 'cqw ' + f.i[2] + 'cqw ' + f.i[3] + 'cqw ' + f.i[0] + 'cqw';
    el.style.justifyContent = f.an;
    if (f.g === 'ellipse') el.style.borderRadius = '50%';
    else if (f.g === 'roundRect') el.style.borderRadius = ((f.adj != null ? f.adj : 0.16667) * Math.min(f.w, f.h / (pres.proporcion || 1.7778))) + 'cqw';
    if (f.l) el.style.border = f.lw + 'cqw solid ' + f.l;
    el.style.background = f.f ? rgba(f.f, f.a) : 'transparent';
    pintarTexto(el, f.p);
    if (f.oculto) el.hidden = true;
    return el;
  }

  function textoPlano(f) {
    return f.p.map(function (p) { return p.r.map(function (r) { return r.t; }).join(''); }).join(' ').replace(/\s+/g, ' ').trim();
  }

  function montarJuego(d) {
    var F = {};   // nombre -> { f, el, p } (p = párrafos actuales)
    var juego = d.juego;
    var re = CLICABLES[juego];
    var terminadoJuego = false;

    d.formas.forEach(function (f) {
      var clic = !!(re && re.test(f.n));
      var el = crearForma(f, clic);
      var etiqueta = textoPlano(f) || f.n.replace(/_/g, ' ');
      if (clic) el.setAttribute('aria-label', etiqueta);
      F[f.n] = { f: f, el: el, p: f.p };
      capa.append(el);
    });

    function S(n) { return F[n]; }
    function fondo_(n, hex, a) { if (F[n]) F[n].el.style.background = rgba(hex, a); }
    function ver(n, si) { if (F[n]) F[n].el.hidden = !si; }
    // Cambia el texto conservando el estilo del primer fragmento; `color` y `sz` (en cqw) son opcionales.
    function texto(n, lineas, color) {
      var o = F[n]; if (!o) return;
      var base = (o.f.p[0] && o.f.p[0].r[0]) || { sz: 1.6, b: false, c: '#000' };
      var al = (o.f.p[0] && o.f.p[0].al) || 'left';
      o.p = (Array.isArray(lineas) ? lineas : [lineas]).map(function (l) {
        var t = typeof l === 'string' ? { t: l } : l;
        return { al: al, sa: 0, r: [{ t: t.t, sz: t.sz || base.sz, b: t.b != null ? t.b : base.b, c: t.c || color || base.c }] };
      });
      pintarTexto(o.el, o.p);
    }
    function activo(n, si) { if (F[n]) F[n].el.disabled = !si; }
    function clic(n, fn) { if (F[n]) F[n].el.addEventListener('click', function () { if (!terminadoJuego || n === 'Boton_Reiniciar') fn(F[n].el); }); }
    function nombres(rx) { return Object.keys(F).filter(function (n) { return rx.test(n); }); }
    function guardar(id, v) { if (puntos[id] === undefined) puntos[id] = v; }
    function terminar() { resolver(); }
    function pad(n) { return (n < 10 ? '0' : '') + n; }

    clic('Boton_Reiniciar', function () {
      delete resueltas[indice]; delete puntos[juego];
      ir(indice, true);
      anunciar('Juego reiniciado.');
    });

    /* --- Mapa de la piel --- */
    if (juego === 'mapa') {
      var enc = 0, err = 0, marcadas = {};
      var marcador = function () {
        texto('Mapa_Marcador', [{ t: 'Zonas de riesgo: ' + enc + ' de 7', c: COLOR.verde }, { t: 'Errores: ' + err, c: COLOR.naranja }]);
      };
      nombres(/^Zona_/).forEach(function (n) {
        clic(n, function (el) {
          if (marcadas[n] || enc >= 7) return;
          marcadas[n] = true; el.disabled = true;
          var riesgo = n.charAt(5) === 'R', nombre = n.slice(n.indexOf('_', 5) + 1);
          if (riesgo) {
            fondo_(n, COLOR.rojo); enc++;
            fondo_('Mapa_Retro', COLOR.palido); texto('Mapa_Retro', '¡Correcto! ' + nombre + ': zona de riesgo de lesión por presión');
          } else {
            fondo_(n, COLOR.gris); err++;
            fondo_('Mapa_Retro', COLOR.rosa); texto('Mapa_Retro', nombre + ': no es una de las zonas de mayor riesgo');
          }
          anunciar(riesgo ? '¡Correcto! ' + nombre + ' es una zona de riesgo.' : nombre + ' no es una de las zonas de mayor riesgo.');
          marcador();
          if (enc >= 7) {
            var pts = Math.max(0, 7 - err);
            guardar('mapa', pts);
            texto('Puntaje_Mapa', '¡Encontraste las 7 zonas!  Errores: ' + err + '  ·  Puntaje: ' + pts + ' de 7'); ver('Puntaje_Mapa', true);
            terminadoJuego = true; terminar();
          }
        });
      });
    }

    /* --- Une cada categoría con su descripción --- */
    else if (juego === 'une') {
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'pi-lineas'); svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('aria-hidden', 'true');
      capa.insertBefore(svg, capa.firstChild);
      var sel = null, unidos = {}, fallos = {}, aciertos1 = 0, hechos = 0;
      var dibujar = function (a, b, color, punteada) {
        var fa = F[a].f, fb = F[b].f, l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        l.setAttribute('x1', fa.x + fa.w); l.setAttribute('y1', fa.y + fa.h / 2);
        l.setAttribute('x2', fb.x); l.setAttribute('y2', fb.y + fb.h / 2);
        l.setAttribute('stroke', color); l.setAttribute('stroke-width', '3'); l.setAttribute('stroke-linecap', 'round');
        l.setAttribute('vector-effect', 'non-scaling-stroke');
        if (punteada) l.setAttribute('stroke-dasharray', '6 5');
        svg.append(l);
        return l;
      };
      var avisoEl = null, avisoT = null;
      var aviso_ = function (t, ok) {   // aviso breve de acierto o error, abajo en la diapositiva
        if (avisoEl) avisoEl.remove();
        clearTimeout(avisoT);
        avisoEl = h('div', { class: 'pi-aviso pi-aviso-' + (ok ? 'ok' : 'mal'), role: 'status', text: t });
        capa.append(avisoEl);
        avisoT = setTimeout(function () { if (avisoEl) avisoEl.remove(); avisoEl = null; }, 2200);
        limpiezas.push(function () { clearTimeout(avisoT); });
      };
      var marcarSel = function (n, si) { F[n].el.classList.toggle('pi-sel', si); F[n].el.setAttribute('aria-pressed', String(si)); };
      nombres(/^Une_[ID]_/).forEach(function (n) {
        clic(n, function () {
          if (unidos[n]) return;
          var lado = n.charAt(4);
          if (!sel || sel.charAt(4) === lado) {   // elegir (o cambiar de elegida en el mismo lado)
            var antes = sel;
            if (sel) { marcarSel(sel, false); sel = null; }
            if (antes !== n) { sel = n; marcarSel(n, true); }
            return;
          }
          var izq = lado === 'I' ? n : sel, der = lado === 'D' ? n : sel;
          marcarSel(sel, false); sel = null;
          if (izq.slice(6) === der.slice(6)) {
            dibujar(izq, der, COLOR.verde);
            unidos[izq] = unidos[der] = true;
            fondo_(izq, COLOR.lima); fondo_(der, COLOR.palido);
            F[izq].el.disabled = F[der].el.disabled = true;
            F[izq].el.classList.add('pi-ok'); F[der].el.classList.add('pi-ok'); marca(F[izq].el, true); marca(F[der].el, true);
            if (!fallos[izq.slice(6)]) aciertos1++;
            hechos++;
            if (hechos < 6) aviso_('¡Correcto! Pareja ' + hechos + ' de 6.', true);
            anunciar('¡Correcto! Pareja ' + hechos + ' de 6.');
            if (hechos >= 6) {
              guardar('une', aciertos1);
              texto('Puntaje_Une', '¡Terminaste! Acertaste ' + aciertos1 + ' de 6 al primer intento'); ver('Puntaje_Une', true);
              terminadoJuego = true; terminar();
            }
          } else {
            fallos[izq.slice(6)] = true;
            var l = dibujar(izq, der, COLOR.rojo, true);
            // Error bien visible: ambos recuadros en rojo con ✕ y aviso; luego vuelven a su estado y se pueden unir de nuevo
            fondo_(izq, COLOR.rojo); fondo_(der, COLOR.rosaOpc);
            F[izq].el.classList.add('pi-mal'); F[der].el.classList.add('pi-mal'); marca(F[izq].el, false); marca(F[der].el, false);
            aviso_('Incorrecto: esa descripción no corresponde a «' + textoPlano(F[izq].f) + '». Intenta de nuevo.', false);
            anunciar('Incorrecto. Esa descripción no corresponde. Intenta de nuevo.');
            var t = setTimeout(function () {
              l.remove();
              [izq, der].forEach(function (x) {
                F[x].el.classList.remove('pi-mal');
                var m = F[x].el.querySelector('.pi-marca'); if (m) m.remove();
              });
              fondo_(izq, COLOR.verde); fondo_(der, COLOR.claro);
            }, 1400);
            limpiezas.push(function () { clearTimeout(t); });
          }
        });
      });
    }

    /* --- Sopa de letras --- */
    else if (juego === 'sopa') {
      var palabras = (pres.datos && pres.datos.sopa && pres.datos.sopa.palabras) || [];
      var seleccion = null, halladas = {}, celdasOk = {}, total = 0;
      var colorCelda = function (n) { fondo_(n, celdasOk[n] ? COLOR.lima : COLOR.claro); };
      nombres(/^Sopa_\d_\d$/).forEach(function (n) {
        clic(n, function () {
          if (seleccion === null) { seleccion = n; fondo_(n, COLOR.seleccion); return; }
          var primera = seleccion; seleccion = null;
          colorCelda(primera);
          if (primera === n) return;
          var r1 = +primera.charAt(5), k1 = +primera.charAt(7), r2 = +n.charAt(5), k2 = +n.charAt(7);
          var dr = r2 - r1, dc = k2 - k1;
          if (!(dr === 0 || dc === 0 || Math.abs(dr) === Math.abs(dc))) return;
          var largo = Math.max(Math.abs(dr), Math.abs(dc)), ids = [], w = '';
          for (var i = 0; i <= largo; i++) {
            var id = 'Sopa_' + (r1 + i * Math.sign(dr)) + '_' + (k1 + i * Math.sign(dc));
            if (!F[id]) return;
            ids.push(id); w += textoPlano(F[id].f);
          }
          var rev = w.split('').reverse().join(''), k = -1;
          palabras.forEach(function (p, i) { if (w === p || rev === p) k = i + 1; });
          if (k < 0) {
            fondo_(n, COLOR.rosa); fondo_(primera, COLOR.rosa);
            var t = setTimeout(function () { colorCelda(n); colorCelda(primera); }, 500);
            limpiezas.push(function () { clearTimeout(t); });
            return;
          }
          if (halladas[k]) return;
          halladas[k] = true;
          ids.forEach(function (id) { celdasOk[id] = true; colorCelda(id); });
          if (F['Sopa_W_' + k]) {
            fondo_('Sopa_W_' + k, COLOR.verde);
            F['Sopa_W_' + k].el.querySelectorAll('span').forEach(function (s) { s.style.color = '#fff'; });
          }
          total++;
          anunciar('¡Encontraste ' + w + '! ' + total + ' de ' + palabras.length + ' palabras.');
          if (total >= palabras.length) {
            guardar('sopa', total);
            texto('Puntaje_Sopa', '¡Encontraste las ' + palabras.length + ' palabras!'); ver('Puntaje_Sopa', true);
            terminadoJuego = true; terminar();
          }
        });
      });
    }

    /* --- Detective de discrepancias --- */
    else if (juego === 'detective') {
      var det = 0, errD = 0, vistas = {};
      var marcadorD = function () {
        if (det >= 4) {
          var pts = Math.max(0, 4 - errD);
          guardar('detective', pts);
          fondo_('Det_Marcador', COLOR.verde);
          texto('Det_Marcador', { t: '¡4 de 4! Puntaje: ' + pts + '/4. Con discrepancias NO se inicia la transfusión.', sz: F.Det_Marcador.f.p[0].r[0].sz * 13 / 15 });
        } else {
          texto('Det_Marcador', 'Discrepancias: ' + det + ' de 4  ·  Errores: ' + errD);
        }
      };
      nombres(/^Det_[BE]/).forEach(function (n) {
        clic(n, function (el) {
          if (vistas[n] || det >= 4) return;
          vistas[n] = true; el.disabled = true;
          var esError = n.charAt(4) === 'E';
          fondo_(n, esError ? COLOR.rojo : COLOR.verde);
          el.querySelectorAll('span').forEach(function (s) { s.style.color = '#fff'; });
          if (esError) det++; else errD++;
          anunciar(esError ? '¡Correcto! Ese dato no coincide.' : 'Ese dato sí coincide con la orden.');
          marcadorD();
          if (det >= 4) { terminadoJuego = true; terminar(); }
        });
      });
    }

    /* --- Monitor de la transfusión --- */
    else if (juego === 'monitor') {
      var pacientes = pres.datos.monitor.pacientes, r = 1, corriendo = false, hecho = false, ptsM = 0;
      var reloj_ = null, t0, tReac, tr_, reacciono;
      var signos = function (alarma) {
        var v = pacientes[r - 1][alarma ? 'alarma' : 'normal'];
        ['Mon_Temp', 'Mon_FC', 'Mon_PA', 'Mon_FR', 'Mon_Obs'].forEach(function (n, k) {
          texto(n, v[k], k < 4 ? (alarma ? '#FF6E6E' : '#7EF09E') : (alarma ? '#FFB478' : '#FFFFFF'));
        });
      };
      var preparar = function (n) {
        r = n; corriendo = false; hecho = false;
        signos(false); texto('Mon_Tiempo', '00:00'); texto('Mon_Ronda', 'Paciente ' + r + ' de 3'); ver('Mon_Retro', false);
      };
      var parar = function () { if (reloj_) { clearInterval(reloj_); reloj_ = null; } };
      limpiezas.push(parar);
      var finalizar = function (detuvo) {
        parar(); corriendo = false; hecho = true;
        var p = pacientes[r - 1], ok = false, msg;
        if (detuvo && reacciono) {
          ok = true; ptsM++;
          msg = '¡Bien! Suspendiste a los ' + ((Date.now() - tReac) / 1000).toFixed(1).replace('.', ',') + ' s ante ' + p.reaccion +
            '. Ahora: valora, mantén el acceso venoso, informa al médico y al banco de sangre, conserva la unidad y reporta.';
        } else if (detuvo) {
          msg = 'Suspendiste sin signos de reacción. Vigila de cerca, sobre todo al inicio, y actúa ante signos de alarma.';
        } else {
          msg = 'No suspendiste a tiempo ante ' + p.reaccion + '. Ante signos de alarma, suspende de inmediato.';
        }
        if (r >= 3) msg += '  Puntaje: ' + ptsM + ' de 3.';
        fondo_('Mon_Retro', ok ? COLOR.verde : COLOR.rojo);
        texto('Mon_Retro', msg); ver('Mon_Retro', true);
        anunciar(msg);
        if (r >= 3) { guardar('monitor', ptsM); terminadoJuego = true; terminar(); }
      };
      clic('Mon_Iniciar', function () {
        if (corriendo || hecho) return;
        corriendo = true; reacciono = false; ver('Mon_Retro', false); signos(false);
        tr_ = 4000 + Math.random() * 5000; t0 = Date.now();
        reloj_ = setInterval(function () {
          var el = Date.now() - t0;
          texto('Mon_Tiempo', '00:' + pad(Math.floor(el / 1000)));
          if (!reacciono && el >= tr_) { signos(true); reacciono = true; tReac = Date.now(); anunciar('Atención: cambian los signos del paciente.'); }
          if (reacciono && Date.now() - tReac > 6000) finalizar(false);
        }, 200);
      });
      clic('Mon_Suspender', function () { if (corriendo) finalizar(true); });
      clic('Mon_Siguiente', function () { if (!corriendo && hecho && r < 3) preparar(r + 1); });
      // 'Mon_Siguiente' y los demás botones nunca se bloquean al terminar el juego
      terminadoJuego = false;
    }

    /* --- Candado de seguridad --- */
    else if (juego === 'candado') {
      var cd = pres.datos.candado, act = null, resp = {}, aciertosC = 0, cod = '', abierto = false, ocupado = false;
      var pintarCodigo = function () {
        var s = [];
        for (var i = 0; i < 4; i++) s.push(i < cod.length ? cod.charAt(i) : '_');
        texto('Can_Codigo', s.join('  '));
      };
      [1, 2, 3, 4].forEach(function (k) {
        clic('Can_P_' + k, function () {
          if (resp[k] !== undefined) return;
          act = k;
          var p = cd.pistas[k - 1];
          texto('Can_Pregunta', p.q); texto('Can_O_A', p.A); texto('Can_O_B', p.B);
          fondo_('Can_O_A', COLOR.blanco); fondo_('Can_O_B', COLOR.blanco); ver('Can_Retro', false);
          anunciar(p.q);
        });
      });
      ['A', 'B'].forEach(function (L) {
        clic('Can_O_' + L, function () {
          if (act === null) return;
          var k = act, p = cd.pistas[k - 1], ok = L === p.ok;
          resp[k] = ok ? 1 : 0; if (ok) aciertosC++;
          act = null;
          puntos.candado = aciertosC;
          fondo_('Can_O_' + p.ok, COLOR.palido);
          if (!ok) fondo_('Can_O_' + L, COLOR.rosaOpc);
          fondo_('Can_P_' + k, ok ? COLOR.verde : COLOR.naranja);
          if (F['Can_P_' + k]) {
            var b = F['Can_P_' + k].f.p[0].r[0];
            F['Can_P_' + k].p = [{ al: 'center', sa: 0, r: [{ t: 'Pista ' + k, sz: b.sz * 14 / 16, b: true, c: '#fff' }] },
              { al: 'center', sa: 0, r: [{ t: 'Dígito: ' + p.digito, sz: b.sz * 18 / 16, b: true, c: '#fff' }] }];
            pintarTexto(F['Can_P_' + k].el, F['Can_P_' + k].p);
          }
          var n = Object.keys(resp).length;
          var msg = (ok ? '¡Correcto! Tu dígito es ' : 'Incorrecto (sin punto). Tu dígito es ') + p.digito + '.';
          if (n >= 4) msg += '  Ya tienes los 4 dígitos: digita el código.';
          fondo_('Can_Retro', ok ? COLOR.verde : COLOR.naranja); texto('Can_Retro', msg); ver('Can_Retro', true);
          anunciar(msg);
        });
      });
      nombres(/^Can_K_\d$/).forEach(function (n) {
        clic(n, function () {
          if (abierto || ocupado || cod.length >= 4) return;
          cod += textoPlano(F[n].f); pintarCodigo();
          if (cod.length < 4) return;
          if (cod === cd.codigo) {
            abierto = true;
            fondo_('Can_Codigo', COLOR.verde);
            texto('Can_Codigo', cod.split('').join('  '), '#fff');
            texto('Can_Estado', '¡ABIERTO!');
            fondo_('Can_Retro', COLOR.verde); texto('Can_Retro', '¡Candado abierto!  Pistas acertadas: ' + aciertosC + ' de 4'); ver('Can_Retro', true);
            anunciar('¡Candado abierto!');
            guardar('candado', aciertosC);
            terminadoJuego = true; terminar();
          } else {
            ocupado = true;
            fondo_('Can_Codigo', COLOR.rojo); texto('Can_Estado', 'Código incorrecto');
            anunciar('Código incorrecto.');
            var t = setTimeout(function () {
              fondo_('Can_Codigo', '#142B20'); cod = ''; pintarCodigo(); ocupado = false;
            }, 900);
            limpiezas.push(function () { clearTimeout(t); });
          }
        });
      });
      clic('Can_Borrar', function () { if (abierto || ocupado) return; cod = ''; pintarCodigo(); });
      terminadoJuego = false;
    }

    /* --- Reto de selección --- */
    else if (juego === 'reto') {
      var numReto = pres.diapositivas.slice(0, indice).filter(function (x) { return x.juego === 'reto'; }).length + 1;
      var acerto = false;
      var letras = {};
      Object.keys(F).forEach(function (n) { var m = /^Op_([A-Z])_(ok|no|c)$/.exec(n); if (m) letras[m[1]] = true; });
      Object.keys(letras).forEach(function (L) {
        var caja = F['Op_' + L + '_ok'] || F['Op_' + L + '_no'], correcta = !!F['Op_' + L + '_ok'];
        var botones = [S('Op_' + L + '_ok'), S('Op_' + L + '_no'), S('Op_' + L + '_c')].filter(Boolean);
        var elegir = function () {
          if (acerto) return;
          if (puntos.retos[numReto] === undefined) puntos.retos[numReto] = correcta ? 1 : 0;   // solo el primer intento suma
          ver('Ic_' + L, true);
          if (correcta) {
            acerto = true;
            fondo_(caja.f.n, COLOR.palido); ver('RetroNo', false); ver('RetroSi', true);
            Object.keys(F).filter(function (n) { return /^Op_/.test(n); }).forEach(function (n) { F[n].el.disabled = true; });
            anunciar('¡Correcto! ' + textoPlano(F.RetroSi ? F.RetroSi.f : caja.f) + ' Ya puedes continuar.');
            terminadoJuego = true; terminar();
          } else {
            fondo_(caja.f.n, COLOR.rosa);
            if (F.RetroSi && F.RetroSi.el.hidden) ver('RetroNo', true);
            botones.forEach(function (b) { b.el.disabled = true; });
            anunciar('Incorrecto. Intenta de nuevo.');
          }
        };
        botones.forEach(function (b) { b.el.addEventListener('click', elegir); });
      });
    }

    /* --- Cierre con el puntaje --- */
    else if (juego === 'cierre') {
      clic('Boton_Puntaje', function () {
        var suma = 0, max = 0;
        var partes = (pres.puntaje || []).map(function (p) {
          var v = p.id === 'retos'
            ? Object.keys(puntos.retos).filter(function (k) { return puntos.retos[k] === 1; }).length
            : (puntos[p.id] || 0);
          suma += v; max += p.max;
          return p.nombre + ': ' + v + '/' + p.max;
        });
        var t = partes.join('  ·  ') + '  ·  Total: ' + suma + '/' + max;
        texto('Puntaje_Final', t);
        anunciar(t);
      });
    }

    // Cronómetro decorativo de los retos (en el PowerPoint solo cuenta 30 → 1 y al acabar muestra «¡Tiempo!»)
    if (d.cronometro) {
      var c = d.cronometro;
      var rel = h('div', { class: 'pi-reloj', role: 'timer', 'aria-label': 'Tiempo restante' });
      posicionar(rel, c);
      capa.append(rel);
      reloj = { el: rel, quedan: c.segundos, id: null, alAcabar: function () { ver('Fin del tiempo', true); } };
      pintarReloj();
      reanudarReloj();
    }
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
