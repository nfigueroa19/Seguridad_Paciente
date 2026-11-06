/* =====================================================================
   NEUMONÍA CERO — minijuego de la sección Simula
   Réplica en código de "Neumonia Cero/juego neumonia zero.pptx".
   Las diapositivas con imagen se reproducen tal cual y sus cuadros con
   hipervínculo pasan a ser botones reales en la misma posición.
   Módulo autocontenido: IIFE sin globales y estilos con prefijo .nz-.
   Contrato con la plataforma (solo DOM):
   - [data-action="abrir-neumonia-cero"] abre el juego,
   - #simula-catalogo se oculta mientras se juega y #neumonia-cero lo aloja,
   - el reloj y el audio se pausan si la vista Simula o la pestaña dejan de verse.
   ===================================================================== */
(function () {
  'use strict';

  const RUTA = './juegos/neumonia-cero/assets/';
  const SEGUNDOS_POR_RETO = 30;

  /* ---------- Contenido (diapositivas 3 a 19 del PPTX) ---------- */
  const RETOS = [
    {
      caso: 'Carlos Ramírez, de 68 años, permanece con ventilación mecánica desde hace 24 horas. Durante la ronda observas que la cabecera de la cama está completamente horizontal.',
      pregunta: '¿Cuál es el rango recomendado para mantener elevada la cabecera?',
      opciones: [
        { texto: '15°', img: 'cama-15' },
        { texto: '35°', img: 'cama-35', correcta: true },
        { texto: '25°', img: 'cama-25' },
        { texto: '50°', img: 'cama-50' }
      ]
    },
    {
      tipo: 'kit',
      caso: 'Paciente de 72 años con traqueostomía y disfagia. Corresponde realizar la higiene oral según el protocolo institucional.',
      pregunta: 'Selecciona el kit institucional para higiene oral.',
      elementos: [
        { texto: 'Guantes', img: 'kit-guantes', correcta: true },
        { texto: 'Cepillo dental', img: 'kit-cepillo-dental', correcta: true },
        { texto: 'Enjuague bucal', img: 'kit-enjuague-bucal', correcta: true },
        { texto: 'Gasas estériles', img: 'kit-gasas-esteriles', correcta: true },
        { texto: 'Alcohol al 70 %', img: 'kit-alcohol-70' },
        { texto: 'Clorhexidina al 0,12 %', img: 'kit-clorhexidina' },
        { texto: 'Crema dental', img: 'kit-crema-dental' },
        { texto: 'Hisopo de espuma', img: 'kit-hisopo' },
        { texto: 'Vaso con agua', img: 'kit-vaso-agua' },
        { texto: 'Toalla', img: 'kit-toalla' },
        { texto: 'Bajalenguas', img: 'kit-bajalenguas' },
        { texto: 'Algodón', img: 'kit-algodon' }
      ]
    },
    {
      caso: 'Paciente hospitalizado desde hace 5 días. Permanece acostado la mayor parte del tiempo.',
      pregunta: '¿Qué intervención ayuda a prevenir la neumonía?',
      opciones: [
        { texto: 'Mantener reposo absoluto' },
        { texto: 'Suspender la fisioterapia' },
        { texto: 'Disminuir la hidratación' },
        { texto: 'Favorecer la movilización temprana', correcta: true }
      ]
    },
    {
      caso: 'Paciente consciente y alerta con traqueostomía. Durante el turno aún no se ha realizado higiene oral.',
      pregunta: '¿Qué debe hacer el auxiliar de enfermería?',
      opciones: [
        { texto: 'Esperar al siguiente turno' },
        { texto: 'Cambiar la cánula' },
        { texto: 'Solicitar antibióticos' },
        { texto: 'Realizar higiene oral según protocolo', correcta: true }
      ]
    },
    {
      caso: 'Paciente posoperatoria de cirugía abdominal mayor con dolor para respirar profundamente.',
      sinEtiqueta: true, // la diapositiva 11 no lleva el rótulo "Caso clínico"
      pregunta: '¿Qué interconsulta se debe pedir?',
      opciones: [
        { texto: 'Terapia física' },
        { texto: 'Nutrición' },
        { texto: 'Trabajo social' },
        { texto: 'Terapia respiratoria', correcta: true }
      ]
    },
    {
      caso: 'Paciente de 85 años con fractura de cadera que permanece en cama.',
      pregunta: '¿Qué debemos realizar para evitar complicaciones respiratorias?',
      opciones: [
        { texto: 'Suspender cambios de posición' },
        { texto: 'Mantener reposo permanente' },
        { texto: 'Limitar la terapia respiratoria' },
        { texto: 'Terapia respiratoria preventiva', correcta: true }
      ]
    },
    {
      caso: 'Paciente de 90 años con antecedente de EPOC, oxigenorrequirente, que permanece en observación durante 12 horas mientras espera hospitalización.',
      pregunta: '¿Cuándo deben iniciarse las medidas preventivas?',
      opciones: [
        { texto: 'Solo si presenta fiebre' },
        { texto: 'Después de 24 horas' },
        { texto: 'Al ingreso a hospitalización' },
        { texto: 'Desde el ingreso a urgencias', correcta: true }
      ]
    },
    {
      pregunta: '¿Cuál de estos es un factor de riesgo para desarrollar neumonía?',
      opciones: [
        { texto: 'Diabetes controlada' },
        { texto: 'Migraña' },
        { texto: 'Hipertensión arterial' },
        { texto: 'Uso de sonda nasogástrica', correcta: true }
      ]
    },
    {
      pregunta: '¿Por qué es importante la higiene de manos en la prevención de la neumonía?',
      opciones: [
        { texto: 'Evita únicamente infecciones gastrointestinales' },
        { texto: 'Para cumplir los 5 momentos' },
        { texto: 'Reemplaza los EPP' },
        { texto: 'Disminuye la transmisión de microorganismos', correcta: true }
      ]
    }
  ];

  /* Texto incrustado en las imágenes de las diapositivas, para lectores de pantalla */
  const TEXTO_BIENVENIDA = '¡Bienvenido a la Misión Neumonía Zero! Hoy cuidarás a un paciente conectado a ventilación mecánica. Tu objetivo es aplicar correctamente las 5 acciones del Bundle institucional para prevenir una neumonía. ¡Cada decisión cuenta!';
  const TEXTO_INSTRUCCIONES = '¡Bienvenido a la Misión Neumonía Zero! Supera cada reto para proteger a tu paciente y prevenir la neumonía asociada al cuidado de la salud. 1. Identifica a los pacientes en riesgo. 2. Aplica correctamente el Bundle de prevención. 3. Reconoce cuándo iniciar terapia respiratoria preventiva. 4. Selecciona el kit institucional para higiene oral. 5. Ubica al paciente en la posición correcta. 6. Organiza los pasos para un manejo seguro de la vía aérea. 7. Relaciona cada profesional con su función. 8. Identifica los candidatos para higiene oral protocolizada. ¡Completa todos los retos y conviértete en un Guardián de Neumonía Zero!';
  const TEXTO_TIEMPO = 'Misión Neumonía Zero. Protege la respiración de tu paciente. ¡Se acabó el tiempo! No te rindas.';
  const TEXTO_FINAL = '¡Misión cumplida! Has completado todos los retos y demostrado que conoces las medidas esenciales para prevenir la Neumonía Asociada al Cuidado de la Salud (NACS). Neumonía Zero. Recuerda siempre: identificar al paciente en riesgo; aplicar el Bundle de prevención; mantener una correcta higiene de manos; realizar higiene oral según protocolo; favorecer la movilización y la terapia respiratoria cuando estén indicadas. Cada acción cuenta. Cada intervención protege una vida. ¡Felicitaciones, eres un Guardián de Neumonía Zero!';

  /* Audio. Volúmenes tomados de los nodos <p:cMediaNode> del PPTX (portada 20 %, retos 62 %, locuciones 80 %) */
  const AUDIO = {
    'musica-portada': { canal: 'musica', volumen: 0.2, bucle: true },
    'musica-retos': { canal: 'musica', volumen: 0.62, bucle: true },
    'responde-pregunta': { canal: 'voz', volumen: 0.8 },
    'respuesta-correcta': { canal: 'voz', volumen: 0.8 },
    'respuesta-incorrecta': { canal: 'voz', volumen: 0.8 },
    'clic-boton': { canal: 'efecto', volumen: 1, ext: 'wav' } // "hammer.wav" de los botones con hipervínculo
  };

  /* ---------- Referencias y estado ---------- */
  const raiz = document.getElementById('neumonia-cero');
  const catalogo = document.getElementById('simula-catalogo');
  const botonesAbrir = document.querySelectorAll('[data-action="abrir-neumonia-cero"]');
  if (!raiz || !catalogo) return;
  const vista = raiz.closest('.view');

  const estado = {
    pantalla: null,
    indice: 0,
    aciertos: 0,        // retos resueltos al primer intento
    fallo: false,       // hubo error o se agotó el tiempo en el reto actual
    resuelto: false,
    restante: SEGUNDOS_POR_RETO,
    intervalo: null,
    sonido: true,       // interruptor general de la barra del juego
    musicaActiva: true, // altavoz de las diapositivas (como el icono de audio del PPTX)
    musica: null,       // pista de música que corresponde a la pantalla actual
    opciones: [],       // opciones del reto actual, ya barajadas
    elegidos: 0
  };
  const sonidos = {};
  let pantalla = null;
  let ultimoBotonAbrir = null;

  /* ---------- Utilidades ---------- */
  const esc = (texto) => String(texto).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const img = (nombre) => `${RUTA}img/${nombre}.webp`;
  const reto = () => RETOS[estado.indice];

  // Posición de un cuadro del PPTX (en EMU) como porcentaje del lienzo de 12 192 000 × 6 858 000.
  const posicion = (x, y, ancho, alto) =>
    `left:${x / 121920}%;top:${y / 68580}%;width:${ancho / 121920}%;height:${alto / 68580}%`;

  function barajar(lista) {
    const copia = lista.slice();
    for (let i = copia.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copia[i], copia[j]] = [copia[j], copia[i]];
    }
    return copia;
  }

  // Los botones sobre la imagen tienen el ancho fijo del cuadro del PPTX; si el texto no cabe
  // (la letra web es más ancha que la Calibri original), se reduce hasta que quepa.
  // Se mide el texto con un Range (ancho real, con decimales) porque scrollWidth redondea y no ve desbordes de 1-2 px.
  function noCabe(boton) {
    const estilo = getComputedStyle(boton);
    const disponible = boton.clientWidth - parseFloat(estilo.paddingLeft) - parseFloat(estilo.paddingRight);
    const rango = document.createRange();
    rango.selectNodeContents(boton);
    return rango.getBoundingClientRect().width > disponible - 2;
  }

  function ajustarBotones() {
    pantalla.querySelectorAll('.nz-escena .nz-boton-ppt').forEach((boton) => {
      boton.style.fontSize = '';
      if (getComputedStyle(boton).position !== 'absolute') return;
      let tamano = parseFloat(getComputedStyle(boton).fontSize);
      while (noCabe(boton) && tamano > 6) {
        tamano -= 0.5;
        boton.style.fontSize = `${tamano}px`;
      }
    });
  }

  function pintar(nombre, html) {
    estado.pantalla = nombre;
    pantalla.innerHTML = html;
    pantalla.dataset.pantalla = nombre;
    ajustarBotones();
    const foco = pantalla.querySelector('[data-foco]');
    if (foco) foco.focus({ preventScroll: true });
    raiz.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  // Diapositiva con imagen a sangre: la imagen es el fondo y los botones van encima.
  // En pantallas angostas los botones de texto bajan debajo de la imagen (.nz-escena--pie).
  function escena(imagen, titulo, descripcion, botones) {
    const pie = botones.includes('nz-boton-ppt') ? ' nz-escena--pie' : '';
    return `
      <div class="nz-escena${pie}">
        <img class="nz-escena-img" src="${img(imagen)}" alt="" width="1600" height="900">
        <h2 class="nz-sr" tabindex="-1" data-foco>${esc(titulo)}</h2>
        <p class="nz-sr">${esc(descripcion)}</p>
        ${botones}
      </div>`;
  }

  const botonPpt = (texto, accion, pos) =>
    `<button class="nz-boton-ppt nz-en-escena" type="button" data-nz="${accion}" style="${pos}">${texto}</button>`;

  const altavoz = (estilo) => `
    <button class="nz-altavoz${estilo ? ' nz-en-escena' : ''}" type="button" data-nz="musica" aria-pressed="${estado.musicaActiva}"
      aria-label="Música" title="Música"${estilo ? ` style="${estilo}"` : ''}>
      <img src="${img('icono-sonido')}" alt="">
    </button>`;

  /* ---------- Sonido ---------- */
  function pista(nombre) {
    if (!sonidos[nombre]) {
      const config = AUDIO[nombre];
      const audio = new Audio(`${RUTA}audio/${nombre}.${config.ext || 'mp3'}`);
      audio.volume = config.volumen;
      audio.loop = Boolean(config.bucle);
      sonidos[nombre] = audio;
    }
    return sonidos[nombre];
  }

  function tocar(audio) {
    audio.play().catch(() => {}); // el navegador puede bloquear el audio; el juego sigue sin él
  }

  function silenciarCanal(canal) {
    Object.keys(sonidos).forEach((nombre) => {
      if (AUDIO[nombre].canal === canal) sonidos[nombre].pause();
    });
  }

  function reproducir(nombre) {
    if (!estado.sonido) return;
    const { canal } = AUDIO[nombre];
    if (canal !== 'efecto') silenciarCanal(canal);
    const audio = pista(nombre);
    audio.currentTime = 0;
    tocar(audio);
  }

  // Cambia la música de fondo; si la pista ya suena, sigue sin reiniciarse.
  function ponerMusica(nombre) {
    estado.musica = nombre;
    Object.keys(sonidos).forEach((otra) => {
      if (AUDIO[otra].canal === 'musica' && otra !== nombre) {
        sonidos[otra].pause();
        sonidos[otra].currentTime = 0;
      }
    });
    if (nombre && estado.sonido && estado.musicaActiva && pista(nombre).paused) tocar(pista(nombre));
  }

  function pausarAudio() {
    Object.values(sonidos).forEach((audio) => { audio.pause(); });
  }

  function reanudarMusica() {
    if (estado.musica && estado.sonido && estado.musicaActiva) tocar(pista(estado.musica));
  }

  function alternarSonido(boton) {
    estado.sonido = !estado.sonido;
    if (estado.sonido) reanudarMusica();
    else pausarAudio();
    boton.setAttribute('aria-pressed', String(estado.sonido));
    boton.querySelector('[data-icono]').textContent = estado.sonido ? '🔊' : '🔇';
  }

  function alternarMusica() {
    estado.musicaActiva = !estado.musicaActiva;
    if (estado.musicaActiva) reanudarMusica();
    else silenciarCanal('musica');
    pantalla.querySelectorAll('[data-nz="musica"]').forEach((b) => {
      b.setAttribute('aria-pressed', String(estado.musicaActiva));
    });
  }

  /* ---------- Temporizador ---------- */
  function detenerTemporizador() {
    clearInterval(estado.intervalo);
    estado.intervalo = null;
  }

  function reanudarTemporizador() {
    if (estado.intervalo || estado.pantalla !== 'reto' || estado.resuelto) return;
    estado.intervalo = setInterval(tic, 1000);
  }

  function tic() {
    estado.restante -= 1;
    pintarCuenta();
    if (estado.restante <= 0) {
      detenerTemporizador();
      estado.fallo = true;
      mostrarTiempoAgotado();
    }
  }

  function pintarCuenta() {
    const cuenta = pantalla.querySelector('.nz-cuenta');
    if (!cuenta) return;
    cuenta.textContent = estado.restante;
    cuenta.setAttribute('aria-label', `Tiempo restante: ${estado.restante} segundos`);
    cuenta.classList.toggle('is-alerta', estado.restante <= 10 && estado.restante > 5);
    cuenta.classList.toggle('is-critico', estado.restante <= 5);
  }

  /* ---------- Diapositivas 1 y 2 ---------- */
  function mostrarPortada() {
    pintar('portada', escena('bienvenida', '¡Bienvenido a la Misión Neumonía Zero!', TEXTO_BIENVENIDA, `
      <button class="nz-boton-jugar nz-en-escena" type="button" data-nz="instrucciones" aria-label="Jugar"
        style="${posicion(6429375, 5113350, 3800475, 982650)}">
        <img src="${img('boton-jugar')}" alt="">
      </button>
      ${altavoz(posicion(485775, 6096000, 609600, 609600))}`));
    ponerMusica('musica-portada');
  }

  function mostrarInstrucciones() {
    pintar('instrucciones', escena('instrucciones', 'Instrucciones de la Misión Neumonía Zero', TEXTO_INSTRUCCIONES,
      botonPpt('SIGUIENTE', 'comenzar', posicion(1066800, 6210300, 1450177, 402666))));
    ponerMusica('musica-portada');
  }

  /* ---------- Retos (diapositivas 3 a 19) ---------- */
  function cabeceraReto() {
    return `
      <div class="nz-diapo-cab">
        ${altavoz()}
        <span class="nz-diapo-titulo">Neumonía Zero</span>
        <span class="nz-diapo-reto">Reto ${estado.indice + 1} de ${RETOS.length}</span>
        <span class="nz-cuenta" role="timer" aria-label="Tiempo restante: ${SEGUNDOS_POR_RETO} segundos">${SEGUNDOS_POR_RETO}</span>
      </div>`;
  }

  function enunciado(r) {
    const etiqueta = r.caso && !r.sinEtiqueta ? '<span class="nz-enunciado-etiqueta">Caso clínico</span>' : '';
    return `
      <div class="nz-enunciado">
        ${etiqueta}
        ${r.caso ? `<p>${esc(r.caso)}</p>` : ''}
        <h2 class="nz-pregunta" tabindex="-1" data-foco>${esc(r.pregunta)}</h2>
      </div>`;
  }

  function pieReto() {
    const ultimo = estado.indice === RETOS.length - 1;
    return `
      <p class="nz-sr" role="status" aria-live="polite" data-aviso></p>
      <div class="nz-diapo-pie">
        <button class="nz-boton-ppt" type="button" data-nz="siguiente" disabled>${ultimo ? 'FINALIZAR' : 'SIGUIENTE'}</button>
      </div>`;
  }

  function mostrarReto() {
    const r = reto();
    estado.resuelto = false;
    estado.elegidos = 0;
    estado.opciones = barajar(r.tipo === 'kit' ? r.elementos : r.opciones);

    let cuerpo;
    if (r.tipo === 'kit') {
      const objetivo = r.elementos.filter((e) => e.correcta).length;
      const items = estado.opciones.map((e, i) => `
        <button class="nz-item" type="button" data-nz="elegir" data-i="${i}" aria-label="${esc(e.texto)}" title="${esc(e.texto)}">
          <img src="${img(e.img)}" alt="">
        </button>`).join('');
      cuerpo = `
        <div class="nz-kit">
          <div class="nz-bandeja">
            <ul class="nz-bandeja-items" aria-label="Kit de higiene oral: 0 de ${objetivo} elementos">${'<li class="nz-hueco"></li>'.repeat(objetivo)}</ul>
          </div>
          <div class="nz-kit-items" role="group" aria-label="Elementos disponibles">${items}</div>
        </div>`;
    } else {
      const conImagen = estado.opciones.some((o) => o.img);
      const opciones = estado.opciones.map((o, i) => o.img
        ? `<button class="nz-opcion nz-opcion--img" type="button" data-nz="responder" data-i="${i}" aria-label="${esc(o.texto)}">
             <img src="${img(o.img)}" alt="">
           </button>`
        : `<button class="nz-opcion" type="button" data-nz="responder" data-i="${i}">${esc(o.texto)}</button>`).join('');
      cuerpo = `<div class="nz-opciones${conImagen ? ' nz-opciones--img' : ''}" role="group" aria-label="Opciones de respuesta">${opciones}</div>`;
    }

    pintar('reto', `
      <div class="nz-diapo">
        ${cabeceraReto()}
        <div class="nz-diapo-cuerpo">
          ${enunciado(r)}
          ${cuerpo}
          ${pieReto()}
        </div>
      </div>`);

    estado.restante = SEGUNDOS_POR_RETO;
    pintarCuenta();
    reanudarTemporizador();
    ponerMusica('musica-retos');
    reproducir('responde-pregunta');
  }

  function avisar(texto) {
    pantalla.querySelector('[data-aviso]').textContent = texto;
  }

  function resolverReto() {
    estado.resuelto = true;
    detenerTemporizador();
    if (!estado.fallo) estado.aciertos += 1;
    const siguiente = pantalla.querySelector('[data-nz="siguiente"]');
    siguiente.disabled = false;
    siguiente.focus();
  }

  function responder(boton) {
    if (estado.resuelto) return;
    const opcion = estado.opciones[Number(boton.dataset.i)];
    if (opcion.correcta) {
      boton.classList.add('is-correcta');
      pantalla.querySelectorAll('.nz-opcion').forEach((b) => { b.disabled = true; });
      avisar(`Respuesta correcta: ${opcion.texto}.`);
      reproducir('respuesta-correcta');
      resolverReto();
    } else {
      boton.classList.add('is-incorrecta');
      boton.disabled = true;
      estado.fallo = true;
      avisar(`Respuesta incorrecta: ${opcion.texto}. Intenta de nuevo.`);
      reproducir('respuesta-incorrecta');
    }
  }

  function elegir(boton) {
    if (estado.resuelto) return;
    const elemento = estado.opciones[Number(boton.dataset.i)];
    const objetivo = reto().elementos.filter((e) => e.correcta).length;
    boton.disabled = true;

    if (!elemento.correcta) {
      boton.classList.add('is-incorrecta');
      estado.fallo = true;
      avisar(`${elemento.texto} no hace parte del kit. Intenta con otro elemento.`);
      reproducir('respuesta-incorrecta');
      return;
    }

    boton.classList.add('is-elegido');
    estado.elegidos += 1;
    const hueco = pantalla.querySelector('.nz-hueco');
    hueco.className = 'nz-en-bandeja';
    hueco.innerHTML = `<img src="${img(elemento.img)}" alt="${esc(elemento.texto)}" title="${esc(elemento.texto)}">`;
    pantalla.querySelector('.nz-bandeja-items').setAttribute('aria-label', `Kit de higiene oral: ${estado.elegidos} de ${objetivo} elementos`);

    if (estado.elegidos === objetivo) {
      pantalla.querySelectorAll('.nz-item').forEach((b) => { b.disabled = true; });
      pantalla.querySelector('.nz-bandeja').classList.add('is-completa');
      avisar('Kit completo.');
      reproducir('respuesta-correcta');
      resolverReto();
    } else {
      avisar(`${elemento.texto}: correcto, ${estado.elegidos} de ${objetivo}.`);
      reproducir('respuesta-correcta');
    }
  }

  /* ---------- Diapositivas de cierre ---------- */
  function mostrarTiempoAgotado() {
    silenciarCanal('voz');
    ponerMusica(null);
    pintar('tiempo', escena('tiempo-agotado', `Se acabó el tiempo del reto ${estado.indice + 1}`, TEXTO_TIEMPO,
      botonPpt('JUGAR NUEVAMENTE', 'repetir', posicion(8656849, 5974901, 2746953, 609490))));
  }

  function mostrarFinal() {
    ponerMusica(null);
    pintar('final', `
      ${escena('mision-cumplida', '¡Misión cumplida!', TEXTO_FINAL,
        botonPpt('VOLVER AL INICIO', 'inicio', posicion(1038225, 5943600, 2231227, 371474)))}
      <div class="nz-resultado">
        <div class="nz-puntaje"><b>${estado.aciertos} / ${RETOS.length}</b><span>retos resueltos al primer intento</span></div>
        <button class="btn btn-outline" type="button" data-nz="salir">Volver a Simula</button>
      </div>`);
  }

  /* ---------- Flujo ---------- */
  function comenzarMision() {
    estado.indice = 0;
    estado.aciertos = 0;
    estado.fallo = false;
    mostrarReto();
  }

  function siguienteReto() {
    if (estado.indice === RETOS.length - 1) {
      mostrarFinal();
      return;
    }
    estado.indice += 1;
    estado.fallo = false;
    mostrarReto();
  }

  function abrirJuego(boton) {
    ultimoBotonAbrir = boton;
    if (!pantalla) {
      raiz.innerHTML = `
        <div class="nz-barra">
          <span class="nz-marca"><span aria-hidden="true">🫁</span> Neumonía Cero</span>
          <div class="nz-barra-acciones">
            <button class="nz-control" type="button" data-nz="sonido" aria-pressed="true"><span data-icono aria-hidden="true">🔊</span> Sonido</button>
            <button class="nz-control" type="button" data-nz="salir"><span aria-hidden="true">✕</span> Salir</button>
          </div>
        </div>
        <div class="nz-pantalla"></div>`;
      pantalla = raiz.querySelector('.nz-pantalla');
      new ResizeObserver(ajustarBotones).observe(pantalla);
      document.fonts.ready.then(ajustarBotones);
    }
    catalogo.hidden = true;
    raiz.hidden = false;
    mostrarPortada();
  }

  function salirJuego() {
    detenerTemporizador();
    ponerMusica(null);
    pausarAudio();
    estado.pantalla = null;
    raiz.hidden = true;
    catalogo.hidden = false;
    if (ultimoBotonAbrir) ultimoBotonAbrir.focus();
  }

  /* ---------- Eventos ---------- */
  const ACCIONES = {
    instrucciones: mostrarInstrucciones,
    comenzar: comenzarMision,
    responder,
    elegir,
    siguiente: siguienteReto,
    repetir: mostrarReto,
    inicio: mostrarPortada,
    musica: alternarMusica,
    sonido: alternarSonido,
    salir: salirJuego
  };

  raiz.addEventListener('click', (evento) => {
    const boton = evento.target.closest('[data-nz]');
    if (!boton || boton.disabled) return;
    if (boton.classList.contains('nz-boton-ppt')) reproducir('clic-boton');
    ACCIONES[boton.dataset.nz](boton);
  });

  botonesAbrir.forEach((boton) => {
    boton.addEventListener('click', () => abrirJuego(boton));
  });

  // script.js oculta las vistas en su propio "hashchange", registrado antes que este.
  function alCambiarVisibilidad() {
    if (!estado.pantalla) return;
    if (document.hidden || (vista && vista.hidden)) {
      detenerTemporizador();
      pausarAudio();
    } else {
      reanudarTemporizador();
      reanudarMusica();
    }
  }
  window.addEventListener('hashchange', alCambiarVisibilidad);
  document.addEventListener('visibilitychange', alCambiarVisibilidad);
})();
