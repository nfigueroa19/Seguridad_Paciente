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

Los módulos con macros (.pptm, p. ej. el 7 y el 9) no usan animaciones: sus juegos y retos los hacen macros VBA que
actúan sobre formas con nombre (Zona_R1_Codo, Une_I_1, Sopa_0_0, Op_B_ok…). Esas macros NO se ejecutan nunca: solo se
lee el XML de las diapositivas. Cada forma interactiva se exporta con su caja, forma, colores y texto (en
"formas") y se quita del dibujo de fondo; el reproductor las reconstruye en HTML y repite la lógica de las macros
(que está transcrita en presentaciones.js). El estado inicial de cada forma se fija aquí (INICIAL), porque los
archivos se guardaron con el juego a medias.

Uso (desde la raíz del proyecto, con Docker en marcha):
  docker build -t segpaciente-documentos herramientas/documentos      (una sola vez)
  python -I herramientas/presentaciones/generar.py                    (todos los módulos)
  python -I herramientas/presentaciones/generar.py modulo-7 modulo-9  (solo esos; el catálogo se fusiona)
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
    {
        'id': 'modulo-4', 'curso': 'curso-5', 'pptx': 'modulo-4-cirugia-segura.pptm',
        'portada': 1, 'macros': True,
        'titulo': 'Garantizar una cirugía segura',
        'descripcion': 'Los tres correctos, el triaje quirúrgico, la lista de chequeo y el consentimiento, con un juego de clasificar, verdadero o falso y cinco retos con puntaje.',
        'puntaje': [{'id': 'clasifica', 'nombre': 'Juego 1', 'max': 6}, {'id': 'vf', 'nombre': 'V o F', 'max': 4},
                    {'id': 'retos', 'nombre': 'Retos', 'max': 5}],
    },
    {
        'id': 'modulo-6', 'curso': 'modulo-7-prevencion-de-caidas-en-pacientes', 'pptx': 'modulo-6-caidas.pptm',
        'portada': 1, 'macros': True,
        'titulo': 'Prevención de caídas en pacientes',
        'descripcion': 'Factores de riesgo, escala de Downton, señalización y barreras, con la caza de riesgos, el ahorcado, un caso interactivo y cinco retos con puntaje.',
        'puntaje': [{'id': 'caza', 'nombre': 'Caza', 'max': 5}, {'id': 'ahorcado', 'nombre': 'Ahorcado', 'max': 3},
                    {'id': 'caso', 'nombre': 'Caso', 'max': 5}, {'id': 'retos', 'nombre': 'Retos', 'max': 5}],
        # Transcrito de las macros (Palabra, Pista, CasoTexto, CasoOpcion, CasoCorrecta y CasoExplicacion).
        'datos': {
            'ahorcado': {'maxErrores': 6, 'palabras': [
                {'p': 'DOWNTON', 'pista': 'Pista: escala para valorar el riesgo de caídas'},
                {'p': 'AZUL', 'pista': 'Pista: color que identifica el riesgo de caída en el hospital'},
                {'p': 'TIMBRE', 'pista': 'Pista: debe estar siempre al alcance del paciente'}]},
            'caso': {'pasos': [
                {'q': 'Ingresa Don Jorge, de 78 años, con antecedente de caídas y episodios de mareo. ¿Qué haces primero?',
                 'A': 'A.  Valoro el riesgo con la escala de Downton o la herramienta institucional',
                 'B': 'B.  Espero a ver si presenta una caída durante el turno para valorarlo', 'ok': 'A',
                 'exp': 'Valorar el riesgo al ingreso permite aplicar medidas a tiempo.'},
                {'q': 'La valoración indica alto riesgo de caída. ¿Qué haces?',
                 'A': 'A.  Coloco solo la señalización azul; con eso es suficiente',
                 'B': 'B.  Coloco la señalización azul y aplico medidas preventivas individualizadas', 'ok': 'B',
                 'exp': 'La señalización no reemplaza las medidas preventivas individualizadas.'},
                {'q': 'En la noche, Don Jorge quiere ir al baño y refiere mareo. ¿Qué haces?',
                 'A': 'A.  Lo acompaño y lo asisto durante la movilización y el uso del baño',
                 'B': 'B.  Le digo que vaya despacio, solo, si se siente capaz', 'ok': 'A',
                 'exp': 'Con mareo y riesgo de caída necesita acompañamiento y asistencia.'},
                {'q': 'Lo dejas de nuevo en su cama. Antes de salir de la habitación, ¿cómo dejas el entorno?',
                 'A': 'A.  Dejo la cama elevada para que le sea más fácil bajarse',
                 'B': 'B.  Cama baja con ruedas bloqueadas, timbre al alcance y piso seco', 'ok': 'B',
                 'exp': 'Cama baja, ruedas bloqueadas, timbre al alcance y piso seco son barreras clave.'},
                {'q': 'A pesar de las medidas, Don Jorge se cae y se queja de dolor en la cadera. ¿Qué haces?',
                 'A': 'A.  Lo levanto rápido para acostarlo de nuevo',
                 'B': 'B.  Acudo, valoro lesiones sin movilizarlo apresuradamente, pido valoración médica y reporto', 'ok': 'B',
                 'exp': 'Con sospecha de lesión no se moviliza apresuradamente; se valora y se reporta.'}]},
        },
    },
    {
        'id': 'modulo-11', 'curso': 'reporte-de-incidentes-y-eventos-adversos', 'pptx': 'modulo-11-reporte.pptm',
        'portada': 1, 'macros': True,
        'titulo': 'Reporte de incidentes y eventos adversos',
        'descripcion': 'Clasificación y severidad de los eventos, cómo redactar un reporte y los canales del hospital, con los buzones, el armado del reporte, el chat con Susanita y cinco retos con puntaje.',
        'puntaje': [{'id': 'buzones', 'nombre': 'Buzones', 'max': 6}, {'id': 'reporte', 'nombre': 'Reporte', 'max': 5},
                    {'id': 'chat', 'nombre': 'Chat', 'max': 4}, {'id': 'retos', 'nombre': 'Retos', 'max': 5}],
        # Transcrito de las macros (BuzNombre, BuzSituacion, BuzCorrecto, BuzExplica, RepCorrecta y ChatDato).
        'datos': {
            'buzones': {'nombres': ['Falla o riesgo', 'Incidente', 'Evento adverso', 'Complicación'], 'situaciones': [
                {'t': 'Piso mojado en el pasillo, sin señalización. Nadie se ha caído todavía.', 'ok': 1,
                 'exp': 'Es un riesgo: aumenta la probabilidad de daño, aunque aún no ocurre nada.'},
                {'t': 'Se administró una dosis de más de un medicamento, pero el paciente no presentó ningún daño.', 'ok': 2,
                 'exp': 'Llegó al paciente, pero no le generó daño.'},
                {'t': 'El paciente se levantó solo, se cayó y sufrió una fractura de cadera.', 'ok': 3,
                 'exp': 'Llegó al paciente y le generó daño: es un evento adverso.'},
                {'t': 'La bomba de infusión de la cama 5 tiene la alarma dañada y sigue en uso.', 'ok': 1,
                 'exp': 'Es una falla: el equipo con la alarma dañada pone en riesgo a los pacientes.'},
                {'t': 'Un paciente con cirrosis avanzada presenta un sangrado propio de la evolución de su enfermedad, sin fallas en la atención.', 'ok': 4,
                 'exp': 'El daño se debe a la enfermedad del paciente, no a la atención.'},
                {'t': 'Se administró un medicamento al que el paciente era alérgico y la reacción requirió traslado a UCI.', 'ok': 3,
                 'exp': 'La atención causó daño al paciente: es un evento adverso.'}]},
            'reporte': {'correctas': 'ABBAB'},
            'chat': {'pasos': [
                {'q': 'Hola, soy Susanita Súper Segura. ¿Qué situación quieres reportar hoy?',
                 'A': 'Un paciente se cayó en el baño; ya fue valorado y está estable.',
                 'B': 'Quiero denunciar a la auxiliar que no hace bien su trabajo.', 'ok': 'A',
                 'S': '¡Gracias! Describir los hechos, sin señalar personas, ayuda a aprender.',
                 'N': 'El reporte no busca culpables: describe los hechos de forma objetiva.'},
                {'q': '¿Qué hiciste primero cuando ocurrió?',
                 'A': 'Primero llené el reporte y luego avisé.',
                 'B': 'Protegí al paciente, lo valoré y avisé al profesional responsable.', 'ok': 'B',
                 'S': '¡Muy bien! La primera prioridad siempre es el paciente.',
                 'N': 'Primero se protege y atiende al paciente; después se reporta.'},
                {'q': '¿Ya quedó registrado en la historia clínica?',
                 'A': 'No, con este reporte es suficiente.',
                 'B': 'Sí, documenté los hechos en la historia clínica.', 'ok': 'B',
                 'S': '¡Perfecto! El reporte no reemplaza el registro clínico.',
                 'N': 'El reporte NO reemplaza el registro en la historia clínica.'},
                {'q': 'Cuéntame cuándo y dónde ocurrió.',
                 'A': '20/11/2026, 6:40 a. m., baño de la habitación 304, piso 3.',
                 'B': 'Hace un rato, en algún baño del piso.', 'ok': 'A',
                 'S': '¡Reporte recibido! Fecha, hora y lugar exactos facilitan el análisis.',
                 'N': 'Incluye la fecha, la hora y el servicio exactos.'}]},
        },
    },
    {
        'id': 'modulo-7', 'curso': '8-programa-de-piel-sana-prevencion-de-lesiones-por-presion', 'pptx': 'modulo-7-piel-sana.pptm',
        'portada': 1, 'macros': True,
        'titulo': 'Programa de Piel Sana: prevención de lesiones por presión',
        'descripcion': 'Escala de Braden, clasificación de las lesiones, cambios de posición y barreras de seguridad, con tres juegos y cinco retos con puntaje.',
        'puntaje': [{'id': 'mapa', 'nombre': 'Mapa', 'max': 7}, {'id': 'une', 'nombre': 'Une', 'max': 6},
                    {'id': 'sopa', 'nombre': 'Sopa', 'max': 6}, {'id': 'retos', 'nombre': 'Retos', 'max': 5}],
        'datos': {'sopa': {'palabras': ['BRADEN', 'SACRO', 'TALONES', 'HUMEDAD', 'ESCARA', 'MARSI']}},
    },
    {
        'id': 'modulo-9', 'curso': 'modulo-10-10-hemovigilancia-y-seguridad-transfusional', 'pptx': 'modulo-9-hemovigilancia.pptm',
        'portada': 1, 'macros': True,
        'titulo': 'Hemovigilancia y seguridad transfusional',
        'descripcion': 'Verificación pretransfusional, administración segura y actuación ante una reacción, con tres juegos y cinco retos con puntaje.',
        'puntaje': [{'id': 'detective', 'nombre': 'Detective', 'max': 4}, {'id': 'monitor', 'nombre': 'Monitor', 'max': 3},
                    {'id': 'candado', 'nombre': 'Candado', 'max': 4}, {'id': 'retos', 'nombre': 'Retos', 'max': 5}],
        # Transcrito de las macros (MonDato, CanDato y CODIGO del módulo Interactividad del .pptm).
        'datos': {
            'monitor': {'pacientes': [
                {'normal': ['36,8 °C', '82 lpm', '118/76', '18 rpm', 'Paciente tranquilo, sin molestias'],
                 'alarma': ['38,7 °C', '112 lpm', '116/74', '20 rpm', 'Escalofríos y sensación de frío'], 'reaccion': 'una reacción febril'},
                {'normal': ['36,7 °C', '80 lpm', '120/80', '18 rpm', 'Paciente tranquila, sin molestias'],
                 'alarma': ['36,9 °C', '104 lpm', '112/70', '24 rpm', 'Urticaria y prurito en el tórax'], 'reaccion': 'una reacción alérgica'},
                {'normal': ['37,0 °C', '85 lpm', '124/78', '18 rpm', 'Paciente tranquilo, sin molestias'],
                 'alarma': ['38,4 °C', '124 lpm', '86/50', '26 rpm', 'Dolor lumbar e hipotensión'], 'reaccion': 'una posible reacción hemolítica'},
            ]},
            'candado': {'codigo': '3715', 'pistas': [
                {'q': 'Pista 1: para confirmar la identidad del paciente se usan:', 'A': 'A.  Nombre completo, documento y fecha de nacimiento',
                 'B': 'B.  Nombre y número de cama', 'ok': 'A', 'digito': '3'},
                {'q': 'Pista 2: si encuentra una discrepancia en la verificación pretransfusional:', 'A': 'A.  Inicia la transfusión y aclara después',
                 'B': 'B.  No inicia la transfusión hasta aclararla', 'ok': 'B', 'digito': '7'},
                {'q': 'Pista 3: la vigilancia del paciente debe ser más estrecha:', 'A': 'A.  Al inicio de la transfusión, a los 15 minutos y al finalizar transfusión',  # texto del archivo (la macro trae uno más corto)
                 'B': 'B.  Solo al finalizar la transfusión', 'ok': 'A', 'digito': '1'},
                {'q': 'Pista 4: ¿quién puede administrar hemocomponentes?', 'A': 'A.  Cualquier persona disponible en el servicio',
                 'B': 'B.  Personal autorizado', 'ok': 'B', 'digito': '5'},
            ]},
        },
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


# ---------------------------------------------------------------------------------------------------------------
# Módulos con macros (.pptm): juegos y retos hechos con macros VBA sobre formas con nombre
# ---------------------------------------------------------------------------------------------------------------
JUEGOS = [  # (juego, patrón del nombre que lo identifica, patrón de las formas que se reconstruyen en HTML)
    ('mapa', r'Zona_', r'(Zona_|Mapa_Marcador$|Mapa_Retro$|Puntaje_Mapa$|Boton_Reiniciar$)'),
    ('une', r'Une_I_', r'(Une_[ID]_|Puntaje_Une$|Boton_Reiniciar$)'),
    ('sopa', r'Sopa_\d_\d', r'(Sopa_|Puntaje_Sopa$|Boton_Reiniciar$)'),
    ('detective', r'Det_[BE]', r'(Det_|Boton_Reiniciar$)'),
    ('monitor', r'Mon_Iniciar', r'Mon_'),
    ('candado', r'Can_P_', r'Can_'),
    ('clasifica', r'Con_\d', r'(Col_|Con_|Puntaje_Juego$|Boton_Reiniciar$)'),
    ('vf', r'VF_', r'(VF_|Puntaje_VF$|Boton_Reiniciar$)'),
    ('caza', r'Caz_[RS]_', r'(Caz_|Puntaje_Caza$|Boton_Reiniciar$)'),
    ('ahorcado', r'Ahc_', r'(Ahc_|Tecla_|Boton_Reiniciar$)'),
    ('caso', r'Caso_', r'(Caso_|Boton_Reiniciar$)'),
    ('buzones', r'Buz_', r'(Buz_|Boton_Reiniciar$)'),
    ('reporte', r'Rep_', r'(Rep_|Boton_Reiniciar$)'),
    ('chat', r'Chat_', r'Chat_'),
    ('reto', r'Op_[A-Z]_', r'(Op_|Ic_|RetroSi$|RetroNo$|Fin del tiempo$)'),
    ('cierre', r'Boton_Puntaje', r'(Boton_Puntaje$|Puntaje_Final$)'),
]
VERDE, VERDE_CLARO, NARANJA, ROJO_VINO = '#196C33', '#EAF5EC', '#AF5A19', '#A31D2B'
PT_CQW = 12700 / 12192000 * 100  # un punto tipográfico en % del ancho de la diapositiva (unidad cqw del escenario)


def _color(el, por_defecto):
    c = el.find('.//a:solidFill/a:srgbClr', NS) if el is not None else None
    return '#' + c.get('val').upper() if c is not None else por_defecto


def estilo_forma(f, W, H):
    """Caja, geometría, relleno, borde y texto de una forma (para reconstruirla en HTML)."""
    el, caja = f['el'], f['caja']
    sp_pr = el.find('./p:spPr', NS)
    geom = sp_pr.find('./a:prstGeom', NS) if sp_pr is not None else None
    gd = geom.find('./a:avLst/a:gd', NS) if geom is not None else None
    adj = int(re.search(r'val (\d+)', gd.get('fmla')).group(1)) / 100000 if gd is not None else None
    relleno = sp_pr.find('./a:solidFill/a:srgbClr', NS) if sp_pr is not None else None
    alfa = relleno.find('a:alpha', NS) if relleno is not None else None
    ln = sp_pr.find('./a:ln', NS) if sp_pr is not None else None
    borde = ln is not None and ln.find('a:noFill', NS) is None and ln.find('a:solidFill', NS) is not None
    cuerpo = el.find('./p:txBody', NS)
    pr = cuerpo.find('a:bodyPr', NS) if cuerpo is not None else None
    ins = [int((pr.get(k) if pr is not None and pr.get(k) else d)) / W * 100
           for k, d in (('lIns', 91440), ('tIns', 45720), ('rIns', 91440), ('bIns', 45720))]
    blanco = el.find('./p:style', NS) is not None  # las autoformas llevan texto blanco por defecto
    parrafos = []
    for p in (cuerpo.findall('a:p', NS) if cuerpo is not None else []):
        ppr = p.find('a:pPr', NS)
        al = {'ctr': 'center', 'r': 'right', 'just': 'justify'}.get(ppr.get('algn') if ppr is not None else None, 'left')
        sa = ppr.find('a:spcAft/a:spcPts', NS) if ppr is not None else None
        runs = []
        for r in p.findall('a:r', NS):
            rp = r.find('a:rPr', NS)
            sz = int(rp.get('sz')) / 100 if rp is not None and rp.get('sz') else 18
            runs.append({'t': r.find('a:t', NS).text or '', 'sz': round(sz * PT_CQW, 3), 'b': bool(rp is not None and rp.get('b') == '1'),
                         'c': _color(rp, '#FFFFFF' if blanco else '#000000')})
        parrafos.append({'al': al, 'sa': round(int(sa.get('val')) / 100 * PT_CQW, 3) if sa is not None else 0, 'r': runs})
    x, y, w, h = caja
    d = {'n': f['nombre'], 'x': round(x * 100, 2), 'y': round(y * 100, 2), 'w': round(w * 100, 2), 'h': round(h * 100, 2),
         'g': geom.get('prst') if geom is not None else 'rect', 'f': '#' + relleno.get('val').upper() if relleno is not None else None,
         'p': parrafos, 'i': [round(v, 3) for v in ins],
         'an': {'ctr': 'center', 'b': 'flex-end'}.get(pr.get('anchor') if pr is not None else None, 'flex-start')}
    if adj is not None:
        d['adj'] = adj
    if alfa is not None:
        d['a'] = int(alfa.get('val')) / 100000
    if borde:
        d['l'] = _color(ln, '#000000')
        d['lw'] = round(int(ln.get('w', 12700)) / 12700 * PT_CQW, 3)
    if el.xpath('./p:nvSpPr/p:cNvPr/@hidden', namespaces=NS):
        d['oculto'] = True
    return d


def _texto(d, lineas, color=None, sz=None, negrita=None):
    """Reemplaza el texto conservando el estilo del primer fragmento (una línea por párrafo)."""
    base = d['p'][0]['r'][0] if d['p'] and d['p'][0]['r'] else {'sz': round(16 * PT_CQW, 3), 'b': False, 'c': '#000000'}
    al = d['p'][0]['al'] if d['p'] else 'left'
    cambios = {}
    if color:
        cambios['c'] = color
    if sz:
        cambios['sz'] = round(sz * PT_CQW, 3)
    if negrita is not None:
        cambios['b'] = negrita
    d['p'] = [{'al': al, 'sa': 0, 'r': [dict(base, t=t, **cambios)]} for t in lineas]


def _recolorear(d, color):
    for p in d['p']:
        for r in p['r']:
            r['c'] = color


def inicial(d, datos):
    """Estado inicial de cada forma: los archivos se guardaron con el juego a medias, así que se lleva al estado de
    'Reiniciar' (macro del módulo Interactividad)."""
    n = d['n']
    if n.startswith('Zona_'):
        d['f'], d['a'] = '#FFFFFF', 0.6
    elif n == 'Mapa_Marcador':
        d['p'] = [{'al': 'center', 'sa': 0, 'r': [{'t': 'Zonas de riesgo: 0 de 7', 'sz': round(16 * PT_CQW, 3), 'b': True, 'c': VERDE}]},
                  {'al': 'center', 'sa': 0, 'r': [{'t': 'Errores: 0', 'sz': round(16 * PT_CQW, 3), 'b': True, 'c': NARANJA}]}]
    elif n == 'Mapa_Retro':
        d['f'] = VERDE_CLARO
        _texto(d, ['Haz clic en un punto blanco del esquema'])
    elif n.startswith('Puntaje_') and n != 'Puntaje_Final':
        d['oculto'] = True
        if n == 'Puntaje_Sopa':
            d['x'], d['y'] = 19.78, 77.5  # en el archivo tapa las últimas filas de la cuadrícula
    elif n.startswith('Une_I_'):
        d['f'] = VERDE
        d.pop('l', None)
        d.pop('lw', None)
    elif n.startswith('Une_D_'):
        d['f'] = VERDE_CLARO
    elif re.fullmatch(r'Sopa_\d_\d', n):
        d['f'] = VERDE_CLARO
    elif n.startswith('Sopa_W_'):
        d['f'] = '#FFFFFF'
        for p in d['p']:
            for r in p['r']:
                r['c'] = VERDE
    elif n == 'Det_Marcador':
        d['f'] = NARANJA
        _texto(d, ['Discrepancias: 0 de 4  ·  Errores: 0'], sz=15)
    elif n.startswith('Det_'):
        d['f'] = '#F6DDDF'
        texto = ''.join(r['t'] for p in d['p'] for r in p['r'])
        base = d['p'][0]['r'][0]
        k = texto.find(':') + 1
        d['p'] = [{'al': d['p'][0]['al'], 'sa': 0, 'r': [dict(base, t=texto[:k], c=ROJO_VINO), dict(base, t=texto[k:], c='#203728')]}]
    elif n.startswith('Mon_'):
        p1 = datos['monitor']['pacientes'][0]['normal']
        valores = {'Mon_Temp': p1[0], 'Mon_FC': p1[1], 'Mon_PA': p1[2], 'Mon_FR': p1[3], 'Mon_Obs': p1[4]}
        if n in valores:
            _texto(d, [valores[n]], color='#FFFFFF' if n == 'Mon_Obs' else '#7EF09E')
        elif n == 'Mon_Tiempo':
            _texto(d, ['00:00'])
        elif n == 'Mon_Ronda':
            _texto(d, ['Paciente 1 de 3'])
        elif n == 'Mon_Retro':
            d['oculto'] = True
    elif re.fullmatch(r'Can_P_\d', n):
        k = n[-1]
        d['f'] = ROJO_VINO
        base = {'c': '#FFFFFF', 'b': True}
        d['p'] = [{'al': 'center', 'sa': 0, 'r': [dict(base, t='🔒  Pista ' + k, sz=round(16 * PT_CQW, 3))]},
                  {'al': 'center', 'sa': 0, 'r': [dict(base, t='Haz clic para abrir', sz=round(11 * PT_CQW, 3), b=False)]}]
    elif n == 'Can_Pregunta':
        _texto(d, ['Elige una pista para ver su pregunta'])
    elif n in ('Can_O_A', 'Can_O_B'):
        d['f'] = '#FFFFFF'
        _texto(d, [n[-1] + '.'])
    elif n == 'Can_Retro':
        d['oculto'] = True
    elif n == 'Can_Codigo':
        d['f'] = '#142B20'
        _texto(d, ['_  _  _  _'], color='#7EF09E')
    elif n == 'Can_Estado':
        _texto(d, ['🔒 Cerrado'])
    # --- Módulo 4: clasificar y verdadero o falso ---
    elif n.startswith('Con_'):
        d['f'] = VERDE
        d.pop('l', None)
        d.pop('lw', None)
    elif n.startswith('VF_'):
        d['f'] = '#FFFFFF'
        _recolorear(d, VERDE)
    # --- Módulo 6: caza de riesgos, ahorcado y caso ---
    elif re.fullmatch(r'Caz_[RS]_\d', n):
        d['f'] = VERDE_CLARO
        _recolorear(d, '#203728')
    elif n == 'Caz_Marcador':
        al = d['p'][0]['al'] if d['p'] else 'center'
        fila = lambda t, sz, c: {'al': al, 'sa': 0, 'r': [{'t': t, 'sz': round(sz * PT_CQW, 3), 'b': True, 'c': c}]}
        d['p'] = [fila('Riesgos', 14, VERDE), fila('0 de 5', 26, VERDE), fila('Errores', 14, NARANJA), fila('0', 26, NARANJA)]
    elif n.startswith('Tecla_'):
        d['f'] = '#FFFFFF'
        _recolorear(d, VERDE)
    elif n.startswith('Ahc_'):
        ah = datos['ahorcado']
        if n == 'Ahc_Pista':
            _texto(d, [ah['palabras'][0]['pista']])
        elif n == 'Ahc_Contador':
            _texto(d, ['Palabra 1 de %d' % len(ah['palabras'])])
        elif n == 'Ahc_Palabra':
            _texto(d, ['  '.join('_' * len(ah['palabras'][0]['p']))])
        elif n == 'Ahc_Errores':
            _texto(d, ['Errores: 0 de %d' % ah['maxErrores']])
        elif n == 'Ahc_Retro':
            d['oculto'] = True
    elif n.startswith('Caso_'):
        c1 = datos['caso']['pasos'][0]
        if n == 'Caso_Paso':
            _texto(d, ['Decisión 1 de %d' % len(datos['caso']['pasos'])])
        elif n == 'Caso_Texto':
            _texto(d, [c1['q']])
        elif n in ('Caso_A', 'Caso_B'):
            d['f'] = '#FFFFFF'
            d.pop('oculto', None)
            _texto(d, [c1[n[-1]]])
        elif n == 'Caso_Retro':
            d['oculto'] = True
    # --- Módulo 11: buzones, reporte y chat ---
    elif n.startswith('Buz_'):
        if n == 'Buz_Contador':
            _texto(d, ['Situación 1 de %d' % len(datos['buzones']['situaciones'])])
        elif n == 'Buz_Tarjeta':
            d.pop('oculto', None)
            _texto(d, [datos['buzones']['situaciones'][0]['t']])
        elif n == 'Buz_Retro':
            d['oculto'] = True
        elif re.fullmatch(r'Buz_\d', n):
            d.pop('l', None)
            d.pop('lw', None)
    elif re.fullmatch(r'Rep_\d_[AB]', n):
        d['f'] = '#FFFFFF'
        _recolorear(d, '#203728')
    elif n == 'Rep_Retro':
        d['oculto'] = True
    elif n.startswith('Chat_'):
        c1 = datos['chat']['pasos'][0]
        if n == 'Chat_Bot':
            _texto(d, [c1['q']])
        elif n == 'Chat_Paso':
            _texto(d, ['Paso 1 de %d' % len(datos['chat']['pasos'])])
        elif n in ('Chat_A', 'Chat_B'):
            d['f'] = '#FFFFFF'
            d.pop('oculto', None)
            _texto(d, [c1[n[-1]]])
        elif n in ('Chat_User', 'Chat_FB'):
            d['oculto'] = True
        elif n == 'Chat_Puntaje':
            _texto(d, ['Respuestas seguras: 0 de %d' % len(datos['chat']['pasos'])])
    elif re.fullmatch(r'Op_[A-Z]_\w+', n) and not n.endswith('_c'):
        d['f'] = VERDE_CLARO
    elif n in ('RetroSi', 'RetroNo', 'Fin del tiempo') or n.startswith('Ic_'):
        d['oculto'] = True
    elif n == 'Puntaje_Final':
        _texto(d, ['Haz clic en «Ver mi puntaje»'])
    return d


def revelaciones(arbol, fs):
    """Animaciones de entrada con desencadenador: al pulsar una forma aparece otra (p. ej. la tarjeta del triaje y su tiempo).
    Devuelve [(forma que se pulsa, [formas que aparecen])]."""
    salida = []
    timing = arbol.find('.//p:timing', NS)
    if timing is None:
        return salida
    for seq in timing.iter('{%s}seq' % NS['p']):
        ctn = seq.find('p:cTn', NS)
        if ctn.get('nodeType') != 'interactiveSeq':
            continue
        disparador = seq.xpath('./p:cTn/p:stCondLst/p:cond/p:tgtEl/p:spTgt/@spid', namespaces=NS)
        destinos = []
        for ef in seq.xpath('.//p:cTn[@presetClass="entr"]', namespaces=NS):
            for spid in ef.xpath('.//p:spTgt/@spid', namespaces=NS):
                if spid in fs and fs[spid]['caja'] and spid not in destinos:
                    destinos.append(spid)
        if disparador and disparador[0] in fs and fs[disparador[0]]['caja'] and destinos:
            salida.append((disparador[0], destinos))
    return salida


def generar_macros(mod, trabajo):
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
    datos_mod = mod.get('datos', {})

    diapositivas, quitar_por_slide = [], {}
    for n, ruta in enumerate(rutas, 1):
        arbol = etree.fromstring(z.read(ruta))
        fs = formas(arbol, W, H)
        nombres = [f['nombre'] or '' for f in fs.values()]
        juego, patron = None, None
        for j, ident, pat in JUEGOS:
            if any(re.match(ident, nm) for nm in nombres):
                juego, patron = j, pat
                break
        exportar = [s for s, f in fs.items() if patron and f['caja'] and re.match(patron, f['nombre'] or '')]
        revela = revelaciones(arbol, fs) if not juego else []
        if revela:
            juego = 'revelar'
            exportar = [t for _, ts in revela for t in ts]
        segundos = [s for s, f in fs.items() if re.fullmatch(r'Segundo \d+', f['nombre'] or '')]
        sobrantes = [s for s, f in fs.items() if (f['nombre'] or '').startswith('Une_Linea_')]  # líneas guardadas de una prueba
        quitar_por_slide[ruta] = set(exportar) | set(segundos) | set(sobrantes)
        diapositivas.append({'n': n, 'ruta': ruta, 'fs': fs, 'juego': juego, 'exportar': exportar, 'segundos': segundos, 'revela': revela})

    sin = trabajo / f"{mod['id']}-fondo.pptx"
    with zipfile.ZipFile(origen) as zin, zipfile.ZipFile(sin, 'w', zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            datos = zin.read(item.filename)
            if quitar_por_slide.get(item.filename):
                a = etree.fromstring(datos)
                quitar(a, quitar_por_slide[item.filename])
                datos = etree.tostring(a, xml_declaration=True, encoding='UTF-8', standalone=True)
            zout.writestr(item, datos)
    pdf = trabajo / f"{mod['id']}-fondo.pdf"
    print(f"  LibreOffice: {mod['pptx']} …")
    convertir(sin, pdf)
    doc = fitz.open(pdf)
    assert len(doc) == len(rutas), f'páginas {len(doc)} y diapositivas {len(rutas)} no coinciden'

    salida, actividades = [], 0
    for d in diapositivas:
        nombre = f"d{d['n']:02d}.webp"
        pagina(doc, d['n'] - 1).save(destino / nombre, 'WEBP', quality=82, method=6)
        texto = ' '.join(f['texto'] for s, f in d['fs'].items() if f['texto'] and s not in quitar_por_slide[d['ruta']])
        dia = {'img': nombre, 'texto': texto}
        if d['juego']:
            dia['juego'] = d['juego']
            dia['formas'] = [inicial(estilo_forma(d['fs'][s], W, H), datos_mod) for s in d['exportar']]
            if d['juego'] == 'revelar':
                for f in dia['formas']:
                    f['oculto'] = True
                dia['revelar'] = []
                for disp, destinos in d['revela']:
                    x, y, w, h = d['fs'][disp]['caja']
                    for t in destinos:
                        dia['revelar'].append({'x': round(x * 100, 2), 'y': round(y * 100, 2), 'w': round(w * 100, 2), 'h': round(h * 100, 2),
                                               'etiqueta': d['fs'][disp]['texto'], 'destino': d['fs'][t]['nombre']})
            elif d['juego'] != 'cierre':
                actividades += 1
        if d['segundos']:
            cajas = [d['fs'][s]['caja'] for s in d['segundos']]
            x0, y0 = min(c[0] for c in cajas), min(c[1] for c in cajas)
            x1, y1 = max(c[0] + c[2] for c in cajas), max(c[1] + c[3] for c in cajas)
            dia['cronometro'] = {'segundos': max(int(d['fs'][s]['texto']) for s in d['segundos']), 'x': round(x0 * 100, 2),
                                 'y': round(y0 * 100, 2), 'w': round((x1 - x0) * 100, 2), 'h': round((y1 - y0) * 100, 2)}
        salida.append(dia)

    datos = {'id': mod['id'], 'titulo': mod['titulo'], 'proporcion': round(W / H, 4), 'puntaje': mod['puntaje'],
             'datos': datos_mod, 'diapositivas': salida}
    (destino / 'presentacion.json').write_text(json.dumps(datos, ensure_ascii=False, indent=1), encoding='utf-8')
    total = sum(f.stat().st_size for f in destino.iterdir())
    print(f"  {mod['id']}: {len(salida)} diapositivas, {actividades} con actividad, {total / 1e6:.1f} MB")
    return {'id': mod['id'], 'curso': mod['curso'], 'titulo': mod['titulo'], 'descripcion': mod['descripcion'],
            'portada': f"{mod['id']}/d{mod['portada']:02d}.webp", 'diapositivas': len(salida), 'actividades': actividades}


def main():
    if not shutil.which('docker'):
        sys.exit('Falta Docker (se usa LibreOffice de la imagen segpaciente-documentos).')
    trabajo = Path(tempfile.mkdtemp(prefix='presentaciones-'))
    try:
        SALIDA.mkdir(parents=True, exist_ok=True)
        pedidos = set(sys.argv[1:])
        previo = {}
        if (SALIDA / 'catalogo.json').exists():
            previo = {c['id']: c for c in json.loads((SALIDA / 'catalogo.json').read_text(encoding='utf-8'))}
        catalogo = []
        for m in MODULOS:
            if pedidos and m['id'] not in pedidos:
                if m['id'] in previo:
                    catalogo.append(previo[m['id']])
                continue
            catalogo.append((generar_macros if m.get('macros') else generar)(m, trabajo))
        (SALIDA / 'catalogo.json').write_text(json.dumps(catalogo, ensure_ascii=False, indent=1), encoding='utf-8')
        print('Listo:', SALIDA)
    finally:
        shutil.rmtree(trabajo, ignore_errors=True)


if __name__ == '__main__':
    main()
