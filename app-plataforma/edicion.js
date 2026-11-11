/* =====================================================================
   SUSANA SEGURA — modo de edición (solo editores y administradores)
   Lo carga sesion.js únicamente si el rol es editor o admin. Agrega:
   - lápiz sobre cada texto editable (data-texto),
   - lápiz y «+ Agregar tarjeta» en cada zona de tarjetas (data-zona),
   - lápiz en cada curso, «+ Nuevo curso» y cursos ocultos,
   - barra inferior: interruptor de edición y, para admins, «Usuarios».
   Todo se guarda por la API (/api/admin/*). Nada se inserta con innerHTML.
   ===================================================================== */
(function () {
  'use strict';

  var S = window.Susana;
  var C = window.SusanaContenido;
  if (!S || !S.yo || !C) return;
  var h = S.h, api = S.api, avisar = S.avisar, accion = S.accion, modal = S.modal;
  var esAdmin = S.yo.rol === 'admin';
  var F = window.SusanaFormato;
  var Rico = window.SusanaRico || { poner: function (e, v) { e.textContent = v; }, aTexto: function (v) { return v; }, limpiar: function (v) { return v; } };

  var SECCIONES = ['#inicio', '#curso', '#conoce', '#simula', '#detecta', '#aprende', '#perfil', '#admin'];
  var ETIQUETA_ROL = { admin: 'Administrador/a', editor: 'Editor/a', usuario: 'Personal' };

  /* ---------- Estado ---------- */
  // Siempre se inicia con la edición desactivada: hay que activarla a propósito en cada visita.
  var editando = false;
  var textosInfo = null; // clave → { valor, descripcion }
  var zonas = [];
  var objetivo = null;
  var ocultar = null;

  /* =================== Lápiz flotante para textos =================== */
  var lapiz = h('button', { type: 'button', id: 'ss-lapiz', class: 'ss-lapiz', hidden: true, 'aria-label': 'Editar este texto' }, '✏️');
  document.body.append(lapiz);

  function mostrarLapiz(el) {
    clearTimeout(ocultar);
    objetivo = el;
    var r = el.getBoundingClientRect();
    lapiz.style.left = Math.min(r.right - 6, window.innerWidth - 34) + 'px';
    lapiz.style.top = Math.max(r.top - 12, 4) + 'px';
    lapiz.hidden = false;
  }
  function programarOcultar() {
    clearTimeout(ocultar);
    ocultar = setTimeout(function () { lapiz.hidden = true; objetivo = null; }, 350);
  }

  document.addEventListener('pointerover', function (ev) {
    if (!editando || abierta || !ev.target.closest) return;
    if (ev.target.closest('.ss-modal') || ev.target.closest('#ss-barra') || ev.target.closest('.ss-minibarra')) return;
    if (ev.target === lapiz) { clearTimeout(ocultar); return; }
    var el = ev.target.closest('[data-texto]');
    if (el) mostrarLapiz(el);
  });
  document.addEventListener('pointerout', function (ev) {
    if (!objetivo) return;
    var haciaLapiz = ev.relatedTarget === lapiz;
    if (!haciaLapiz && ev.target.closest && (ev.target.closest('[data-texto]') === objetivo || ev.target === lapiz)) programarOcultar();
  });
  window.addEventListener('scroll', function () { lapiz.hidden = true; }, { passive: true });
  lapiz.addEventListener('click', function () {
    var el = objetivo;
    lapiz.hidden = true;
    if (el) editarTexto(el.getAttribute('data-texto'), el);
  });

  // Un clic directo sobre un texto que no es enlace ni botón también lo edita en su lugar.
  // Mientras se edita, los clics dentro de ese texto no activan enlaces ni botones.
  document.addEventListener('click', function (ev) {
    if (!editando || !ev.target.closest) return;
    if (ev.target.closest('.ss-en-edicion')) { ev.preventDefault(); ev.stopPropagation(); return; }
    if (abierta || ev.target.closest('.ss-modal, #ss-barra, .ss-minibarra, .ss-armando, #ss-lapiz')) return;
    var el = ev.target.closest('[data-texto]');
    if (!el || el.closest('a, button')) return;
    ev.preventDefault(); ev.stopPropagation();
    editarTexto(el.getAttribute('data-texto'), el);
  }, true);

  function cargarTextos() {
    if (textosInfo) return Promise.resolve(textosInfo);
    return api('GET', 'admin/textos').then(function (lista) {
      textosInfo = {};
      lista.forEach(function (t) { textosInfo[t.clave] = { valor: t.valor, descripcion: t.descripcion }; });
      return textosInfo;
    });
  }

  /* =================== Edición en el mismo lugar =================== */
  var abierta = null; // { foco() } — solo se edita una cosa a la vez

  function hayAbierta() {
    if (!abierta) return false;
    avisar('Termina primero la edición que tienes abierta (Guardar o Cancelar).', false);
    abierta.foco();
    return true;
  }

  // Convierte un elemento en un campo de texto simple, sin formato, editable donde está.
  function soloTexto(el) {
    try { el.contentEditable = 'plaintext-only'; } catch (e) { /* se usa el respaldo */ }
    if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
    el.spellcheck = true;
    el.addEventListener('paste', function (ev) {
      ev.preventDefault();
      var pegado = (ev.clipboardData || window.clipboardData).getData('text').replace(/\s*\n\s*/g, ' ');
      document.execCommand('insertText', false, pegado);
    });
  }

  function enfocar(el, seleccionarTodo) {
    el.focus();
    var sel = window.getSelection();
    var rango = document.createRange();
    rango.selectNodeContents(el);
    if (!seleccionarTodo) rango.collapse(false);
    sel.removeAllRanges();
    sel.addRange(rango);
  }

  function editarTexto(clave, el) {
    if (hayAbierta()) return;
    cargarTextos().then(function (info) {
      var t = info[clave];
      if (!t) return avisar('Este texto aún no se puede editar (no existe en la base de datos).', false);
      if (abierta) return;

      var guardar = h('button', { type: 'button', class: 'ss-mb-guardar' }, 'Guardar');
      var cancelar = h('button', { type: 'button' }, 'Cancelar');
      var barra = h('div', { class: 'ss-minibarra', role: 'group', 'aria-label': 'Guardar el texto' },
        guardar, cancelar, h('span', { class: 'ss-mb-ayuda' }, 'Enter guarda · Esc cancela'));
      document.body.append(barra);
      el.classList.add('ss-en-edicion');
      // Los nombres de las secciones (barra lateral) quedan en texto plano; el resto admite formato.
      var plano = el.hasAttribute('data-vista') || !!el.closest('[data-vista]') || !F;
      if (plano) soloTexto(el); else { Rico.poner(el, t.valor); F.activar(el, {}); }

      function ubicar() {
        var r = el.getBoundingClientRect();
        var alto = barra.offsetHeight;
        var abajo = r.bottom + 8;
        barra.style.left = Math.max(8, Math.min(r.left, window.innerWidth - barra.offsetWidth - 8)) + 'px';
        barra.style.top = (abajo + alto > window.innerHeight - 8 ? Math.max(8, r.top - alto - 8) : abajo) + 'px';
      }
      function cerrar(restaurar) {
        window.removeEventListener('scroll', ubicar, true);
        window.removeEventListener('resize', ubicar);
        el.removeEventListener('keydown', alTeclear);
        if (!plano) F.desactivar(el);
        el.removeAttribute('contenteditable');
        el.classList.remove('ss-en-edicion');
        barra.remove();
        abierta = null;
        if (restaurar) Rico.poner(el, t.valor);
      }
      function alTeclear(ev) {
        if (ev.key === 'Enter' && !(ev.shiftKey || (!plano && F.enLista(el)))) { ev.preventDefault(); guardar.click(); }
        else if (ev.key === 'Escape' && !document.querySelector('.ss-fb-url:focus')) { ev.preventDefault(); cancelar.click(); }
      }

      cancelar.addEventListener('click', function () { cerrar(true); });
      guardar.addEventListener('click', function () {
        var valor = plano ? el.textContent.replace(/\s*\n\s*/g, ' ').trim() : F.valor(el);
        if (valor === t.valor || (!plano && valor === Rico.limpiar(t.valor))) return cerrar(true);
        if (!valor) return avisar('El texto no puede quedar vacío.', false);
        accion(guardar, function () {
          return api('PUT', 'admin/textos/' + encodeURIComponent(clave), { valor: valor, descripcion: t.descripcion }).then(function () {
            t.valor = valor;
            var cambio = {}; cambio[clave] = valor;
            cerrar(false);
            C.aplicarTextos(cambio);
            avisar('Texto guardado.');
          });
        });
      });

      el.addEventListener('keydown', alTeclear);
      window.addEventListener('scroll', ubicar, true);
      window.addEventListener('resize', ubicar);
      abierta = { foco: function () { el.focus(); } };
      ubicar();
      enfocar(el, true);
    }).catch(function (e) { avisar(e.message, false); });
  }

  /* =================== Tarjetas por zona =================== */
  function lapizFijo(etiqueta, fn) {
    return h('button', { type: 'button', class: 'ss-lapiz-fijo', 'aria-label': etiqueta, title: etiqueta, onclick: function (ev) { ev.stopPropagation(); fn(); } }, '✏️');
  }

  function pintarTarjetasEdicion() {
    return Promise.all([api('GET', 'admin/zonas'), api('GET', 'admin/tarjetas')]).then(function (r) {
      zonas = r[0];
      var todas = r[1];
      document.querySelectorAll('[data-zona]').forEach(function (cont) {
        var zona = cont.getAttribute('data-zona');
        var propias = todas.filter(function (t) { return t.zona === zona; });
        var hijos = propias.map(function (t) {
          var art = C.crearTarjeta(t);
          art.classList.add('ss-editable');
          if (!t.publicado) {
            art.classList.add('ss-oculta');
            art.prepend(h('span', { class: 'ss-insignia' }, 'Oculta'));
          }
          art.append(lapizFijo('Editar tarjeta', function () { if (!hayAbierta()) armarTarjeta(art, t, zona); }));
          return art;
        });
        hijos.push(h('button', { type: 'button', class: 'ss-agregar', onclick: function (ev) {
          if (hayAbierta()) return;
          var boceto = h('article', { class: 'module-card ss-editable' });
          ev.currentTarget.before(boceto);
          ev.currentTarget.hidden = true;
          armarTarjeta(boceto, null, zona);
        } }, '+ Agregar tarjeta'));
        cont.replaceChildren.apply(cont, hijos);
        var visibles = propias.filter(function (t) { return t.publicado; }).length;
        document.querySelectorAll('[data-vacio="' + zona + '"]').forEach(function (a) { a.style.display = visibles ? 'none' : ''; });
      });
    });
  }

  function refrescarTarjetas() {
    return (editando ? pintarTarjetasEdicion() : C.cargar()).catch(function (e) { avisar(e.message, false); });
  }

  // Edita la tarjeta en su propio lugar: título, texto y botón se escriben sobre la tarjeta;
  // lo demás (enlace, orden, visibilidad, zona) va en una tira justo debajo.
  function armarTarjeta(art, tarjeta, zonaInicial) {
    var nueva = !tarjeta;
    var t = tarjeta || { zona: zonaInicial, orden: 0, icono: '', titulo: '', texto: '', boton: '', enlace: '', publicado: true };
    // La tarjeta nueva va al final de su zona (el borrador ya cuenta como una .module-card).
    if (nueva) t.orden = document.querySelectorAll('[data-zona="' + zonaInicial + '"] .module-card').length;

    var icono = h('input', { class: 'ss-icono-in', value: t.icono, maxlength: 16, placeholder: '🔎', 'aria-label': 'Icono (un emoji)' });
    var titulo = h('h3', { class: 'ss-campo', 'data-ph': 'Título de la tarjeta' }); Rico.poner(titulo, t.titulo);
    var texto = h('div', { class: 'ss-campo module-card-texto', 'data-ph': 'Texto (opcional)' }); Rico.poner(texto, t.texto);
    var boton = h('span', { class: 'btn btn-outline btn-sm ss-campo', 'data-ph': 'Texto del botón' }); boton.textContent = t.boton;
    var enlace = h('input', { value: t.enlace, maxlength: 500, list: 'ss-secciones', placeholder: '#conoce o https://…' });
    var orden = h('input', { type: 'number', value: String(t.orden) });
    var zona = h('select', {}, zonas.map(function (z) { return h('option', { value: z.zona }, z.nombre); })); zona.value = t.zona;
    var publicado = h('input', { type: 'checkbox' }); publicado.checked = t.publicado;
    var guardar = h('button', { class: 'btn btn-sm', type: 'button' }, 'Guardar');
    var cancelar = h('button', { class: 'btn btn-outline btn-sm', type: 'button' }, 'Cancelar');

    soloTexto(boton);
    boton.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') ev.preventDefault(); });
    F.activar(titulo, { linea: true });
    titulo.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') ev.preventDefault(); });
    F.activar(texto, {}); // el texto admite varias líneas y listas

    var tira = h('div', { class: 'ss-tira' },
      h('datalist', { id: 'ss-secciones' }, SECCIONES.map(function (s) { return h('option', { value: s }); })),
      h('label', {}, 'El botón lleva a ', enlace),
      h('div', { class: 'ss-cols' },
        h('label', {}, 'Dónde aparece', zona),
        h('label', {}, h('span', {}, 'Orden ', h('small', {}, '(1 va primero)')), orden)),
      h('label', { class: 'ss-check' }, publicado, 'Visible para todo el personal'),
      h('div', { class: 'ss-fila' }, guardar, cancelar,
        nueva ? null : h('button', { class: 'btn btn-peligro btn-sm ss-derecha', type: 'button', onclick: function (e) {
          if (!confirm('¿Borrar la tarjeta «' + Rico.aTexto(t.titulo) + '»? No se puede deshacer.\n(Si solo quieres quitarla de la vista, desmarca «Visible».)')) return;
          accion(e.target, function () {
            return api('DELETE', 'admin/tarjetas/' + t.id).then(function () { abierta = null; avisar('Tarjeta borrada.'); return refrescarTarjetas(); });
          });
        } }, 'Borrar')));

    art.classList.add('ss-armando');
    art.replaceChildren(icono, titulo, texto, boton, tira);

    cancelar.addEventListener('click', function () { abierta = null; refrescarTarjetas(); });
    guardar.addEventListener('click', function () {
      var cuerpo = {
        zona: zona.value, icono: icono.value.trim(), titulo: F.valor(titulo), texto: F.valor(texto),
        boton: boton.textContent.trim(), enlace: enlace.value.trim(), orden: parseInt(orden.value, 10) || 0, publicado: publicado.checked
      };
      if (!cuerpo.titulo) { avisar('La tarjeta necesita un título.', false); return titulo.focus(); }
      accion(guardar, function () {
        var p = nueva ? api('POST', 'admin/tarjetas', cuerpo) : api('PUT', 'admin/tarjetas/' + t.id, cuerpo);
        return p.then(function () { abierta = null; avisar('Tarjeta guardada.'); return refrescarTarjetas(); });
      });
    });

    abierta = { foco: function () { titulo.focus(); } };
    art.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    enfocar(titulo, false);
  }

  /* =================== Cursos =================== */
  var listaCursos = document.getElementById('curso-lista');
  var vistaLista = document.getElementById('curso-lista-vista');
  var detalle = document.getElementById('curso-detalle');
  var extraCursos = null;
  var botonDetalle = null;

  function envolverCursos() {
    if (!listaCursos) return;
    listaCursos.querySelectorAll('.cv-curso').forEach(function (b) {
      if (b.parentElement.classList.contains('ss-envuelto')) return;
      var id = b.dataset.id;
      var env = h('div', { class: 'ss-envuelto' });
      b.replaceWith(env);
      env.append(b, lapizFijo('Editar curso', function () { editarCurso(id, true); }));
    });
  }

  function pintarCursosExtra() {
    if (!vistaLista) return;
    if (extraCursos) extraCursos.remove();
    extraCursos = h('div', { class: 'ss-extra-cursos' });
    vistaLista.append(extraCursos);
    if (!editando) return;
    api('GET', 'admin/cursos').then(function (cursos) {
      var ocultos = cursos.filter(function (c) { return !c.publicado; });
      var grid = h('div', { class: 'cv-grid' }, ocultos.map(function (c) {
        var tarjeta = h('div', { class: 'cv-curso ss-oculta' },
          h('span', { class: 'ss-insignia' }, 'Oculto'),
          h('span', { class: 'cv-curso-icono', 'aria-hidden': 'true' }, '📖'),
          h('span', { class: 'cv-curso-titulo' }, c.titulo),
          h('span', { class: 'cv-curso-resumen' }, c.resumen || ''));
        return h('div', { class: 'ss-envuelto' }, tarjeta, lapizFijo('Editar curso', function () { editarCurso(c.id, false); }));
      }));
      grid.append(h('button', { type: 'button', class: 'ss-agregar', onclick: function () { editarCurso(null, true); } }, '+ Nuevo curso'));
      extraCursos.append(ocultos.length ? h('h3', { class: 'section-title ss-sep' }, 'Cursos ocultos y nuevos') : null, grid);
    }).catch(function (e) { avisar(e.message, false); });
  }

  function pintarBotonDetalle() {
    if (!detalle) return;
    if (!botonDetalle) {
      botonDetalle = h('button', { type: 'button', class: 'btn btn-outline btn-sm ss-solo-edicion', onclick: editarCursoEnLugar }, '✏️ Editar este curso');
      var titulo = document.getElementById('curso-detalle-titulo');
      if (titulo) titulo.after(botonDetalle);
    }
  }

  // breve = true: solo título, resumen y orden (desde la lista de cursos).
  // breve = false: el curso completo (desde dentro del curso, o los cursos ocultos, que no se pueden abrir).
  function editarCurso(id, breve) {
    Promise.all([api('GET', 'admin/cursos'), api('GET', 'admin/videos')]).then(function (r) {
      var curso = id ? r[0].filter(function (c) { return c.id === id; })[0] : null;
      if (id && !curso) return avisar('No se encontró el curso.', false);
      formularioCurso(curso, r[1], !!breve);
    }).catch(function (e) { avisar(e.message, false); });
  }

  function formularioCurso(curso, videos, breve) {
    var nuevo = !curso;
    var c = curso || { titulo: '', resumen: '', orden: 0, publicado: true, video: null, texto: [], documentos: [] };
    var m = modal(nuevo ? 'Nuevo curso' : 'Editar curso', breve ? 'ss-chico' : 'ss-ancho');

    var titulo = h('input', { value: c.titulo, maxlength: 200, required: true });
    var resumen = h('textarea', { maxlength: 500 }); resumen.value = c.resumen;
    var orden = h('input', { type: 'number', value: String(c.orden) });
    var publicado = h('input', { type: 'checkbox' }); publicado.checked = c.publicado;
    var video = h('select', {}, h('option', { value: '' }, '— Sin video —'),
      videos.map(function (v) { return h('option', { value: v.id }, v.titulo + (v.estado !== 'listo' ? ' (' + v.estado + ')' : '')); }));
    video.value = c.video || '';

    var listaTexto = h('div'); var listaDocs = h('div');
    function quitar(e) { e.target.closest('.ss-bloque').remove(); }
    function agregarParrafo(t) {
      var ta = h('textarea', { maxlength: 20000, 'aria-label': 'Párrafo' }); ta.value = t || '';
      listaTexto.append(h('div', { class: 'ss-bloque' }, ta, h('button', { class: 'btn btn-sm btn-peligro', type: 'button', onclick: quitar }, 'Quitar')));
    }
    function agregarDoc(d) {
      d = d || { titulo: '', archivo: '' };
      listaDocs.append(h('div', { class: 'ss-bloque' }, h('div', { class: 'ss-cols' },
        h('label', {}, 'Título', h('input', { value: d.titulo, maxlength: 200, 'data-campo': 'titulo' })),
        h('label', {}, 'Archivo o dirección', h('input', { value: d.archivo, maxlength: 500, 'data-campo': 'archivo', placeholder: 'media/documentos/guia.pdf o https://…' }))),
        h('button', { class: 'btn btn-sm btn-peligro', type: 'button', onclick: quitar }, 'Quitar')));
    }
    c.texto.forEach(agregarParrafo);
    c.documentos.forEach(agregarDoc);

    var guardar = h('button', { class: 'btn', type: 'submit' }, 'Guardar');
    var botones = h('div', { class: 'ss-fila' }, guardar,
      h('button', { class: 'btn btn-outline', type: 'button', onclick: m.cerrar }, 'Cancelar'),
      (nuevo || breve) ? null : h('button', {
        class: 'btn btn-peligro ss-derecha', type: 'button',
        onclick: function (e) {
          if (!confirm('¿Borrar el curso «' + c.titulo + '»? No se puede deshacer.\n(Si solo quieres quitarlo de la vista, desmarca «Publicado».)')) return;
          accion(e.target, function () {
            return api('DELETE', 'admin/cursos/' + encodeURIComponent(c.id)).then(function () { avisar('Curso borrado.'); recargarConservandoVista(); });
          });
        }
      }, 'Borrar curso'));

    var form = breve
      ? h('form', {},
          h('label', {}, 'Título', titulo),
          h('label', {}, h('span', {}, 'Resumen ', h('small', {}, '(se ve en la tarjeta del curso)')), resumen),
          h('label', {}, h('span', {}, 'Orden ', h('small', {}, '(1 va primero)')), orden),
          botones)
      : h('form', {},
          h('label', {}, 'Título', titulo),
          h('label', {}, h('span', {}, 'Resumen ', h('small', {}, '(se ve en la tarjeta del curso)')), resumen),
          h('div', { class: 'ss-cols' }, h('label', {}, 'Orden', orden), h('label', {}, 'Video', video)),
          h('label', { class: 'ss-check' }, publicado, 'Publicado (visible para todo el personal)'),
          h('h3', {}, 'Texto del curso'), listaTexto,
          h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: function () { agregarParrafo(); } }, '+ Párrafo'),
          h('h3', { class: 'ss-sep' }, 'Documentos'), listaDocs,
          h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: function () { agregarDoc(); } }, '+ Documento'),
          botones);

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var cuerpo = breve ? {
        titulo: titulo.value.trim(), resumen: resumen.value, orden: parseInt(orden.value, 10) || 0,
        publicado: c.publicado, video: c.video || null, texto: c.texto, documentos: c.documentos
      } : {
        titulo: titulo.value.trim(), resumen: resumen.value, orden: parseInt(orden.value, 10) || 0, publicado: publicado.checked,
        video: video.value || null,
        texto: [].map.call(listaTexto.querySelectorAll('textarea'), function (t) { return t.value.trim(); }).filter(Boolean),
        documentos: [].map.call(listaDocs.querySelectorAll('.ss-bloque'), function (b) {
          return { titulo: b.querySelector('[data-campo=titulo]').value.trim(), archivo: b.querySelector('[data-campo=archivo]').value.trim() };
        }).filter(function (d) { return d.titulo || d.archivo; })
      };
      accion(guardar, function () {
        var p = nuevo ? api('POST', 'admin/cursos', cuerpo) : api('PUT', 'admin/cursos/' + encodeURIComponent(c.id), cuerpo);
        return p.then(function () { avisar('Curso guardado.'); recargarConservandoVista(); });
      });
    });
    m.cuerpo.append(form);
    titulo.focus();
  }

  /* =================== Curso: edición dentro del propio curso =================== */
  var ETIQUETA_ESTADO = { subido: 'pendiente de convertir', procesando: 'procesando', listo: 'listo', error: 'con error' };

  function nombreCorto(ruta) {
    var ultimo = String(ruta || '').split('/').pop();
    try { return decodeURIComponent(ultimo); } catch (e) { return ultimo; }
  }

  // Sube un archivo con barra de avance. tipo: 'documento' | 'video'.
  function subirArchivo(tipo, archivo, alProgreso, huella) {
    return new Promise(function (ok, fallo) {
      var x = new XMLHttpRequest();
      x.open('POST', '/api/admin/archivos?tipo=' + tipo + '&nombre=' + encodeURIComponent(archivo.name) + (huella ? '&huella=' + huella : ''));
      x.setRequestHeader('content-type', 'application/octet-stream');
      x.upload.onprogress = function (e) { if (e.lengthComputable) alProgreso(Math.round(e.loaded * 100 / e.total)); };
      x.onload = function () {
        var d = null;
        try { d = JSON.parse(x.responseText); } catch (e) { /* sin cuerpo */ }
        if (x.status === 401) return fallo(new Error('Tu sesión terminó. Inicia sesión de nuevo.'));
        if (x.status >= 200 && x.status < 300) ok(d); else fallo(new Error((d && d.error) || 'Error ' + x.status));
      };
      x.onerror = function () { fallo(new Error('No se pudo subir el archivo. Revisa tu conexión.')); };
      x.send(archivo);
    });
  }

  // Panel típico de subida: arrastrar y soltar, o clic para elegir. opc: { icono, titulo, ayuda, aceptar, multiple, subir, alTerminar }
  function zonaSubida(opc) {
    var entrada = h('input', { type: 'file', accept: opc.aceptar, class: 'ss-drop-entrada', tabindex: '-1' });
    entrada.hidden = true;
    if (opc.multiple) entrada.multiple = true;
    var estado = h('div', { class: 'ss-drop-estado', 'aria-live': 'polite' });
    var zona = h('div', { class: 'ss-drop' + (opc.compacto ? ' ss-drop-compacto' : ''), tabindex: '0', role: 'button', 'aria-label': opc.titulo },
      h('span', { class: 'ss-drop-ico', 'aria-hidden': 'true' }, opc.icono), h('strong', {}, opc.titulo), h('small', {}, opc.ayuda), entrada);

    function procesar(archivos) {
      var lista = [].slice.call(archivos);
      if (!opc.multiple) lista = lista.slice(0, 1);
      lista.forEach(function (f) {
        var fila = h('div', { class: 'ss-drop-fila' }, f.name + ' · 0 %');
        estado.append(fila);
        opc.subir(f, function (p) { fila.textContent = f.name + ' · ' + p + ' %'; }).then(function (res) {
          fila.remove();
          opc.alTerminar(res, f);
        }).catch(function (e) {
          fila.textContent = f.name + ' — ' + e.message;
          fila.classList.add('ss-error');
          setTimeout(function () { fila.remove(); }, 7000);
          avisar(e.message, false);
        });
      });
    }

    entrada.addEventListener('click', function (ev) { ev.stopPropagation(); });
    entrada.addEventListener('change', function () { procesar(entrada.files); entrada.value = ''; });
    zona.addEventListener('click', function () { entrada.click(); });
    zona.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); entrada.click(); } });
    ['dragenter', 'dragover'].forEach(function (n) {
      zona.addEventListener(n, function (ev) { ev.preventDefault(); zona.classList.add('ss-drop-sobre'); });
    });
    zona.addEventListener('dragleave', function () { zona.classList.remove('ss-drop-sobre'); });
    zona.addEventListener('drop', function (ev) {
      ev.preventDefault();
      zona.classList.remove('ss-drop-sobre');
      if (ev.dataTransfer && ev.dataTransfer.files.length) procesar(ev.dataTransfer.files);
    });
    return h('div', { class: 'ss-drop-caja' }, zona, estado);
  }

  // Edita el curso abierto en su propio lugar: título, párrafos, documentos y video.
  function editarCursoEnLugar() {
    if (hayAbierta()) return;
    var id = detalle.dataset.id;
    Promise.all([api('GET', 'admin/cursos'), api('GET', 'admin/videos')]).then(function (r) {
      var original = r[0].filter(function (c) { return c.id === id; })[0];
      if (!original) return avisar('No se encontró el curso.', false);
      if (abierta) return;
      armarCurso(original, r[1]);
    }).catch(function (e) { avisar(e.message, false); });
  }

  function armarCurso(original, listaVideos) {
    listaVideos = listaVideos.slice();
    var c = JSON.parse(JSON.stringify(original)); // copia de trabajo
    var tituloEl = document.getElementById('curso-detalle-titulo');
    var textoEl = document.getElementById('curso-texto');
    var docsCaja = document.getElementById('curso-docs');
    var docsUl = document.getElementById('curso-docs-lista');
    var reproductor = detalle.querySelector('.cv-player');
    var rotuloVideo = reproductor.previousElementSibling;
    var extras = [];
    var vigilantes = [];

    /* --- Título --- */
    tituloEl.classList.add('ss-campo');
    tituloEl.setAttribute('data-ph', 'Título del curso');
    soloTexto(tituloEl);
    function sinEnter(ev) { if (ev.key === 'Enter') ev.preventDefault(); }
    tituloEl.addEventListener('keydown', sinEnter);

    /* --- Párrafos --- */
    var listaParr = h('div', { class: 'ss-parrafos' });
    function filaParrafo(t) {
      var p = h('div', { class: 'ss-campo cv-parrafo', 'data-ph': 'Escribe un párrafo…' });
      Rico.poner(p, t || '');
      F.activar(p, {});
      var fila = h('div', { class: 'ss-par' }, p,
        h('button', { type: 'button', class: 'ss-quitar', 'aria-label': 'Quitar este párrafo', title: 'Quitar este párrafo', onclick: function () { fila.remove(); } }, '✕'));
      p.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Enter' || ev.shiftKey || F.enLista(p)) return; // dentro de una lista, Enter agrega otro punto
        ev.preventDefault();
        var nueva = filaParrafo('');
        fila.after(nueva);
        enfocar(nueva.querySelector('.ss-campo'), false);
      });
      return fila;
    }
    c.texto.forEach(function (t) { listaParr.append(filaParrafo(t)); });
    var agregarParr = h('button', { type: 'button', class: 'btn btn-outline btn-sm ss-mas', onclick: function () {
      var nueva = filaParrafo(''); listaParr.append(nueva); enfocar(nueva.querySelector('.ss-campo'), false);
    } }, '+ Párrafo');
    textoEl.replaceChildren(listaParr, agregarParr);

    /* --- Documentos --- */
    function filaDoc(d) {
      var titulo = h('span', { class: 'ss-campo ss-doc-titulo', 'data-ph': 'Título del documento' });
      titulo.textContent = d.titulo;
      soloTexto(titulo);
      titulo.addEventListener('keydown', sinEnter);
      var li = h('li', { class: 'ss-doc' }, (window.SusanaRico ? window.SusanaRico.iconoArchivo(d.archivo) : h('span', { 'aria-hidden': 'true' }, '📄')), titulo,
        h('small', { class: 'ss-doc-archivo' }, nombreCorto(d.archivo)),
        h('button', { type: 'button', class: 'ss-quitar', 'aria-label': 'Quitar este documento', title: 'Quitar este documento', onclick: function () { li.remove(); } }, '✕'));
      li._doc = d; li._titulo = titulo;
      return li;
    }
    docsCaja.hidden = false;
    docsUl.replaceChildren.apply(docsUl, c.documentos.map(filaDoc));
    var dropDocs = zonaSubida({
      icono: '📎', titulo: 'Arrastra documentos aquí o haz clic para elegirlos',
      ayuda: 'PDF, Word, Excel, PowerPoint, TXT, CSV, PNG o JPG · hasta 25 MB cada uno',
      aceptar: '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.png,.jpg,.jpeg', multiple: true,
      subir: function (f, p) { return subirArchivo('documento', f, p); },
      alTerminar: function (res) { docsUl.append(filaDoc({ titulo: res.titulo, archivo: res.archivo })); }
    });
    docsCaja.append(dropDocs);
    extras.push(dropDocs);

    /* --- Videos (puede haber varios; cada uno con título, descripción y documentos propios) --- */
    var subidosAqui = {};            // videos subidos en esta edición: si no se guarda el curso, se descartan
    var limpieza = Promise.resolve(); // borrados pendientes (para no cruzarlos con una subida nueva)
    var NOTA_VIDEO = {
      listo: 'Video listo.',
      subido: 'Video subido. Se convertirá cuando guardes el curso.',
      procesando: 'Convirtiendo el video… se verá en el curso cuando termine.',
      error: 'Falló la conversión. Guarda el curso para reintentarla, o quita el video y sube otro.'
    };
    var EXT_DOCS = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.png,.jpg,.jpeg';
    var fichas = [];
    var cajaVideos = h('div', { class: 'ss-videos' });
    function videoDe(id) { return listaVideos.filter(function (x) { return x.id === id; })[0]; }
    function limpio(el) { return el.textContent.replace(/\s+/g, ' ').trim(); }
    function descartarSubido(id) {
      if (!subidosAqui[id]) return;
      delete subidosAqui[id];
      listaVideos = listaVideos.filter(function (x) { return x.id !== id; });
      limpieza = limpieza.then(function () { return api('DELETE', 'admin/videos/' + encodeURIComponent(id)); }).catch(function () { /* queda sin usar */ });
    }
    function pintarEstadoFicha(f) {
      var v = videoDe(f.it.video) || { id: f.it.video, estado: 'subido' };
      var imagen = v.estado === 'listo' && v.poster
        ? h('img', { class: 'ss-video-mini', src: v.poster, alt: 'Portada del video' })
        : h('div', { class: 'ss-video-mini ss-video-espera', 'aria-hidden': 'true' }, '🎬');
      f.cabeza.replaceChildren(imagen, h('span', { class: 'ss-video-nota', role: 'status' }, NOTA_VIDEO[v.estado] || ''), f.quitar);
    }
    function filaVideo(it) {
      var tit = h('p', { class: 'ss-campo ss-video-tit', 'data-ph': 'Título del video (opcional)' }); tit.textContent = it.titulo || '';
      var desc = h('div', { class: 'ss-campo cv-video-desc', 'data-ph': 'Descripción del video (opcional)' }); Rico.poner(desc, it.descripcion || '');
      soloTexto(tit); tit.addEventListener('keydown', sinEnter);
      F.activar(desc, {});
      desc.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && !ev.shiftKey && !F.enLista(desc)) ev.preventDefault(); });
      var ul = h('ul', { class: 'ss-video-docs' });
      (it.documentos || []).forEach(function (d) { ul.append(filaDoc(d)); });
      var cabeza = h('div', { class: 'ss-video-cabeza' });
      var f = { it: it, cabeza: cabeza, tit: tit, desc: desc, ul: ul };
      f.quitar = h('button', { type: 'button', class: 'ss-quitar', 'aria-label': 'Quitar este video del curso', title: 'Quitar este video del curso', onclick: function () {
        descartarSubido(it.video);
        f.el.remove();
        fichas.splice(fichas.indexOf(f), 1);
      } }, '✕');
      var dropDocsVideo = zonaSubida({
        icono: '📎', titulo: 'Documentos de este video: arrastra o haz clic',
        ayuda: 'PDF, Word, Excel, PowerPoint, TXT, CSV, PNG o JPG · hasta 25 MB cada uno',
        aceptar: EXT_DOCS, multiple: true, compacto: true,
        subir: function (a, p) { return subirArchivo('documento', a, p); },
        alTerminar: function (res) { ul.append(filaDoc({ titulo: res.titulo, archivo: res.archivo })); }
      });
      f.el = h('div', { class: 'ss-video-ficha' }, cabeza, tit, desc, ul, dropDocsVideo);
      pintarEstadoFicha(f);
      return f;
    }
    function agregarFicha(it) { var f = filaVideo(it); fichas.push(f); cajaVideos.append(f.el); }
    var inicial = (c.videos && c.videos.length) ? c.videos : (c.video ? [{ video: c.video, titulo: '', descripcion: '', documentos: [] }] : []);
    inicial.forEach(agregarFicha);

    // Huella del archivo: si ese mismo video ya se subió, se reutiliza y no se convierte otra vez.
    function huellaDe(archivo) {
      if (!window.crypto || !window.crypto.subtle) return Promise.resolve(null);
      return archivo.arrayBuffer().then(function (b) { return window.crypto.subtle.digest('SHA-256', b); }).then(function (buf) {
        return [].map.call(new Uint8Array(buf), function (n) { return ('0' + n.toString(16)).slice(-2); }).join('');
      }).catch(function () { return null; });
    }
    var dropVideo = zonaSubida({
      icono: '🎬', titulo: 'Arrastra un video MP4 aquí o haz clic para elegirlo',
      ayuda: 'Solo MP4 · hasta 100 MB en esta versión de prueba · puedes agregar varios', aceptar: 'video/mp4,.mp4', multiple: true,
      subir: function (f, p) {
        return limpieza.then(function () { return huellaDe(f); }).then(function (huella) {
          if (!huella) return subirArchivo('video', f, p);
          return api('GET', 'admin/archivos?huella=' + huella).then(function (ya) {
            if (ya) { ya.repetido = true; return ya; }
            return subirArchivo('video', f, p, huella);
          });
        });
      },
      alTerminar: function (res) {
        if (!videoDe(res.id)) listaVideos.push(res);
        if (fichas.some(function (x) { return x.it.video === res.id; })) return avisar('Ese video ya está en este curso.', false);
        if (res.repetido) avisar('Ese video ya estaba subido: se reutilizó sin convertirlo otra vez.');
        else { subidosAqui[res.id] = true; avisar('Video subido. Se convertirá cuando guardes el curso.'); }
        agregarFicha({ video: res.id, titulo: '', descripcion: '', documentos: [] });
      }
    });
    var panelVideo = h('div', { class: 'ss-video-panel' }, cajaVideos, dropVideo);
    rotuloVideo.after(panelVideo);
    extras.push(panelVideo);
    rotuloVideo.hidden = false;
    reproductor.hidden = true;
    // Mientras algún video del curso se convierte, se consulta su estado para mostrar cuándo queda listo.
    var sondeo = setInterval(function () {
      var hay = fichas.some(function (f) { var v = videoDe(f.it.video); return v && v.estado === 'procesando'; });
      if (!hay) return;
      api('GET', 'admin/videos').then(function (lista) { listaVideos = lista; fichas.forEach(pintarEstadoFicha); }).catch(function () { /* se reintenta */ });
    }, 5000);

    /* --- Barra de acciones --- */
    var guardar = h('button', { type: 'button', class: 'ss-mb-guardar' }, 'Guardar curso');
    var descartar = h('button', { type: 'button' }, 'Descartar cambios');
    var visible = h('input', { type: 'checkbox' }); visible.checked = c.publicado;
    var borrar = h('button', { type: 'button', class: 'ss-mb-peligro' }, 'Borrar curso');
    var barra = h('div', { class: 'ss-minibarra ss-barra-curso', role: 'group', 'aria-label': 'Guardar el curso' },
      guardar, descartar, h('label', { class: 'ss-mb-check' }, visible, 'Visible'), borrar);
    document.body.append(barra);
    document.body.classList.add('ss-curso-editando');
    if (botonDetalle) botonDetalle.hidden = true;

    function videosListos() { return listaVideos.filter(function (v) { return v.estado === 'listo'; }); }

    function cerrar() {
      tituloEl.classList.remove('ss-campo');
      tituloEl.removeAttribute('data-ph');
      tituloEl.removeAttribute('contenteditable');
      tituloEl.removeEventListener('keydown', sinEnter);
      extras.forEach(function (e) { e.remove(); });
      vigilantes.forEach(function (v) { v.disconnect(); });
      clearInterval(sondeo);
      barra.remove();
      document.body.classList.remove('ss-curso-editando');
      if (botonDetalle) botonDetalle.hidden = false;
      abierta = null;
    }

    descartar.addEventListener('click', function () {
      Object.keys(subidosAqui).forEach(descartarSubido);
      cerrar();
      if (window.SusanaCurso) window.SusanaCurso.refrescar(original, videosListos());
    });

    guardar.addEventListener('click', function () {
      var titulo = tituloEl.textContent.replace(/\s+/g, ' ').trim();
      if (!titulo) { avisar('El curso necesita un título.', false); return tituloEl.focus(); }
      var cuerpo = {
        titulo: titulo, resumen: original.resumen, orden: original.orden, publicado: visible.checked,
        videos: fichas.map(function (f) {
          return { video: f.it.video, titulo: limpio(f.tit), descripcion: F.valor(f.desc),
            documentos: [].map.call(f.ul.querySelectorAll('li.ss-doc'), function (li) {
              return { titulo: limpio(li._titulo) || nombreCorto(li._doc.archivo), archivo: li._doc.archivo };
            }) };
        }),
        texto: [].map.call(listaParr.querySelectorAll('.ss-par > .ss-campo'), function (p) { return F.valor(p); }).filter(Boolean),
        documentos: [].map.call(docsUl.querySelectorAll('li.ss-doc'), function (li) {
          return { titulo: li._titulo.textContent.replace(/\s+/g, ' ').trim() || nombreCorto(li._doc.archivo), archivo: li._doc.archivo };
        })
      };
      var aConvertir = fichas.some(function (f) { var v = videoDe(f.it.video); return !v || v.estado === 'subido' || v.estado === 'error'; });
      accion(guardar, function () {
        return api('PUT', 'admin/cursos/' + encodeURIComponent(original.id), cuerpo).then(function () {
          subidosAqui = {}; // ya forman parte del curso
          cerrar();
          avisar(aConvertir ? 'Curso guardado. El video se está convirtiendo; aparecerá en el curso en unos minutos.' : 'Curso guardado.');
          if (cuerpo.publicado !== original.publicado) return recargarConservandoVista(); // cambia la lista de cursos
          var nuevo = { id: original.id, titulo: cuerpo.titulo, resumen: original.resumen, orden: original.orden, publicado: cuerpo.publicado,
            video: cuerpo.videos.length ? cuerpo.videos[0].video : null, videos: cuerpo.videos, texto: cuerpo.texto, documentos: cuerpo.documentos };
          if (window.SusanaCurso) window.SusanaCurso.refrescar(nuevo, videosListos());
        });
      });
    });

    borrar.addEventListener('click', function () {
      if (!confirm('¿Borrar el curso «' + original.titulo + '»? No se puede deshacer.\n(Si solo quieres quitarlo de la vista, desmarca «Visible».)')) return;
      accion(borrar, function () {
        return api('DELETE', 'admin/cursos/' + encodeURIComponent(original.id)).then(function () { avisar('Curso borrado.'); recargarConservandoVista(); });
      });
    });

    // Si se sale del curso (Volver, otra sección) con la edición abierta, se descartan los cambios.
    var vigia = new MutationObserver(function () { if (detalle.hidden) descartar.click(); });
    vigia.observe(detalle, { attributes: true, attributeFilter: ['hidden'] });
    vigilantes.push(vigia);

    abierta = { foco: function () { tituloEl.focus(); } };
    enfocar(tituloEl, false);
  }

  // Los cursos los carga curso.js una sola vez: tras guardar se recarga la página (queda en la misma sección).
  function recargarConservandoVista() {
    setTimeout(function () { location.reload(); }, 400);
  }

  /* =================== Usuarios (solo admin) =================== */
  var ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  function claveAleatoria(largo) {
    var salida = '';
    var limite = 256 - (256 % ALFABETO.length);
    while (salida.length < (largo || 10)) {
      var b = crypto.getRandomValues(new Uint8Array(16));
      for (var i = 0; i < b.length && salida.length < (largo || 10); i++) if (b[i] < limite) salida += ALFABETO[b[i] % ALFABETO.length];
    }
    return salida;
  }

  function selectorRol(valor, deshabilitado) {
    var s = h('select', { disabled: deshabilitado },
      h('option', { value: 'usuario' }, ETIQUETA_ROL.usuario), h('option', { value: 'editor' }, ETIQUETA_ROL.editor), h('option', { value: 'admin' }, ETIQUETA_ROL.admin));
    s.value = valor;
    return s;
  }

  function modalUsuarios() {
    var m = modal('Usuarios', 'ss-ancho');
    var contenedor = h('div');
    m.cuerpo.append(contenedor);
    pintarUsuarios(contenedor);
  }

  function pintarUsuarios(raiz) {
    api('GET', 'admin/usuarios').then(function (usuarios) {
      var buscador = h('input', { type: 'search', placeholder: 'Buscar usuario…', 'aria-label': 'Buscar usuario' });
      var lista = h('div', { class: 'ss-usuarios' });
      var resumen = h('p', { class: 'ss-nota' });

      function pintarLista() {
        var q = buscador.value.trim().toLowerCase();
        var coinciden = usuarios.filter(function (u) { return !q || u.usuario.indexOf(q) >= 0; });
        resumen.textContent = usuarios.length + ' usuarios en total' + (coinciden.length > 60 ? ' · mostrando 60 de ' + coinciden.length + ' (usa el buscador)' : '');
        lista.replaceChildren.apply(lista, coinciden.slice(0, 60).map(filaUsuario));
      }

      function filaUsuario(u) {
        var propio = u.id === S.yo.id;
        var rol = selectorRol(u.rol, propio);
        rol.addEventListener('change', function () {
          accion(rol, function () { return api('PATCH', 'admin/usuarios/' + u.id, { rol: rol.value }).then(function () { u.rol = rol.value; avisar('Rol actualizado.'); }); })
            .then(function () { rol.value = u.rol; });
        });
        var estado = h('button', { class: 'btn btn-sm ' + (u.activo ? 'btn-peligro' : 'btn-outline'), type: 'button', disabled: propio }, u.activo ? 'Desactivar' : 'Activar');
        estado.addEventListener('click', function () {
          accion(estado, function () {
            return api('PATCH', 'admin/usuarios/' + u.id, { activo: !u.activo }).then(function () {
              avisar(u.activo ? 'Usuario desactivado.' : 'Usuario activado.'); pintarUsuarios(raiz);
            });
          });
        });
        return h('div', { class: 'ss-usuario' + (u.activo ? '' : ' ss-inactivo') },
          h('div', { class: 'ss-usuario-nombre' }, u.usuario, propio ? ' (tú)' : '', u.activo ? null : h('span', { class: 'ss-insignia-i' }, 'Desactivado')),
          h('div', { class: 'ss-usuario-acc' }, rol,
            h('button', { class: 'btn btn-sm btn-outline', type: 'button', onclick: function () { dialogoClaveDe(u); } }, 'Nueva clave'), estado));
      }
      buscador.addEventListener('input', pintarLista);
      pintarLista();

      // Actualiza solo la lista (sin borrar el resultado de una importación que está en pantalla).
      function recargarLista() {
        return api('GET', 'admin/usuarios').then(function (nuevos) { usuarios = nuevos; pintarLista(); });
      }

      raiz.replaceChildren(
        h('div', { class: 'ss-fila', style: 'margin-top:0' }, buscador),
        resumen, lista,
        h('details', { class: 'ss-detalles' }, h('summary', {}, '➕ Agregar una persona'), formularioUsuarioNuevo(raiz)),
        h('details', { class: 'ss-detalles' }, h('summary', {}, '📋 Importar una lista de personal'), formularioImportar(recargarLista)));
    }).catch(function (e) { avisar(e.message, false); });
  }

  function dialogoClaveDe(u) {
    var m = modal('Nueva clave para ' + u.usuario, 'ss-chico');
    var clave = h('input', { value: claveAleatoria(10), minlength: 10, maxlength: 200, required: true, autocomplete: 'off', spellcheck: 'false' });
    var guardar = h('button', { class: 'btn', type: 'submit' }, 'Guardar clave');
    var form = h('form', {},
      h('label', {}, h('span', {}, 'Clave ', h('small', {}, '(se generó una; puedes escribir otra. Mínimo 10 caracteres)')), clave),
      h('p', { class: 'ss-nota' }, 'Anótala y entrégasela a la persona: después de guardar no se puede volver a ver. Se cerrarán sus sesiones abiertas.'),
      h('div', { class: 'ss-fila' }, guardar, h('button', { class: 'btn btn-outline', type: 'button', onclick: m.cerrar }, 'Cancelar')));
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      accion(guardar, function () {
        return api('PATCH', 'admin/usuarios/' + u.id, { clave: clave.value }).then(function () {
          clave.readOnly = true;
          guardar.hidden = true;
          avisar('Clave cambiada. Anótala antes de cerrar esta ventana.');
        });
      });
    });
    m.cuerpo.append(form);
    clave.select();
  }

  function formularioUsuarioNuevo(raiz) {
    var usuario = h('input', { maxlength: 32, required: true, autocomplete: 'off', placeholder: 'minúsculas, números y _' });
    var clave = h('input', { value: claveAleatoria(10), minlength: 10, required: true, autocomplete: 'off', spellcheck: 'false' });
    var rol = selectorRol('usuario', false);
    var crear = h('button', { class: 'btn', type: 'submit' }, 'Crear usuario');
    var form = h('form', {},
      h('div', { class: 'ss-cols' }, h('label', {}, 'Usuario', usuario), h('label', {}, 'Clave temporal', clave)),
      h('label', {}, 'Rol', rol), crear);
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var nombre = usuario.value.trim().toLowerCase();
      accion(crear, function () {
        return api('POST', 'admin/usuarios', { usuario: nombre, clave: clave.value, rol: rol.value }).then(function () {
          avisar('Usuario «' + nombre + '» creado. Clave: ' + clave.value + ' (anótala).');
          pintarUsuarios(raiz);
        });
      });
    });
    return form;
  }

  function formularioImportar(recargarLista) {
    var texto = h('textarea', { rows: 6, placeholder: 'una persona por línea:\nmaria_perez\njuan_rojas,UnaClave2026\n\n(si no pones clave, se genera una)', spellcheck: 'false' });
    var rol = selectorRol('usuario', false);
    var importar = h('button', { class: 'btn', type: 'submit' }, 'Importar');
    var salida = h('div', { class: 'ss-salida' });
    var form = h('form', {},
      h('p', { class: 'ss-nota' }, 'Formato por línea: usuario  o  usuario,clave. Usuarios: 3 a 32 caracteres (minúsculas, números y _). Las claves deben tener al menos 10 caracteres. Los que ya existen se omiten.'),
      h('label', {}, 'Lista', texto), h('label', {}, 'Rol de todos', rol), importar, salida);

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var lineas = texto.value.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
      if (!lineas.length) return avisar('Pega al menos un usuario.', false);
      var items = lineas.map(function (l) {
        var p = l.split(/[,;\t]/).map(function (x) { return x.trim(); });
        var generada = !p[1];
        return { usuario: p[0].toLowerCase(), clave: generada ? claveAleatoria(10) : p[1], generada: generada };
      });
      var resultados = [];
      importar.disabled = true;
      var LOTE = 10;
      var i = 0;
      function siguiente() {
        if (i >= items.length) return Promise.resolve();
        var trozo = items.slice(i, i + LOTE);
        salida.textContent = 'Importando… ' + Math.min(i + LOTE, items.length) + ' de ' + items.length;
        return api('POST', 'admin/usuarios/lote', { rol: rol.value, usuarios: trozo.map(function (t) { return { usuario: t.usuario, clave: t.clave }; }) })
          .then(function (r) {
            r.resultado.forEach(function (x, k) { resultados.push({ usuario: x.usuario, estado: x.estado, motivo: x.motivo, clave: trozo[k].clave, generada: trozo[k].generada }); });
            i += LOTE;
            return siguiente();
          });
      }
      siguiente().then(function () {
        mostrarResultadoImportacion(salida, resultados);
        return recargarLista();
      }).catch(function (e) {
        avisar(e.message, false);
        if (resultados.length) mostrarResultadoImportacion(salida, resultados);
      }).then(function () { importar.disabled = false; });
    });
    return form;
  }

  function mostrarResultadoImportacion(salida, resultados) {
    var creados = resultados.filter(function (r) { return r.estado === 'creado'; });
    var otros = resultados.filter(function (r) { return r.estado !== 'creado'; });
    var csv = 'usuario,clave\n' + creados.map(function (r) { return r.usuario + ',' + r.clave; }).join('\n');
    var descarga = null;
    if (creados.length) {
      var url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
      descarga = h('a', { class: 'btn btn-sm', href: url, download: 'usuarios-creados.csv' }, '⬇ Descargar usuarios y claves (CSV)');
    }
    salida.replaceChildren(
      h('p', { class: 'ss-ok' }, creados.length + ' creados, ' + otros.length + ' omitidos.'),
      creados.length ? h('p', { class: 'ss-nota' }, 'Descarga ahora la lista con las claves: no se podrán volver a ver.') : null,
      descarga,
      otros.length ? h('ul', { class: 'ss-omitidos' }, otros.map(function (r) { return h('li', {}, (r.usuario || '(vacío)') + ': ' + r.motivo); })) : null);
  }

  /* =================== Barra inferior =================== */
  var interruptor = h('button', { type: 'button', class: 'ss-interruptor', 'aria-pressed': String(editando) });
  function pintarInterruptor() {
    interruptor.textContent = editando ? '✏️ Edición activada' : '✏️ Edición desactivada';
    interruptor.setAttribute('aria-pressed', String(editando));
  }
  var barra = h('div', { id: 'ss-barra', role: 'toolbar', 'aria-label': 'Herramientas de edición' }, interruptor,
    esAdmin ? h('button', { type: 'button', class: 'ss-boton-barra', onclick: modalUsuarios }, '👥 Usuarios') : null);
  var destino = document.querySelector('.topbar-right');
  if (destino) destino.insertBefore(barra, destino.firstChild);
  else { document.body.append(barra); document.body.classList.add('ss-con-barra'); }

  function aplicarModo() {
    document.body.classList.toggle('ss-editando', editando);
    pintarInterruptor();
    if (!editando) lapiz.hidden = true;
    refrescarTarjetas();
    pintarCursosExtra();
  }

  interruptor.addEventListener('click', function () {
    if (hayAbierta()) return;
    editando = !editando;
    aplicarModo();
  });

  /* =================== Arranque =================== */
  pintarBotonDetalle();
  envolverCursos();
  if (listaCursos) new MutationObserver(envolverCursos).observe(listaCursos, { childList: true });
  aplicarModo();
})();
