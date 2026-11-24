#!/usr/bin/env python3
"""
SUSANA SEGURA: presentaciones interactivas a partir de los PowerPoint de los módulos.

Convierte cada .pptx en:
  app-plataforma/presentaciones/<id>/dNN.webp       una imagen por diapositiva (fondo fijo)
  app-plataforma/presentaciones/<id>/eNN-<spid>.webp los elementos que se mueven o se sacuden
  app-plataforma/presentaciones/<id>/presentacion.json  qué es interactivo y dónde está
  app-plataforma/presentaciones/catalogo.json        qué presentación va en qué curso

Lo interactivo se lee de las animaciones del propio PowerPoint (no se inventa):
  - desencadenador + "cambio de color" (énfasis 19)  -> opción de un reto: verde = correcta, rojo = incorrecta
  - desencadenador + "trayectoria" (path 63)         -> elemento que se mueve a su casilla (respuesta correcta)
  - desencadenador + "balanceo" (énfasis 32)         -> elemento que se sacude (respuesta incorrecta)
  - secuencia principal con números que aparecen y
    desaparecen (30, 29, … 1)                         -> cronómetro
  - "reproducir" de un audio en la secuencia principal -> audio al entrar en la diapositiva

Las diapositivas se dibujan con LibreOffice (imagen de Docker `segpaciente-documentos`, la misma de la
conversión a PDF, con las fuentes del hospital). Los elementos que se mueven y el cronómetro se quitan
del fondo y se recortan del dibujo completo para ponerlos encima como botones reales.

Uso (desde la raíz del proyecto, con Docker en marcha):
  docker build -t segpaciente-documentos herramientas/documentos      (una sola vez)
  python -I herramientas/presentaciones/generar.py
Requiere Python con lxml, PyMuPDF (fitz) y Pillow.
"""
import copy
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

import fitz  # PyMuPDF
from lxml import etree
from PIL import Image

RAIZ = Path(__file__).resolve().parents[2]
INSUMOS = RAIZ / 'insumos-modulos'
SALIDA = RAIZ / 'app-plataforma' / 'presentaciones'
IMAGEN_DOCKER = 'segpaciente-documentos'
ANCHO = 1600  # ancho de las imágenes de diapositiva (px)

# Audio del PowerPoint que ya existe en el aplicativo (mismos archivos, comprobado por MD5):
# así no se duplica. Clave = MD5 del mp3 dentro del pptx.
AUDIO_EXISTENTE = {
    '64474c0b788e827704302b473d8cbe7e': '../../juegos/neumonia-cero/assets/audio/musica-retos.mp3',
    '16e0c37f6ab98537f7fa878afaa6ab0c': '../../juegos/neumonia-cero/assets/audio/responde-pregunta.mp3',
}

MODULOS = [
    {
        'id': 'modulo-0', 'curso': 'curso-1', 'pptx': 'fa8a0928-modulo-1.pptx', 'portada': 1,
        'titulo': 'Fundamentos de Seguridad del Paciente y Cultura Justa',
        'descripcion': 'Recorre la política institucional, la cultura justa y los programas de vigilancia, y pon a prueba tus conocimientos.',
    },
    {
        'id': 'modulo-1', 'curso': 'curso-2', 'pptx': '54d84e3b-modulo-identificacion1.pptx', 'portada': 3,
        'titulo': 'Identificación correcta del paciente',
        'descripcion': 'Repasa los identificadores, la verificación activa y los casos especiales, y resuelve los retos.',
    },
    {
        'id': 'modulo-2', 'curso': 'curso-3', 'pptx': '7317d6ee-comunicacion.pptx', 'portada': 3,
        'titulo': 'Comunicación efectiva y segura',
        'descripcion': 'Practica las 4C, SBAR, la comunicación redundante y el Teach-Back con retos de selección.',
    },
]

NS = {
    'p': 'http://schemas.openxmlformats.org/presentationml/2006/main',
    'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
    'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    'p14': 'http://schemas.microsoft.com/office/powerpoint/2010/main',
}
R_EMBED = '{%s}embed' % NS['r']
FORMAS = ('sp', 'pic', 'grpSp', 'graphicFrame', 'cxnSp')
VERDES = {'92D050', '00B050', '00B0F0'}  # en los archivos, el verde marca la respuesta correcta


def local(el):
    return etree.QName(el).localname


def xfrm(el, clave):
    for q in ('./p:spPr/a:xfrm/', './p:grpSpPr/a:xfrm/', './p:xfrm/'):
        r = el.find(q + clave, NS)
        if r is not None:
            return r
    return None


def formas(arbol, W, H):
    """Todas las formas de una diapositiva con su caja en fracciones del lienzo (dentro de grupos también)."""
    salida = {}

    def recorrer(padre, ox, oy, sx, sy):
        for c in padre:
            if local(c) not in FORMAS:
                continue
            nv = c.find('.//p:cNvPr', NS)
            off, ext = xfrm(c, 'a:off'), xfrm(c, 'a:ext')
            caja = None
            if off is not None and ext is not None:
                x = ox + int(off.get('x')) * sx
                y = oy + int(off.get('y')) * sy
                caja = (x / W, y / H, int(ext.get('cx')) * sx / W, int(ext.get('cy')) * sy / H)
            texto = ' '.join(t.strip() for t in c.xpath('.//a:t/text()', namespaces=NS) if t.strip())
            salida[nv.get('id')] = {'el': c, 'caja': caja, 'texto': re.sub(r'\s+', ' ', texto), 'nombre': nv.get('name'),
                                    'descr': nv.get('descr') or ''}
            if local(c) == 'grpSp' and off is not None:
                g = c.find('./p:grpSpPr/a:xfrm', NS)
                co, ce = g.find('a:chOff', NS), g.find('a:chExt', NS)
                nsx = sx * int(ext.get('cx')) / max(1, int(ce.get('cx')))
                nsy = sy * int(ext.get('cy')) / max(1, int(ce.get('cy')))
                recorrer(c, ox + int(off.get('x')) * sx - int(co.get('x')) * nsx,
                         oy + int(off.get('y')) * sy - int(co.get('y')) * nsy, nsx, nsy)

    recorrer(arbol.find('.//p:spTree', NS), 0, 0, 1, 1)
    return salida


def interacciones(arbol, fs):
    """Lee las animaciones: opciones de reto, elementos que se mueven o se sacuden, cronómetro y audio."""
    elementos, cronometro, audios = [], None, []
    timing = arbol.find('.//p:timing', NS)
    if timing is None:
        return elementos, cronometro, audios
    for seq in timing.iter('{%s}seq' % NS['p']):
        ctn = seq.find('p:cTn', NS)
        tipo = ctn.get('nodeType')
        if tipo == 'interactiveSeq':
            disparador = seq.xpath('./p:cTn/p:stCondLst/p:cond/p:tgtEl/p:spTgt/@spid', namespaces=NS)
            for ef in seq.xpath('.//p:cTn[@presetClass]', namespaces=NS):
                spid = (ef.xpath('.//p:spTgt/@spid', namespaces=NS) or [None])[0]
                if spid not in fs or not fs[spid]['caja']:
                    continue
                clase, preset = ef.get('presetClass'), ef.get('presetID')
                base = {'spid': spid, 'disparador': disparador[0] if disparador else spid}
                if clase == 'emph' and preset == '19':
                    color = (ef.xpath('.//a:srgbClr/@val', namespaces=NS) or ['FF0000'])[0].upper()
                    elementos.append(dict(base, tipo='opcion', color='#' + color, correcta=color in VERDES))
                elif clase == 'path':
                    ruta = ef.xpath('.//p:animMotion/@path', namespaces=NS)[0]
                    nums = [float(n) for n in re.findall(r'-?\d+(?:\.\d+)?(?:E-?\d+)?', ruta, re.I)]
                    elementos.append(dict(base, tipo='mover', dx=nums[-2], dy=nums[-1]))
                elif clase == 'emph' and preset == '32':
                    elementos.append(dict(base, tipo='sacudir'))
        elif tipo == 'mainSeq':
            # Cronómetro: formas con un número que entran y salen una tras otra.
            numeros = []
            for ef in seq.xpath('.//p:cTn[@presetClass="entr"]', namespaces=NS):
                spid = (ef.xpath('.//p:spTgt/@spid', namespaces=NS) or [None])[0]
                if spid in fs and re.fullmatch(r'\d{1,3}', fs[spid]['texto'] or ''):
                    numeros.append(spid)
            if len(numeros) >= 5:
                valores = [int(fs[s]['texto']) for s in numeros]
                todos = [s for s, f in fs.items() if re.fullmatch(r'\d{1,3}', f['texto'] or '') and f['caja']
                         and f['caja'][0] > 0.85 and f['caja'][1] < 0.1]
                cajas = [fs[s]['caja'] for s in numeros]
                x0 = min(c[0] for c in cajas); y0 = min(c[1] for c in cajas)
                x1 = max(c[0] + c[2] for c in cajas); y1 = max(c[1] + c[3] for c in cajas)
                # El número inicial (30) ya está visible al entrar: no tiene animación de entrada.
                valores += [int(fs[s]['texto']) for s in todos]
                cronometro = {'segundos': max(valores), 'caja': (x0, y0, x1 - x0, y1 - y0), 'spids': sorted(set(numeros) | set(todos))}
    for cmd in timing.xpath('.//p:cmd[@type="call"]', namespaces=NS):
        spid = cmd.xpath('.//p:spTgt/@spid', namespaces=NS)[0]
        audios.append(spid)
    return elementos, cronometro, audios


def audio_de(z, ruta_slide, rels, fs, spid, volumenes):
    """Devuelve la ruta del audio (reutilizando el del aplicativo si es el mismo) y su volumen."""
    import hashlib
    pic = fs[spid]['el']
    candidatos = pic.xpath('.//p14:media/@r:embed', namespaces=NS)
    for rid in candidatos:
        destino = rels.get(rid)
        if not destino or destino == 'NULL':
            continue
        nombre = os.path.normpath(os.path.join(os.path.dirname(ruta_slide), destino)).replace('\\', '/')
        datos = z.read(nombre)
        md5 = hashlib.md5(datos).hexdigest()
        return {'src': AUDIO_EXISTENTE.get(md5), 'md5': md5, 'datos': datos, 'vol': volumenes.get(spid, 1)}
    return None


def destinos_de(fs, items, ocultos):
    """Recuadro de llegada de cada pieza que se mueve (la definición o la casilla del PowerPoint).

    Es la forma fija que más se superpone con la pieza en su posición final. Así quien juega primero
    elige el recuadro y luego el concepto, como pide el enunciado, en vez de ver la respuesta al pulsar."""
    destinos = []
    for it in items:
        if it['tipo'] != 'mover':
            continue
        px, py, pw, ph = (it['x'] + it['dx']) / 100, (it['y'] + it['dy']) / 100, it['w'] / 100, it['h'] / 100
        # En el PowerPoint algunas piezas quedan justo encima de su recuadro, sin tocarlo: margen de 8 %.
        px, py, pw, ph = px - 0.02, py - 0.02, pw + 0.04, ph + 0.10
        mejor, area_mejor = None, 0
        for spid, f in fs.items():
            if spid in ocultos or not f['caja'] or local(f['el']) not in ('sp', 'pic'):
                continue
            x, y, w, h = f['caja']
            if w * h > 0.2:  # fondos y franjas grandes
                continue
            inter = max(0, min(px + pw, x + w) - max(px, x)) * max(0, min(py + ph, y + h) - max(py, y))
            if inter > area_mejor:
                mejor, area_mejor = spid, inter
        if mejor is None:
            continue
        x, y, w, h = fs[mejor]['caja']
        etiqueta = fs[mejor]['texto']
        if not etiqueta or len(etiqueta) < 3:
            # Casilla vacía: su nombre es el texto que tiene justo encima
            encima = [f for s, f in fs.items() if f['caja'] and f['texto'] and len(f['texto']) > 2 and s not in ocultos
                      and f['caja'][0] < x + w and f['caja'][0] + f['caja'][2] > x
                      and y - 0.14 < f['caja'][1] + f['caja'][3] <= y + 0.03]
            solape = lambda f: min(x + w, f['caja'][0] + f['caja'][2]) - max(x, f['caja'][0])
            etiqueta = max(encima, key=solape)['texto'] if encima else ''
        caja = {'x': round(x * 100, 2), 'y': round(y * 100, 2), 'w': round(w * 100, 2), 'h': round(h * 100, 2), 'etiqueta': etiqueta}
        if caja not in destinos:
            destinos.append(caja)
        it['destino'] = destinos.index(caja)
    return destinos


def quitar(arbol, spids):
    """Quita formas por id (y las animaciones, para que LibreOffice dibuje el estado inicial sin ellas)."""
    for el in arbol.xpath('.//p:cNvPr', namespaces=NS):
        if el.get('id') in spids:
            forma = el
            while local(forma) not in FORMAS:
                forma = forma.getparent()
            forma.getparent().remove(forma)


def convertir(pptx, pdf):
    tmp = Path(tempfile.mkdtemp(prefix='pres-'))
    try:
        shutil.copy(pptx, tmp / 'entrada.pptx')
        subprocess.run(['docker', 'run', '--rm', '-v', f'{tmp}:/datos', IMAGEN_DOCKER, '/datos/entrada.pptx', '/datos/salida.pdf'],
                       check=True, stdout=subprocess.DEVNULL)
        shutil.copy(tmp / 'salida.pdf', pdf)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def pagina(doc, i):
    pg = doc[i]
    zoom = ANCHO / pg.rect.width
    pix = pg.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
    return Image.frombytes('RGB', (pix.width, pix.height), pix.samples)


def generar(mod, trabajo):
    origen = INSUMOS / mod['pptx']
    destino = SALIDA / mod['id']
    if destino.exists():
        shutil.rmtree(destino)
    destino.mkdir(parents=True)
    z = zipfile.ZipFile(origen)
    pres = etree.fromstring(z.read('ppt/presentation.xml'))
    tam = pres.find('p:sldSz', NS)
    W, H = int(tam.get('cx')), int(tam.get('cy'))
    prels = {r.get('Id'): r.get('Target') for r in etree.fromstring(z.read('ppt/_rels/presentation.xml.rels'))}
    rutas = ['ppt/' + prels[s.get('{%s}id' % NS['r'])] for s in pres.find('p:sldIdLst', NS)]

    diapositivas, quitar_por_slide = [], {}
    for n, ruta in enumerate(rutas, 1):
        arbol = etree.fromstring(z.read(ruta))
        rel_ruta = ruta.replace('slides/', 'slides/_rels/') + '.rels'
        rels = {r.get('Id'): r.get('Target') for r in etree.fromstring(z.read(rel_ruta))} if rel_ruta in z.namelist() else {}
        fs = formas(arbol, W, H)
        elementos, crono, audios = interacciones(arbol, fs)
        volumenes = {a.xpath('.//p:spTgt/@spid', namespaces=NS)[0]: int(a.get('vol', 100000)) / 100000
                     for a in arbol.xpath('.//p:cMediaNode', namespaces=NS)}
        # Íconos sin ningún desencadenador en el pptx (nadie les asignó animación): son del mismo juego, del mismo
        # tamaño que los demás, y no corresponden a ninguna casilla, así que cuentan como respuesta incorrecta.
        animados = [fs[e['spid']]['caja'] for e in elementos if e['tipo'] in ('mover', 'sacudir')]
        if any(e['tipo'] == 'mover' for e in elementos) and animados:
            alto = sorted(c[3] for c in animados)[len(animados) // 2]
            tocados = {e['spid'] for e in elementos} | set(audios) | (set(crono['spids']) if crono else set())
            for spid, f in fs.items():
                if spid in tocados or not f['caja'] or local(f['el']) != 'pic' or abs(f['caja'][3] - alto) > 0.01:
                    continue
                if f['caja'][1] < 0.15:  # cabecera (iconos de audio)
                    continue
                elementos.append({'spid': spid, 'disparador': spid, 'tipo': 'sacudir'})
        # Repetidos: dos elementos iguales casi en el mismo sitio (en el pptx quedaron copias superpuestas).
        unicos = []
        for e in elementos:
            c = fs[e['spid']]['caja']
            if any(u['tipo'] == e['tipo'] and abs(fs[u['spid']]['caja'][0] - c[0]) < .01 and abs(fs[u['spid']]['caja'][1] - c[1]) < .01
                   for u in unicos):
                continue
            unicos.append(e)
        moviles = {e['spid'] for e in elementos if e['tipo'] in ('mover', 'sacudir')}
        ocultos = set(moviles) | {e['spid'] for e in elementos if e['tipo'] in ('mover', 'sacudir')}
        if crono:
            ocultos |= set(crono['spids'])
        # Las copias superpuestas también se quitan del fondo
        for e in elementos:
            if e['tipo'] in ('mover', 'sacudir'):
                ocultos.add(e['spid'])
        quitar_por_slide[ruta] = ocultos
        diapositivas.append({'n': n, 'ruta': ruta, 'fs': fs, 'elementos': unicos, 'crono': crono, 'audios': audios,
                             'rels': rels, 'volumenes': volumenes, 'arbol': arbol})

    # pptx sin los elementos interactivos móviles (fondo) y pptx completo (para recortarlos)
    sin = trabajo / f"{mod['id']}-fondo.pptx"
    with zipfile.ZipFile(origen) as zin, zipfile.ZipFile(sin, 'w', zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            datos = zin.read(item.filename)
            if quitar_por_slide.get(item.filename):
                a = etree.fromstring(datos)
                quitar(a, quitar_por_slide[item.filename])
                datos = etree.tostring(a, xml_declaration=True, encoding='UTF-8', standalone=True)
            zout.writestr(item, datos)
    pdf_completo, pdf_fondo = trabajo / f"{mod['id']}-completo.pdf", trabajo / f"{mod['id']}-fondo.pdf"
    print(f"  LibreOffice: {mod['pptx']} …")
    convertir(origen, pdf_completo)
    if any(quitar_por_slide.values()):
        convertir(sin, pdf_fondo)
    else:
        shutil.copy(pdf_completo, pdf_fondo)
    doc_c, doc_f = fitz.open(pdf_completo), fitz.open(pdf_fondo)
    assert len(doc_c) == len(rutas) == len(doc_f), f'páginas {len(doc_c)}/{len(doc_f)} y diapositivas {len(rutas)} no coinciden'

    salida, retos = [], 0
    for d in diapositivas:
        i = d['n'] - 1
        fondo = pagina(doc_f, i)
        nombre = f"d{d['n']:02d}.webp"
        fondo.save(destino / nombre, 'WEBP', quality=82, method=6)
        completo = None
        items = []
        for e in d['elementos']:
            f = d['fs'][e['spid']]
            x, y, w, h = f['caja']
            item = {'tipo': e['tipo'], 'x': round(x * 100, 2), 'y': round(y * 100, 2), 'w': round(w * 100, 2), 'h': round(h * 100, 2),
                    'etiqueta': f['texto'] or f['descr'] or ''}
            if e['tipo'] == 'opcion':
                item.update(color=e['color'], correcta=e['correcta'])
            else:
                if completo is None:
                    completo = pagina(doc_c, i)
                W2, H2 = completo.size
                recorte = completo.crop((round(x * W2), round(y * H2), round((x + w) * W2), round((y + h) * H2)))
                img = f"e{d['n']:02d}-{e['spid']}.webp"
                recorte.save(destino / img, 'WEBP', quality=85, method=6)
                item['img'] = img
                if e['tipo'] == 'mover':
                    item.update(dx=round(e['dx'] * 100, 2), dy=round(e['dy'] * 100, 2))
            items.append(item)
        # Sin texto y con imagen: rótulo genérico para lectores de pantalla
        n_icono = 0
        for it in items:
            if not it['etiqueta']:
                n_icono += 1
                it['etiqueta'] = f'Imagen {n_icono}'
        if any(it['tipo'] == 'opcion' for it in items) or any(it['tipo'] == 'mover' for it in items):
            retos += 1
        texto = ' '.join(f['texto'] for s, f in d['fs'].items() if f['texto'] and s not in quitar_por_slide[d['ruta']])
        dia = {'img': nombre, 'texto': texto, 'elementos': items}
        destinos = destinos_de(d['fs'], items, quitar_por_slide[d['ruta']])
        if destinos:
            dia['destinos'] = destinos
        if d['crono']:
            x, y, w, h = d['crono']['caja']
            dia['cronometro'] = {'segundos': d['crono']['segundos'], 'x': round(x * 100, 2), 'y': round(y * 100, 2),
                                 'w': round(w * 100, 2), 'h': round(h * 100, 2)}
        audios = []
        for spid in d['audios']:
            au = audio_de(z, d['ruta'], d['rels'], d['fs'], spid, d['volumenes'])
            if not au:
                continue
            if not au['src']:
                nom = f"audio-{au['md5'][:8]}.mp3"
                (destino / nom).write_bytes(au['datos'])
                au['src'] = nom
            audios.append({'src': au['src'], 'volumen': round(au['vol'], 2)})
        if audios:
            dia['audio'] = audios
        salida.append(dia)

    datos = {'id': mod['id'], 'titulo': mod['titulo'], 'proporcion': round(W / H, 4), 'diapositivas': salida}
    (destino / 'presentacion.json').write_text(json.dumps(datos, ensure_ascii=False, indent=1), encoding='utf-8')
    total = sum(f.stat().st_size for f in destino.iterdir())
    print(f"  {mod['id']}: {len(salida)} diapositivas, {retos} con actividad, {total / 1e6:.1f} MB")
    return {'id': mod['id'], 'curso': mod['curso'], 'titulo': mod['titulo'], 'descripcion': mod['descripcion'],
            'portada': f"{mod['id']}/d{mod['portada']:02d}.webp", 'diapositivas': len(salida), 'actividades': retos}


def main():
    if not shutil.which('docker'):
        sys.exit('Falta Docker (se usa LibreOffice de la imagen segpaciente-documentos).')
    trabajo = Path(tempfile.mkdtemp(prefix='presentaciones-'))
    try:
        SALIDA.mkdir(parents=True, exist_ok=True)
        catalogo = [generar(m, trabajo) for m in MODULOS]
        (SALIDA / 'catalogo.json').write_text(json.dumps(catalogo, ensure_ascii=False, indent=1), encoding='utf-8')
        print('Listo:', SALIDA)
    finally:
        shutil.rmtree(trabajo, ignore_errors=True)


if __name__ == '__main__':
    main()
