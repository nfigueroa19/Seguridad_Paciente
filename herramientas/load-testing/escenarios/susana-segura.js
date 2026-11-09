// =====================================================================
// Prueba de carga de la SPA "Susana Segura" (app-plataforma/) con k6.
//
// Tres perfiles de usuario corren en paralelo, cada uno como escenario k6:
//   - navegacion: abre la SPA y recorre vistas del menú lateral.
//   - video:      entra al curso y reproduce un video HLS como lo haría hls.js.
//   - juego:      abre "Simula" y juega Misión Neumonía Cero.
//
// Las vistas cambian por hash (#inicio, #curso…), así que el servidor nunca ve
// esas rutas: solo recibe index.html y los recursos que cada vista pide.
//
// Parámetros (k6 run -e NOMBRE=valor o variables de entorno):
//   BASE_URL   URL del servidor                      (http://127.0.0.1:8787)
//   VUS        usuarios virtuales en el pico         (200)
//   MEZCLA     % video,navegacion,juego              (50,30,20)
//   RAMPA      subida hasta el pico                  (30s)
//   MANTENER   tiempo en el pico                     (2m)
//   BAJADA     bajada a cero                         (15s)
//   RITMO      tiempo-real | maximo                  (tiempo-real)
//              tiempo-real: cada espectador pide segmentos al ritmo de la reproducción
//              maximo:      pide segmentos sin pausa (prueba de estrés del servidor)
//   PAUSAS     1 = tiempos de lectura humanos; 0 = sin pausas (1)
//   RETORNO    fracción de visitas que revalidan con ETag (0.3)
//   CALIDAD    mixta | maxima                        (mixta)
//              mixta:  20 % 360p, 50 % 720p, 30 % 1080p (redes variadas)
//              maxima: todos terminan en la resolución más alta (intranet cableada)
//   COPIAS     cuántas copias de cada video del catálogo (1). Con 5, los 4 videos reales
//              se piden como 20 videos distintos (rutas media/videos/copiaN-<id>/).
//              El servidor debe mapear esas rutas (ver intranet/nginx-prueba.conf).
//   ESCALONES  lista de usuarios totales, p. ej. "50,200,500,1000". Si se define, reemplaza
//              a VUS: cada escalón sube en RAMPA y se mantiene MANTENER; las métricas
//              llevan la etiqueta escalon=<usuarios> para ver dónde empieza a degradarse.
// =====================================================================
import http from 'k6/http';
import exec from 'k6/execution';
import { check, group, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { leerMaster, leerVariante } from './lib/hls.js';

// ---------- Parámetros ----------
const BASE = (__ENV.BASE_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '');
const VUS = Number(__ENV.VUS || 200);
const [P_VIDEO, P_NAV, P_JUEGO] = (__ENV.MEZCLA || '50,30,20').split(',').map(Number);
const RAMPA = __ENV.RAMPA || '30s';
const MANTENER = __ENV.MANTENER || '2m';
const BAJADA = __ENV.BAJADA || '15s';
const RITMO = __ENV.RITMO || 'tiempo-real';
const PAUSAS = (__ENV.PAUSAS || '1') !== '0';
const RETORNO = Number(__ENV.RETORNO ?? 0.3);
const CALIDAD = __ENV.CALIDAD || 'mixta';
const COPIAS = Math.max(1, Number(__ENV.COPIAS || 1));
const ESCALONES = (__ENV.ESCALONES || '').split(',').map(Number).filter((n) => n > 0);

// hls.js mantiene hasta 30 s de video descargado por delante (maxBufferLength).
const BUFFER_MAX_S = 30;

// Perfil de red de cada espectador -> resolución a la que llega el ABR.
const PERFILES_RED = CALIDAD === 'maxima'
  ? [{ nombre: 'cableada', peso: 1, nivel: 2 }]  // 1080p para todos
  : [
    { nombre: 'movil', peso: 0.2, nivel: 0 },   // 360p
    { nombre: 'wifi', peso: 0.5, nivel: 1 },    // 720p
    { nombre: 'fibra', peso: 0.3, nivel: 2 },   // 1080p
  ];

// "1m30s" -> 90
function segundos(duracion) {
  let total = 0;
  for (const [, n, u] of duracion.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)) {
    total += Number(n) * { ms: 0.001, s: 1, m: 60, h: 3600 }[u];
  }
  return total;
}
const SEG_ESCALON = segundos(RAMPA) + segundos(MANTENER);

// Etiqueta escalon=<usuarios> en todas las métricas que se emitan desde aquí.
function marcarEscalon() {
  if (ESCALONES.length === 0) return;
  const transcurrido = exec.instance.currentTestRunDuration / 1000;
  const i = Math.floor(transcurrido / SEG_ESCALON);
  exec.vu.metrics.tags.escalon = i < ESCALONES.length ? String(ESCALONES[i]) : 'bajada';
}

const VISTAS = ['inicio', 'aprende', 'conoce', 'curso', 'detecta', 'simula', 'perfil', 'admin'];
const JUEGO = './juegos/neumonia-cero/assets/';

// ---------- Métricas propias ----------
const arranqueVideo = new Trend('hls_arranque_ms', true);          // master -> primer segmento listo
const ratioSegmento = new Trend('hls_ratio_descarga');             // tiempo de descarga / duración del segmento
const eventosRebuffer = new Counter('hls_rebuffer_eventos');
const sesionesRebuffer = new Rate('hls_sesiones_con_rebuffer');
const segundosVistos = new Counter('hls_segundos_reproducidos');
const mimeIncorrecto = new Counter('mime_incorrecto');
const revalidaciones = new Rate('revalidacion_304');               // de las peticiones condicionales, cuántas dieron 304

// ---------- Escenarios ----------
function usuarios(total, porcentaje) {
  return Math.max(1, Math.round((total * porcentaje) / 100));
}

function escenario(funcion, porcentaje) {
  const picos = ESCALONES.length > 0 ? ESCALONES : [VUS];
  const stages = [];
  for (const total of picos) {
    stages.push({ duration: RAMPA, target: usuarios(total, porcentaje) });
    stages.push({ duration: MANTENER, target: usuarios(total, porcentaje) });
  }
  stages.push({ duration: BAJADA, target: 0 });
  return {
    executor: 'ramping-vus',
    exec: funcion,
    startVUs: 0,
    stages,
    gracefulRampDown: '10s',
    gracefulStop: '10s',
  };
}

// Criterios de aceptación acordados el 2026-11-09 ("experiencia fluida en la mejor calidad").
// Los recursos "ligeros" son HTML, CSS, JS, catalogo.json y las listas .m3u8.
const CRITERIOS = {
  http_req_failed: ['rate<0.001'],
  'http_req_duration{clase:ligero}': ['p(95)<300'],
  hls_arranque_ms: ['p(95)<2000'],
  hls_ratio_descarga: ['p(95)<0.5'],
  hls_sesiones_con_rebuffer: ['rate<0.01'],
};

function umbrales() {
  const t = {
    ...CRITERIOS,
    checks: ['rate>0.999'],
    // Sin criterio acordado; se dejan como referencia y para el desglose del resumen.
    'http_req_duration{recurso:documento}': ['p(95)<300'],
    'http_req_duration{recurso:estatico}': ['p(95)<300'],
    'http_req_duration{recurso:catalogo}': ['p(95)<300'],
    'http_req_duration{recurso:playlist}': ['p(95)<300'],
    'http_req_duration{recurso:imagen}': ['p(95)<1000'],
    'http_req_duration{recurso:audio}': ['p(95)<3000'],
    'http_req_duration{recurso:segmento}': ['p(95)<3000'],
  };
  // Los mismos criterios por escalón, para ubicar el punto de quiebre.
  for (const e of ESCALONES) {
    for (const [nombre, regla] of Object.entries(CRITERIOS)) {
      const [base, filtro] = nombre.includes('{') ? nombre.slice(0, -1).split('{') : [nombre, ''];
      t[`${base}{${filtro ? filtro + ',' : ''}escalon:${e}}`] = regla;
    }
    t[`http_reqs{escalon:${e}}`] = ['count>=0'];
    t[`data_received{escalon:${e}}`] = ['count>=0'];
    t[`http_req_duration{recurso:segmento,escalon:${e}}`] = ['p(95)<3000'];
  }
  return t;
}

export const options = {
  scenarios: {
    video: escenario('video', P_VIDEO),
    navegacion: escenario('navegacion', P_NAV),
    juego: escenario('juego', P_JUEGO),
  },
  thresholds: umbrales(),
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  discardResponseBodies: false,
  userAgent: 'k6-susana-segura-carga/1.0',
};

// ---------- Caché del navegador simulada ----------
// Cada iteración es una visita. Dentro de una visita un recurso se pide una sola vez
// (caché en memoria). Entre visitas del mismo VU se guardan los ETag: una fracción
// RETORNO de las visitas revalida con If-None-Match, como hace el navegador con
// "max-age=0, must-revalidate".
const etags = {};
let visitados = new Set();
let esRetorno = false;

function nuevaVisita() {
  visitados = new Set();
  esRetorno = Object.keys(etags).length > 0 && Math.random() < RETORNO;
}

function pausa(min, max) {
  if (PAUSAS) sleep(min + Math.random() * (max - min));
}

function absoluta(ruta) {
  return BASE + '/' + ruta.replace(/^\.?\//, '');
}

const MIME_ESPERADO = {
  documento: 'text/html',
  estatico: /text\/css|javascript/,
  imagen: 'image/webp',
  audio: /audio\//,
  catalogo: 'application/json',
  playlist: /mpegurl/i,
  segmento: 'video/mp2t',
};

function verificar(res, recurso) {
  const ok = check(res, { [`${recurso}: 200/304`]: (r) => r.status === 200 || r.status === 304 }, { recurso });
  if (res.status === 200) {
    const tipo = res.headers['Content-Type'] || '';
    const esperado = MIME_ESPERADO[recurso];
    const coincide = esperado instanceof RegExp ? esperado.test(tipo) : tipo.startsWith(esperado);
    if (!coincide) mimeIncorrecto.add(1, { recurso, tipo });
    if (res.headers.Etag) etags[res.url] = res.headers.Etag;
  }
  return ok;
}

const LIGEROS = ['documento', 'estatico', 'catalogo', 'playlist'];

function etiquetas(recurso, nombre, extra = {}) {
  const tags = { recurso, name: nombre, ...extra };
  if (LIGEROS.includes(recurso)) tags.clase = 'ligero';
  return tags;
}

function parametros(url, recurso, nombre, cuerpo) {
  const params = {
    tags: etiquetas(recurso, nombre),
    responseType: cuerpo ? 'text' : 'none',
    headers: {},
  };
  if (esRetorno && etags[url]) {
    params.headers['If-None-Match'] = etags[url];
    params.tags.condicional = 'si';
  }
  return params;
}

function registrarRevalidacion(res, params) {
  if (params.headers['If-None-Match']) revalidaciones.add(res.status === 304);
}

// GET con caché de visita. Devuelve null si el recurso ya estaba en memoria.
function pedir(ruta, recurso, nombre, cuerpo = false) {
  marcarEscalon();
  const url = absoluta(ruta);
  if (visitados.has(url)) return null;
  visitados.add(url);
  const params = parametros(url, recurso, nombre || ruta, cuerpo);
  const res = http.get(url, params);
  registrarRevalidacion(res, params);
  verificar(res, recurso);
  return res;
}

// Varias peticiones en paralelo (como el navegador al leer el <head>).
function pedirEnParalelo(lista) {
  marcarEscalon();
  const pendientes = lista
    .map(([ruta, recurso, nombre]) => ({ url: absoluta(ruta), recurso, nombre: nombre || ruta }))
    .filter((p) => !visitados.has(p.url));
  if (pendientes.length === 0) return;
  pendientes.forEach((p) => visitados.add(p.url));
  const peticiones = pendientes.map((p) => ({
    method: 'GET',
    url: p.url,
    params: parametros(p.url, p.recurso, p.nombre, false),
  }));
  const respuestas = http.batch(peticiones);
  respuestas.forEach((res, i) => {
    registrarRevalidacion(res, peticiones[i].params);
    verificar(res, pendientes[i].recurso);
  });
}

// ---------- Pasos comunes ----------
// Google Fonts queda fuera: es un tercero y no forma parte del despliegue.
function abrirSpa() {
  group('abrir SPA', () => {
    pedir('', 'documento', 'index.html');
    pedirEnParalelo([
      ['styles.css', 'estatico'],
      ['juegos/neumonia-cero/neumonia-cero.css', 'estatico'],
      ['script.js', 'estatico'],
      ['juegos/neumonia-cero/neumonia-cero.js', 'estatico'],
    ]);
  });
}

function irAVista(vista) {
  // El cambio de hash no genera peticiones; solo los recursos perezosos de la vista.
  if (vista === 'simula') pedir(JUEGO + 'img/portada.webp', 'imagen', 'juego/img/*.webp');
}

function elegirPerfilRed() {
  let azar = Math.random();
  for (const perfil of PERFILES_RED) {
    if ((azar -= perfil.peso) <= 0) return perfil;
  }
  return PERFILES_RED[PERFILES_RED.length - 1];
}

// ---------- Escenario 1: navegación ----------
export function navegacion() {
  nuevaVisita();
  abrirSpa();
  pausa(3, 8);
  const cuantas = 3 + Math.floor(Math.random() * 4);
  for (let i = 0; i < cuantas; i++) {
    irAVista(VISTAS[Math.floor(Math.random() * VISTAS.length)]);
    pausa(5, 15);
  }
}

// ---------- Escenario 2: reproducción de video HLS ----------
export function video() {
  nuevaVisita();
  abrirSpa();
  irAVista('curso');

  let catalogo = [];
  group('catálogo del curso', () => {
    const res = pedir('media/videos/catalogo.json', 'catalogo', 'media/videos/catalogo.json', true);
    if (res && res.status === 200) catalogo = conCopias(res.json());
    // Las tarjetas muestran el póster de cada video (preload="none": nada más).
    pedirEnParalelo(catalogo.map((v) => [v.poster, 'imagen', 'media/videos/*/poster.webp']));
  });
  if (catalogo.length === 0) return;

  pausa(2, 6);
  const elegido = catalogo[Math.floor(Math.random() * catalogo.length)];
  reproducir(elegido, elegirPerfilRed());
  pausa(2, 5);
}

// Con COPIAS=N, cada video se presenta como N videos distintos (copia1-<id> … copiaN-<id>).
function conCopias(lista) {
  if (COPIAS === 1) return lista;
  const copias = [];
  for (let k = 1; k <= COPIAS; k++) {
    for (const v of lista) {
      const prefijo = `media/videos/${v.id}/`;
      const nuevo = `media/videos/copia${k}-${v.id}/`;
      copias.push({ ...v, id: `copia${k}-${v.id}`, master: v.master.replace(prefijo, nuevo), poster: v.poster.replace(prefijo, nuevo) });
    }
  }
  return copias;
}

function reproducir(item, perfil) {
  group('reproducir video', () => {
    const inicio = Date.now();
    const urlMaster = absoluta(item.master);
    marcarEscalon();
    const resMaster = http.get(urlMaster, { tags: etiquetas('playlist', 'media/videos/*/master.m3u8') });
    if (!verificar(resMaster, 'playlist') || resMaster.status !== 200) return;
    const variantes = leerMaster(resMaster.body, urlMaster);
    if (variantes.length === 0) return;

    // hls.js arranca en la variante más baja y sube cuando mide el ancho de banda.
    const objetivo = variantes[Math.min(perfil.nivel, variantes.length - 1)];
    let actual = variantes[0];
    let segmentos = cargarVariante(actual);
    if (segmentos.length === 0) return;

    const duracionTotal = segmentos.reduce((s, x) => s + x.duracion, 0);
    const aVer = duracionTotal * (0.4 + Math.random() * 0.6);

    let bufferHasta = 0;       // segundos de video ya descargados
    let reproduccionDesde = 0; // ms en que empezó a reproducirse
    let pausado = 0;           // ms acumulados detenido por rebuffer
    let rebuffers = 0;

    const cabezal = () => (Date.now() - reproduccionDesde - pausado) / 1000;

    for (let i = 0; i < segmentos.length && bufferHasta < aVer; i++) {
      if (i === 1 && objetivo !== actual) {
        actual = objetivo;
        segmentos = cargarVariante(actual);
        if (segmentos.length <= i) break;
      }

      // Con el buffer lleno, hls.js espera a que la reproducción lo consuma.
      if (RITMO === 'tiempo-real' && i > 0) {
        const adelanto = bufferHasta - cabezal();
        if (adelanto > BUFFER_MAX_S) sleep(adelanto - BUFFER_MAX_S);
      }

      const seg = segmentos[i];
      marcarEscalon();
      const res = http.get(seg.url, {
        responseType: 'none',
        tags: etiquetas('segmento', 'media/videos/*/seg_*.ts', { resolucion: actual.resolucion }),
      });
      verificar(res, 'segmento');
      ratioSegmento.add(res.timings.duration / 1000 / seg.duracion, { resolucion: actual.resolucion });

      if (i === 0) {
        arranqueVideo.add(Date.now() - inicio, { perfil: perfil.nombre });
        reproduccionDesde = Date.now();
      } else if (RITMO === 'tiempo-real') {
        const atraso = cabezal() - bufferHasta;
        if (atraso > 0) {
          // El segmento llegó después de que el buffer se vaciara: el video se congeló.
          rebuffers++;
          eventosRebuffer.add(1, { perfil: perfil.nombre });
          pausado += atraso * 1000;
        }
      }
      bufferHasta += seg.duracion;
    }

    // Sin ritmo de reproducción no hay buffer que se vacíe: el rebuffer solo se mide en tiempo real.
    marcarEscalon();
    if (RITMO === 'tiempo-real') sesionesRebuffer.add(rebuffers > 0, { perfil: perfil.nombre });
    segundosVistos.add(bufferHasta);

    // Termina de ver lo que ya tenía en el buffer.
    if (RITMO === 'tiempo-real') {
      const restante = bufferHasta - cabezal();
      if (restante > 0) sleep(restante);
    }
  });
}

function cargarVariante(variante) {
  marcarEscalon();
  const res = http.get(variante.url, { tags: etiquetas('playlist', 'media/videos/*/index_*.m3u8') });
  if (!verificar(res, 'playlist') || res.status !== 200) return [];
  return leerVariante(res.body, variante.url);
}

// ---------- Escenario 3: juego Misión Neumonía Cero ----------
const KIT = ['guantes', 'cepillo-dental', 'enjuague-bucal', 'gasas-esteriles', 'alcohol-70', 'clorhexidina',
  'crema-dental', 'hisopo', 'vaso-agua', 'toalla', 'bajalenguas', 'algodon'];
const CAMAS = ['15', '25', '35', '50'];

function imagenJuego(nombre) {
  return [JUEGO + `img/${nombre}.webp`, 'imagen', 'juego/img/*.webp'];
}

function audioJuego(nombre, ext = 'mp3') {
  return [JUEGO + `audio/${nombre}.${ext}`, 'audio', `juego/audio/*.${ext}`];
}

export function juego() {
  nuevaVisita();
  abrirSpa();
  irAVista('simula');
  pausa(3, 6);

  group('juego: portada', () => {
    pedirEnParalelo([imagenJuego('bienvenida'), imagenJuego('boton-jugar'), imagenJuego('icono-sonido'),
      audioJuego('musica-portada'), audioJuego('clic-boton', 'wav')]);
  });
  pausa(5, 10);

  group('juego: instrucciones', () => {
    pedirEnParalelo([imagenJuego('instrucciones')]);
  });
  pausa(8, 15);

  group('juego: reto 1 (cama)', () => {
    pedirEnParalelo([imagenJuego('fondo-reto'), audioJuego('musica-retos'), audioJuego('responde-pregunta'),
      ...CAMAS.map((c) => imagenJuego('cama-' + c))]);
  });
  pausa(10, 25);
  pedirEnParalelo([audioJuego(Math.random() < 0.7 ? 'respuesta-correcta' : 'respuesta-incorrecta')]);

  group('juego: reto 2 (kit)', () => {
    pedirEnParalelo(KIT.map((k) => imagenJuego('kit-' + k)));
  });
  pausa(15, 40);

  group('juego: final', () => {
    const gano = Math.random() < 0.7;
    pedirEnParalelo([
      audioJuego(gano ? 'respuesta-correcta' : 'respuesta-incorrecta'),
      imagenJuego(gano ? 'mision-cumplida' : 'tiempo-agotado'),
    ]);
  });
  pausa(3, 8);
}
