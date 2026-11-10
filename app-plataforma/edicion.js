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

  var SECCIONES = ['#inicio', '#curso', '#conoce', '#simula', '#detecta', '#aprende', '#perfil', '#admin'];
  var ETIQUETA_ROL = { admin: 'Administrador/a', editor: 'Editor/a', usuario: 'Personal' };

  /* ---------- Estado ---------- */
  var editando = true;
  try { editando = localStorage.getItem('ss-edicion') !== '0'; } catch (e) { /* sin almacenamiento */ }
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
    if (!editando || !ev.target.closest) return;
    if (ev.target.closest('.ss-modal') || ev.target.closest('#ss-barra')) return;
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
    if (objetivo) editarTexto(objetivo.getAttribute('data-texto'));
    lapiz.hidden = true;
  });

  function cargarTextos() {
    if (textosInfo) return Promise.resolve(textosInfo);
    return api('GET', 'admin/textos').then(function (lista) {
      textosInfo = {};
      lista.forEach(function (t) { textosInfo[t.clave] = { valor: t.valor, descripcion: t.descripcion }; });
      return textosInfo;
    });
  }

  function editarTexto(clave) {
    cargarTextos().then(function (info) {
      var t = info[clave];
      if (!t) return avisar('Este texto aún no se puede editar (no existe en la base de datos).', false);
      var m = modal('Editar texto', 'ss-chico');
      var campo = h('textarea', { maxlength: 5000, rows: t.valor.length > 90 ? 5 : 2 }); campo.value = t.valor;
      var guardar = h('button', { class: 'btn', type: 'submit' }, 'Guardar');
      var form = h('form', {},
        h('label', {}, t.descripcion || clave, campo),
        h('div', { class: 'ss-fila' }, guardar, h('button', { class: 'btn btn-outline', type: 'button', onclick: m.cerrar }, 'Cancelar')));
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        accion(guardar, function () {
          return api('PUT', 'admin/textos/' + encodeURIComponent(clave), { valor: campo.value, descripcion: t.descripcion }).then(function () {
            t.valor = campo.value;
            var cambio = {}; cambio[clave] = campo.value;
            C.aplicarTextos(cambio);
            avisar('Texto guardado.');
            m.cerrar();
          });
        });
      });
      m.cuerpo.append(form);
      campo.focus();
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
          art.append(lapizFijo('Editar tarjeta', function () { editarTarjeta(t, zona); }));
          return art;
        });
        hijos.push(h('button', { type: 'button', class: 'ss-agregar', onclick: function () { editarTarjeta(null, zona); } }, '+ Agregar tarjeta'));
        cont.replaceChildren.apply(cont, hijos);
        var visibles = propias.filter(function (t) { return t.publicado; }).length;
        document.querySelectorAll('[data-vacio="' + zona + '"]').forEach(function (a) { a.style.display = visibles ? 'none' : ''; });
      });
    });
  }

  function refrescarTarjetas() {
    return (editando ? pintarTarjetasEdicion() : C.cargar()).catch(function (e) { avisar(e.message, false); });
  }

  function editarTarjeta(tarjeta, zonaInicial) {
    var nueva = !tarjeta;
    var t = tarjeta || { zona: zonaInicial, orden: 0, icono: '', titulo: '', texto: '', boton: '', enlace: '', publicado: true };
    if (nueva) {
      // La tarjeta nueva va al final de su zona.
      var otras = document.querySelectorAll('[data-zona="' + zonaInicial + '"] .module-card').length;
      t.orden = otras + 1;
    }
    var m = modal(nueva ? 'Nueva tarjeta' : 'Editar tarjeta');
    var zona = h('select', {}, zonas.map(function (z) { return h('option', { value: z.zona }, z.nombre); })); zona.value = t.zona;
    var icono = h('input', { value: t.icono, maxlength: 16, placeholder: '🔎' });
    var titulo = h('input', { value: t.titulo, maxlength: 200, required: true });
    var texto = h('textarea', { maxlength: 1000 }); texto.value = t.texto;
    var boton = h('input', { value: t.boton, maxlength: 60, placeholder: 'Entrar (vacío si no lleva botón)' });
    var enlace = h('input', { value: t.enlace, maxlength: 500, list: 'ss-secciones', placeholder: '#conoce o https://…' });
    var orden = h('input', { type: 'number', value: String(t.orden) });
    var publicado = h('input', { type: 'checkbox' }); publicado.checked = t.publicado;
    var guardar = h('button', { class: 'btn', type: 'submit' }, 'Guardar');

    var form = h('form', {},
      h('datalist', { id: 'ss-secciones' }, SECCIONES.map(function (s) { return h('option', { value: s }); })),
      h('label', {}, 'Dónde aparece', zona),
      h('div', { class: 'ss-cols' }, h('label', {}, 'Icono (un emoji)', icono), h('label', {}, h('span', {}, 'Orden ', h('small', {}, '(1 va primero)')), orden)),
      h('label', {}, 'Título', titulo),
      h('label', {}, 'Texto', texto),
      h('div', { class: 'ss-cols' },
        h('label', {}, 'Texto del botón', boton),
        h('label', {}, h('span', {}, 'A dónde lleva ', h('small', {}, '(#seccion o https://…)')), enlace)),
      h('label', { class: 'ss-check' }, publicado, 'Visible para todo el personal'),
      h('div', { class: 'ss-fila' }, guardar,
        h('button', { class: 'btn btn-outline', type: 'button', onclick: m.cerrar }, 'Cancelar'),
        nueva ? null : h('button', {
          class: 'btn btn-peligro ss-derecha', type: 'button',
          onclick: function (e) {
            if (!confirm('¿Borrar la tarjeta «' + t.titulo + '»? No se puede deshacer.\n(Si solo quieres quitarla de la vista, desmarca «Visible».)')) return;
            accion(e.target, function () {
              return api('DELETE', 'admin/tarjetas/' + t.id).then(function () { avisar('Tarjeta borrada.'); m.cerrar(); return refrescarTarjetas(); });
            });
          }
        }, 'Borrar')));

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var cuerpo = {
        zona: zona.value, icono: icono.value.trim(), titulo: titulo.value.trim(), texto: texto.value.trim(),
        boton: boton.value.trim(), enlace: enlace.value.trim(), orden: parseInt(orden.value, 10) || 0, publicado: publicado.checked
      };
      accion(guardar, function () {
        var p = nueva ? api('POST', 'admin/tarjetas', cuerpo) : api('PUT', 'admin/tarjetas/' + t.id, cuerpo);
        return p.then(function () { avisar('Tarjeta guardada.'); m.cerrar(); return refrescarTarjetas(); });
      });
    });
    m.cuerpo.append(form);
    titulo.focus();
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
      env.append(b, lapizFijo('Editar curso', function () { editarCurso(id); }));
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
        return h('div', { class: 'ss-envuelto' }, tarjeta, lapizFijo('Editar curso', function () { editarCurso(c.id); }));
      }));
      grid.append(h('button', { type: 'button', class: 'ss-agregar', onclick: function () { editarCurso(null); } }, '+ Nuevo curso'));
      extraCursos.append(ocultos.length ? h('h3', { class: 'section-title ss-sep' }, 'Cursos ocultos y nuevos') : null, grid);
    }).catch(function (e) { avisar(e.message, false); });
  }

  function pintarBotonDetalle() {
    if (!detalle) return;
    if (!botonDetalle) {
      botonDetalle = h('button', { type: 'button', class: 'btn btn-outline btn-sm ss-solo-edicion', onclick: function () { editarCurso(detalle.dataset.id); } }, '✏️ Editar este curso');
      var titulo = document.getElementById('curso-detalle-titulo');
      if (titulo) titulo.after(botonDetalle);
    }
  }

  function editarCurso(id) {
    Promise.all([api('GET', 'admin/cursos'), api('GET', 'admin/videos')]).then(function (r) {
      var curso = id ? r[0].filter(function (c) { return c.id === id; })[0] : null;
      if (id && !curso) return avisar('No se encontró el curso.', false);
      formularioCurso(curso, r[1]);
    }).catch(function (e) { avisar(e.message, false); });
  }

  function formularioCurso(curso, videos) {
    var nuevo = !curso;
    var c = curso || { titulo: '', resumen: '', orden: 0, publicado: true, video: null, texto: [], documentos: [] };
    var m = modal(nuevo ? 'Nuevo curso' : 'Editar curso', 'ss-ancho');

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
    var form = h('form', {},
      h('label', {}, 'Título', titulo),
      h('label', {}, h('span', {}, 'Resumen ', h('small', {}, '(se ve en la tarjeta del curso)')), resumen),
      h('div', { class: 'ss-cols' }, h('label', {}, 'Orden', orden), h('label', {}, 'Video', video)),
      h('label', { class: 'ss-check' }, publicado, 'Publicado (visible para todo el personal)'),
      h('h3', {}, 'Texto del curso'), listaTexto,
      h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: function () { agregarParrafo(); } }, '+ Párrafo'),
      h('h3', { class: 'ss-sep' }, 'Documentos'), listaDocs,
      h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: function () { agregarDoc(); } }, '+ Documento'),
      h('div', { class: 'ss-fila' }, guardar,
        h('button', { class: 'btn btn-outline', type: 'button', onclick: m.cerrar }, 'Cancelar'),
        nuevo ? null : h('button', {
          class: 'btn btn-peligro ss-derecha', type: 'button',
          onclick: function (e) {
            if (!confirm('¿Borrar el curso «' + c.titulo + '»? No se puede deshacer.\n(Si solo quieres quitarlo de la vista, desmarca «Publicado».)')) return;
            accion(e.target, function () {
              return api('DELETE', 'admin/cursos/' + encodeURIComponent(c.id)).then(function () { avisar('Curso borrado.'); recargarConservandoVista(); });
            });
          }
        }, 'Borrar curso')));

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var cuerpo = {
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
  document.body.append(barra);
  document.body.classList.add('ss-con-barra');

  function aplicarModo() {
    document.body.classList.toggle('ss-editando', editando);
    pintarInterruptor();
    if (!editando) lapiz.hidden = true;
    refrescarTarjetas();
    pintarCursosExtra();
  }

  interruptor.addEventListener('click', function () {
    editando = !editando;
    try { localStorage.setItem('ss-edicion', editando ? '1' : '0'); } catch (e) { /* sin almacenamiento */ }
    aplicarModo();
  });

  /* =================== Arranque =================== */
  pintarBotonDetalle();
  envolverCursos();
  if (listaCursos) new MutationObserver(envolverCursos).observe(listaCursos, { childList: true });
  aplicarModo();
})();
