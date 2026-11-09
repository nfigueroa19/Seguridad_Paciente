// Lectura mínima de listas HLS (RFC 8216) para el escenario de carga.
// Solo cubre lo que genera herramientas/video/procesar-videos.sh: VOD, sin cifrado,
// sin pistas de audio separadas ni subtítulos.

export function carpetaDe(url) {
  return url.slice(0, url.lastIndexOf('/') + 1);
}

function resolver(base, ruta) {
  if (/^https?:\/\//.test(ruta)) return ruta;
  return carpetaDe(base) + ruta;
}

// master.m3u8 -> [{ ancho_banda, resolucion, url }] ordenado de menor a mayor ancho de banda.
export function leerMaster(texto, urlMaster) {
  const lineas = texto.split(/\r?\n/).map((l) => l.trim());
  const variantes = [];
  for (let i = 0; i < lineas.length; i++) {
    if (!lineas[i].startsWith('#EXT-X-STREAM-INF:')) continue;
    const atributos = lineas[i].slice('#EXT-X-STREAM-INF:'.length);
    const ancho = /BANDWIDTH=(\d+)/.exec(atributos);
    const resolucion = /RESOLUTION=(\d+x\d+)/.exec(atributos);
    let j = i + 1;
    while (j < lineas.length && (lineas[j] === '' || lineas[j].startsWith('#'))) j++;
    if (j < lineas.length) {
      variantes.push({
        ancho_banda: ancho ? Number(ancho[1]) : 0,
        resolucion: resolucion ? resolucion[1] : '',
        url: resolver(urlMaster, lineas[j]),
      });
    }
  }
  return variantes.sort((a, b) => a.ancho_banda - b.ancho_banda);
}

// index_XXX.m3u8 -> [{ duracion, url }]
export function leerVariante(texto, urlVariante) {
  const lineas = texto.split(/\r?\n/).map((l) => l.trim());
  const segmentos = [];
  let duracion = null;
  for (const linea of lineas) {
    if (linea.startsWith('#EXTINF:')) {
      duracion = parseFloat(linea.slice('#EXTINF:'.length));
    } else if (linea !== '' && !linea.startsWith('#') && duracion !== null) {
      segmentos.push({ duracion, url: resolver(urlVariante, linea) });
      duracion = null;
    }
  }
  return segmentos;
}
