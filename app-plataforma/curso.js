/* =====================================================================
   SUSANA SEGURA — vista Curso
   - Lista de cursos en tarjetas (media/cursos.json). Al abrir uno se muestra
     su texto, sus documentos (si los hay) y su video HLS.
   - cursos.json y catalogo.json se piden solo al abrir #curso (una vez).
   - Del video no se descarga nada hasta pulsar play. hls.js se carga en ese
     momento, y solo si el navegador no reproduce HLS de forma nativa
     (iPhone/iPad usan el HLS nativo de Safari).
   ===================================================================== */
(function () {
  'use strict';

  var CURSOS = './media/cursos.json';
  var CATALOGO = './media/videos/catalogo.json';
  var HLSJS = './vendor/hlsjs/hls.min.js';
  var PLYR = './vendor/plyr/plyr.min.js';
  var ICONOS = './vendor/plyr/plyr.svg';
  var TIPO_HLS = 'application/vnd.apple.mpegurl';

  var vistaLista = document.getElementById('curso-lista-vista');
  var lista = document.getElementById('curso-lista');
  var aviso = document.getElementById('curso-aviso');
  var detalle = document.getElementById('curso-detalle');
  var tituloDetalle = document.getElementById('curso-detalle-titulo');
  var texto = document.getElementById('curso-texto');
  var docs = document.getElementById('curso-docs');
  var docsLista = document.getElementById('curso-docs-lista');
  var video = document.getElementById('curso-video');
  var estado = document.getElementById('curso-estado');
  if (!lista || !video) return;

  var cursos = {};
  var videos = {};
  var datosCargados = false;
  var cargandoDatos = false;
  var promesaHls = null;
  var promesaPlyr = null;
  var player = null;      // instancia única de Plyr (interfaz del reproductor)
  var cargado = false;    // ya se pidió el video del curso abierto
  var hls = null;
  var videoActual = null; // video del curso abierto
  var sesion = 0;         // cambia con cada curso abierto o cerrado: descarta cargas viejas

  function pedirJson(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  /* ---------- Lista de cursos ---------- */
  function crearTarjeta(curso) {
    var boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'cv-curso';
    boton.dataset.id = curso.id;

    var icono = document.createElement('span');
    icono.className = 'cv-curso-icono';
    icono.setAttribute('aria-hidden', 'true');
    icono.textContent = '📖';

    var nombre = document.createElement('span');
    nombre.className = 'cv-curso-titulo';
    nombre.textContent = curso.titulo;

    var resumen = document.createElement('span');
    resumen.className = 'cv-curso-resumen';
    resumen.textContent = curso.resumen || '';

    var ir = document.createElement('span');
    ir.className = 'cv-curso-ir';
    ir.setAttribute('aria-hidden', 'true');
    ir.textContent = 'Abrir →';

    boton.append(icono, nombre, resumen, ir);
    return boton;
  }

  function cargarDatos() {
    if (datosCargados || cargandoDatos) return;
    cargandoDatos = true;
    aviso.hidden = false;
    aviso.textContent = 'Cargando cursos…';

    Promise.all([pedirJson(CURSOS), pedirJson(CATALOGO)])
      .then(function (r) {
        var items = r[0];
        r[1].forEach(function (v) { videos[v.id] = v; });
        if (!Array.isArray(items) || items.length === 0) {
          aviso.textContent = 'Aún no hay cursos disponibles.';
          return;
        }
        items.forEach(function (curso) {
          cursos[curso.id] = curso;
          lista.appendChild(crearTarjeta(curso));
        });
        datosCargados = true;
        aviso.hidden = true;
      })
      .catch(function () {
        aviso.textContent = 'No se pudieron cargar los cursos. Recarga la página e inténtalo de nuevo.';
      })
      .then(function () { cargandoDatos = false; });
  }

  /* ---------- Detalle de un curso ---------- */
  function pintarTexto(curso) {
    texto.textContent = '';
    (curso.texto || []).forEach(function (parrafo) {
      var p = document.createElement('p');
      p.textContent = parrafo;
      texto.appendChild(p);
    });
  }

  function pintarDocumentos(curso) {
    docsLista.textContent = '';
    var items = curso.documentos || [];
    docs.hidden = items.length === 0;
    items.forEach(function (doc) {
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = doc.archivo;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = '📄 ' + doc.titulo;
      li.appendChild(a);
      docsLista.appendChild(li);
    });
  }

  function prepararVideo(curso) {
    videoActual = videos[curso.video] || null;
    var seccion = video.closest('.cv-player');
    var rotulo = seccion.previousElementSibling; // "Video"
    seccion.hidden = rotulo.hidden = !videoActual;
    if (!videoActual) return;
    cargado = false;
    video.poster = videoActual.poster;
    if (player) {
      player.poster = videoActual.poster;
      player.quality = 0; // cada curso arranca en Automática
    }
  }

  function abrirCurso(curso) {
    sesion++;
    liberar();
    tituloDetalle.textContent = curso.titulo;
    pintarTexto(curso);
    pintarDocumentos(curso);
    prepararVideo(curso);
    vistaLista.hidden = true;
    detalle.hidden = false;
    window.scrollTo(0, 0);
    tituloDetalle.focus({ preventScroll: true });
    asegurarPlyr();
  }

  function volver() {
    sesion++;
    liberar();
    videoActual = null;
    detalle.hidden = true;
    vistaLista.hidden = false;
    window.scrollTo(0, 0);
  }

  /* ---------- Carga perezosa de scripts ---------- */
  function cargarScript(url) {
    return new Promise(function (resolver, rechazar) {
      var s = document.createElement('script');
      s.src = url;
      s.onload = resolver;
      s.onerror = function () { rechazar(new Error(url)); };
      document.head.appendChild(s);
    });
  }

  function cargarHlsJs() {
    if (window.Hls) return Promise.resolve();
    if (!promesaHls) {
      promesaHls = cargarScript(HLSJS).catch(function (e) { promesaHls = null; throw e; });
    }
    return promesaHls;
  }

  // iPhone no tiene MediaSource (solo ManagedMediaSource): ahí manda el HLS nativo.
  function usarNativo() {
    return !window.MediaSource && video.canPlayType(TIPO_HLS) !== '';
  }

  /* ---------- Interfaz del reproductor (Plyr) ---------- */
  function cambiarCalidad(alto) {
    if (!hls) return;
    var nivel = -1; // 0 = Automática
    if (alto) {
      hls.levels.forEach(function (n, indice) { if (n.height === alto) nivel = indice; });
    }
    // currentLevel fija el nivel de inmediato; -1 devuelve el control al ABR.
    hls.currentLevel = nivel;
  }

  function crearPlyr() {
    var opciones = {
      controls: ['play-large', 'rewind', 'play', 'fast-forward', 'progress', 'current-time', 'duration', 'mute', 'volume', 'settings', 'fullscreen'],
      settings: ['quality', 'speed'],
      seekTime: 10,
      iconUrl: ICONOS,          // íconos locales: nada se pide a cdn.plyr.io
      blankVideo: '',
      ratio: '16:9',
      tooltips: { controls: true, seek: true },
      keyboard: { focused: true, global: false },
      i18n: {
        restart: 'Reiniciar', rewind: 'Retroceder {seektime} s', play: 'Reproducir', pause: 'Pausa',
        fastForward: 'Avanzar {seektime} s', seek: 'Buscar', seekLabel: '{currentTime} de {duration}',
        played: 'Reproducido', buffered: 'En búfer', currentTime: 'Tiempo actual', duration: 'Duración',
        volume: 'Volumen', mute: 'Silenciar', unmute: 'Activar sonido',
        enterFullscreen: 'Pantalla completa', exitFullscreen: 'Salir de pantalla completa',
        settings: 'Configuración', menuBack: 'Volver al menú anterior', speed: 'Velocidad', normal: 'Normal',
        quality: 'Calidad', loop: 'Repetir', reset: 'Restablecer', disabled: 'Desactivado', enabled: 'Activado',
        frameTitle: 'Reproductor de {title}',
        qualityLabel: { 0: 'Automática', 1080: '1080p', 720: '720p', 360: '360p' }
      }
    };
    // Con HLS nativo (iPhone) la calidad la decide el sistema: no se ofrece el menú.
    if (!usarNativo()) {
      opciones.quality = { default: 0, options: [0, 1080, 720, 360], forced: true, onChange: cambiarCalidad };
    }
    player = new window.Plyr(video, opciones);
    if (videoActual) player.poster = videoActual.poster;
  }

  function asegurarPlyr() {
    if (player) return;
    if (!promesaPlyr) {
      promesaPlyr = cargarScript(PLYR).catch(function (e) { promesaPlyr = null; throw e; });
    }
    promesaPlyr.then(function () {
      if (!player && window.Plyr) crearPlyr();
    }).catch(function () {
      video.controls = true; // sin Plyr, el video queda con los controles nativos
    });
  }

  /* ---------- Video ---------- */
  function liberar() {
    if (hls) { hls.destroy(); hls = null; }
    cargado = false;
    video.pause();
    video.removeAttribute('src');
    video.load();
    estado.textContent = '';
  }

  // Se llama la primera vez que la persona pulsa play en el curso abierto.
  function iniciarCarga() {
    var item = videoActual;
    if (!item || cargado) return;
    cargado = true;
    var propia = ++sesion;
    estado.textContent = 'Preparando video…';

    function intentarPlay() {
      var p = video.play();
      if (p && p.catch) p.catch(function () { /* el navegador exige pulsar play: los controles ya están */ });
    }

    if (usarNativo()) {
      video.src = item.master;
      estado.textContent = '';
      intentarPlay();
      return;
    }

    cargarHlsJs().then(function () {
      if (sesion !== propia) return; // se cerró o cambió de curso mientras cargaba
      if (!window.Hls || !window.Hls.isSupported()) {
        estado.textContent = 'Este navegador no puede reproducir el video. Prueba con una versión más reciente de Chrome, Edge, Firefox o Safari.';
        cargado = false;
        return;
      }
      var Hls = window.Hls;
      // En la intranet el ancho de banda sobra: se arranca ya en la mejor calidad.
      var instancia = new Hls({ abrEwmaDefaultEstimate: 8000000 });
      hls = instancia;

      instancia.on(Hls.Events.MANIFEST_PARSED, function (_, datos) {
        // Empieza en la calidad más alta; el ABR baja solo si la red no alcanza.
        instancia.startLevel = datos.levels.length - 1;
        estado.textContent = '';
        intentarPlay();
      });
      instancia.on(Hls.Events.ERROR, function (_, datos) {
        if (!datos.fatal) return;
        if (datos.type === Hls.ErrorTypes.NETWORK_ERROR) {
          estado.textContent = 'Problema de red. Reintentando…';
          instancia.startLoad();
        } else if (datos.type === Hls.ErrorTypes.MEDIA_ERROR) {
          instancia.recoverMediaError();
        } else {
          estado.textContent = 'No se pudo reproducir este video. Inténtalo de nuevo.';
          instancia.destroy();
          if (hls === instancia) hls = null;
          cargado = false;
        }
      });

      instancia.loadSource(item.master);
      instancia.attachMedia(video);
    }).catch(function () {
      if (sesion !== propia) return;
      estado.textContent = 'No se pudo cargar el reproductor. Recarga la página e inténtalo de nuevo.';
      cargado = false;
    });
  }

  /* ---------- Eventos ---------- */
  lista.addEventListener('click', function (evento) {
    var tarjeta = evento.target.closest('.cv-curso');
    if (tarjeta && cursos[tarjeta.dataset.id]) abrirCurso(cursos[tarjeta.dataset.id]);
  });

  detalle.addEventListener('click', function (evento) {
    if (evento.target.closest('[data-curso="volver"]')) volver();
  });

  video.addEventListener('play', iniciarCarga);

  /* ---------- Ciclo de vida con la navegación ---------- */
  function alNavegar() {
    if (location.hash === '#curso') {
      cargarDatos();
    } else if (!detalle.hidden) {
      volver(); // al salir de Curso el video se detiene y se libera
    }
  }

  window.addEventListener('hashchange', alNavegar);
  alNavegar();
})();
