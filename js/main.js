/* Deinorus: un solo contexto WebGL compartido (Three r128 global) que dibuja cada escena
   en un canvas 2D por "slot". Los visuales 2D van en Canvas puro. Todo el contenido se lee sin JS. */
(function () {
  'use strict';

  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var BLUE = 0x2f8cff, MINT = 0x5ff2c8;
  var wide = function () { return window.innerWidth >= 900; };

  /* ---------- utilidades ---------- */
  function onVisible(el, cb) {
    if (!('IntersectionObserver' in window)) { cb(true); return; }
    new IntersectionObserver(function (es) { cb(es[0].isIntersecting); }, { rootMargin: '80px' }).observe(el);
  }
  function rng(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function ease(t) { return t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  /* ---------- reveal al hacer scroll ---------- */
  (function () {
    var els = [].slice.call(document.querySelectorAll('.reveal'));
    if (!('IntersectionObserver' in window) || reduce) { els.forEach(function (e) { e.classList.add('in'); }); return; }
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: .12, rootMargin: '0px 0px -6% 0px' });
    els.forEach(function (e, i) { e.style.transitionDelay = (i % 3) * 70 + 'ms'; io.observe(e); });
  })();


  /* ---------- loops de las tarjetas: solo corren en pantalla; con reduced-motion queda el poster ---------- */
  (function () {
    var vids = [].slice.call(document.querySelectorAll('video.loop'));
    var saver = navigator.connection && navigator.connection.saveData;
    if (reduce || saver) { vids.forEach(function (v) { v.removeAttribute('autoplay'); }); return; }
    vids.forEach(function (v) {
      v.addEventListener('playing', function () { v.classList.add('on'); });
      onVisible(v, function (vis) {
        if (vis && !document.documentElement.classList.contains('modal-open')) { var pr = v.play(); if (pr && pr.catch) pr.catch(function () {}); }
        else v.pause();
      });
    });
    document.addEventListener('visibilitychange', function () { if (document.hidden) vids.forEach(function (v) { v.pause(); }); });
  })();

  /* ---------- reproductor modal (pieza completa, preload none hasta abrir) ---------- */
  (function () {
    var dlg = document.getElementById('player');
    if (!dlg || typeof dlg.showModal !== 'function') return; // sin <dialog>: el link abre el archivo directo
    var vid = dlg.querySelector('video'), tt = document.getElementById('player-title'), nt = document.getElementById('player-note'), fn = document.getElementById('player-fine');
    var closeBtn = dlg.querySelector('.player__x'), back = null, root = document.documentElement;
    function open(a) {
      back = a; tt.textContent = a.getAttribute('data-title') || '';
      nt.textContent = a.getAttribute('data-note') || '';
      var f = a.getAttribute('data-fine') || ''; fn.textContent = f; fn.hidden = !f;
      vid.src = a.getAttribute('data-full');
      root.classList.add('modal-open');
      [].forEach.call(document.querySelectorAll('video.loop'), function (v) { v.pause(); });
      dlg.showModal();
      var pr = vid.play(); if (pr && pr.catch) pr.catch(function () {}); // por si el navegador pide tocar play
    }
    function shut() { if (dlg.open) dlg.close(); }
    dlg.addEventListener('close', function () {
      vid.pause(); vid.removeAttribute('src'); vid.load(); // corta la descarga
      root.classList.remove('modal-open');
      [].forEach.call(document.querySelectorAll('video.loop'), function (v) { if (v.getBoundingClientRect().bottom > 0 && v.getBoundingClientRect().top < innerHeight && !reduce) { var pr = v.play(); if (pr && pr.catch) pr.catch(function () {}); } });
      if (back && back.focus) back.focus();
    });
    closeBtn.addEventListener('click', shut);
    dlg.addEventListener('click', function (e) { if (e.target === dlg) shut(); }); // tocar afuera
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[data-full]');
      if (!a) { var m = e.target.closest && e.target.closest('.work__media'); if (m) { var art = m.closest('.work'); a = art && art.querySelector('a[data-full]'); } }
      if (a) { e.preventDefault(); open(a); }
    });
  })();

  /* ---------- foco de luz que sigue al puntero en las puertas ---------- */
  [].forEach.call(document.querySelectorAll('.door'), function (d) {
    d.addEventListener('pointermove', function (e) {
      var r = d.getBoundingClientRect();
      d.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      d.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
  });

  /* =====================================================================
     VISUALES 2D (Canvas) : mocap, pose, atencion
     ===================================================================== */
  var viz2d = [];
  function setup2d(canvas, draw) {
    var ctx = canvas.getContext('2d');
    var o = { canvas: canvas, ctx: ctx, draw: draw, vis: false, w: 0, h: 0, dpr: 1, t0: performance.now() };
    function size() {
      var r = canvas.getBoundingClientRect();
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      o.w = Math.max(1, r.width); o.h = Math.max(1, r.height); o.dpr = dpr;
      canvas.width = Math.round(o.w * dpr); canvas.height = Math.round(o.h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paint(o, reduce ? 4.2 : (performance.now() - o.t0) / 1000);
    }
    if ('ResizeObserver' in window) new ResizeObserver(size).observe(canvas); else window.addEventListener('resize', size);
    onVisible(canvas, function (v) { o.vis = v; });
    size();
    viz2d.push(o);
  }
  function paint(o, t) { o.ctx.clearRect(0, 0, o.w, o.h); o.draw(o.ctx, o.w, o.h, t); }

  /* mocap: canal con ruido vs curva limpia */
  function drawMocap(c, w, h, t) {
    var pad = 18, lanes = 3, laneH = (h - pad * 2) / lanes;
    var N = 140, r = rng(7), noise = [];
    for (var i = 0; i < N * lanes; i++) noise.push((r() - .5));
    var head = (t * .22) % 1.15; // playhead normalizado
    var colors = ['#6db0ff', '#9fd0ff', '#5ff2c8'];
    c.lineJoin = 'round'; c.lineCap = 'round';
    for (var L = 0; L < lanes; L++) {
      var cy = pad + laneH * (L + .5), amp = laneH * .34;
      c.strokeStyle = 'rgba(255,255,255,.07)'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(pad, cy); c.lineTo(w - pad, cy); c.stroke();
      function base(u) { return Math.sin(u * 6.28 * (1.2 + L * .55) + L) * .75 + Math.sin(u * 6.28 * 3.1 + L * 2) * .22; }
      // cruda
      c.strokeStyle = 'rgba(255,255,255,.28)'; c.lineWidth = 1;
      c.beginPath();
      for (var k = 0; k < N; k++) { var u = k / (N - 1); var x = pad + u * (w - pad * 2); var y = cy - (base(u) + noise[L * N + k] * .55) * amp; if (!k) c.moveTo(x, y); else c.lineTo(x, y); }
      c.stroke();
      // limpia (hasta el playhead)
      c.strokeStyle = colors[L]; c.lineWidth = 2.2; c.shadowColor = colors[L]; c.shadowBlur = 8;
      c.beginPath(); var started = false;
      for (var k2 = 0; k2 < N; k2++) { var u2 = k2 / (N - 1); if (u2 > head) break; var x2 = pad + u2 * (w - pad * 2); var y2 = cy - base(u2) * amp; if (!started) { c.moveTo(x2, y2); started = true; } else c.lineTo(x2, y2); }
      c.stroke(); c.shadowBlur = 0;
      // keyframes
      c.fillStyle = colors[L];
      for (var q = 0; q < 9; q++) { var uq = q / 8; if (uq > head) break; var xq = pad + uq * (w - pad * 2); c.beginPath(); c.arc(xq, cy - base(uq) * amp, 2.6, 0, 6.283); c.fill(); }
    }
    // playhead
    var px = pad + Math.min(head, 1) * (w - pad * 2);
    c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(px, pad - 6); c.lineTo(px, h - pad + 6); c.stroke();
    c.fillStyle = '#fff'; c.beginPath(); c.moveTo(px - 5, pad - 8); c.lineTo(px + 5, pad - 8); c.lineTo(px, pad - 1); c.fill();
    c.font = '500 10px "JetBrains Mono",monospace'; c.fillStyle = 'rgba(255,255,255,.5)';
    c.fillText('RAW', pad, h - 5); c.fillStyle = '#6db0ff'; c.fillText('CLEAN', pad + 36, h - 5);
  }

  /* pose: persona de palitos que cae y el detector la marca */
  function drawPose(c, w, h, t) {
    var cyc = 7.2, p = (t % cyc) / cyc; // 0..1
    // fases: 0-.35 parada, .35-.55 cae, .55-.88 en el piso, .88-1 se reinicia (fade)
    var fall = clamp((p - .35) / .2, 0, 1); fall = ease(fall);
    var fade = p > .9 ? 1 - (p - .9) / .1 : 1;
    var floor = h * .78, s = Math.min(h * .0034, w * .0042); // escala
    c.strokeStyle = 'rgba(255,255,255,.18)'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(14, floor); c.lineTo(w - 14, floor); c.stroke();
    for (var gx = 24; gx < w - 14; gx += 26) { c.beginPath(); c.moveTo(gx, floor); c.lineTo(gx - 10, floor + 12); c.stroke(); }
    var ang = fall * 1.46; // 0 = vertical, ~84 grados
    var cx = w * .5 - 85 * s * fall, feetX = cx - Math.sin(ang) * 0 , feetY = floor;
    // juntas: pies fijos al inicio; el cuerpo rota alrededor de los pies y baja
    function rot(px, py, a, ox, oy) { var dx = px, dy = py; return [ox + dx * Math.cos(a) - dy * Math.sin(a), oy + dx * Math.sin(a) + dy * Math.cos(a)]; }
    var sway = Math.sin(t * 3) * (1 - fall) * .03;
    var A = ang + sway;
    var fx = cx, fy = feetY;
    var j = {}; // coordenadas en espacio local y=-arriba, rotado por A alrededor de los pies
    var L = { hip: [0, -82], neck: [0, -150], head: [0, -170], lSh: [-16, -146], rSh: [16, -146], lEl: [-28, -112], rEl: [28, -112], lHa: [-24, -84], rHa: [24, -84], lKn: [-8, -42], rKn: [8, -42], lFt: [-14, 0], rFt: [14, 0] };
    var spread = fall * 24;
    L.lHa = [-24 - spread * .6, -84 - spread * .6]; L.rHa = [24 + spread, -96 + spread * .4];
    L.lKn = [-8 - spread * .4, -42]; L.rKn = [10 + spread * .3, -40];
    L.lFt = [-14 - spread * .6, 0]; L.rFt = [14 + spread * .4, 0];
    var k;
    for (k in L) { var q = rot(L[k][0] * s, L[k][1] * s, A, fx, fy); j[k] = q; }
    // el cuerpo rota hacia adelante sobre los pies, pero una vez en el piso se apoya: ajustar y para que no atraviese
    var minY = Infinity; for (k in j) if (j[k][1] > fy) j[k][1] = fy - (j[k][1] - fy) * .1;
    var bones = [['neck', 'head'], ['lSh', 'rSh'], ['neck', 'hip'], ['lSh', 'lEl'], ['lEl', 'lHa'], ['rSh', 'rEl'], ['rEl', 'rHa'], ['hip', 'lKn'], ['lKn', 'lFt'], ['hip', 'rKn'], ['rKn', 'rFt']];
    var alert = fall > .75;
    var col = alert ? '#ff6b57' : '#5ff2c8';
    c.globalAlpha = fade; c.lineCap = 'round';
    c.strokeStyle = col; c.lineWidth = 3; c.shadowColor = col; c.shadowBlur = 10;
    bones.forEach(function (b) { c.beginPath(); c.moveTo(j[b[0]][0], j[b[0]][1]); c.lineTo(j[b[1]][0], j[b[1]][1]); c.stroke(); });
    c.shadowBlur = 0;
    c.fillStyle = '#fff';
    for (k in j) { c.beginPath(); c.arc(j[k][0], j[k][1], 3.4, 0, 6.283); c.fill(); }
    c.beginPath(); c.arc(j.head[0], j.head[1], 11 * s * 2.4, 0, 6.283); c.strokeStyle = col; c.lineWidth = 2; c.stroke();
    // caja del detector
    var minX = 1e9, maxX = -1e9, minYb = 1e9, maxY = -1e9;
    for (k in j) { minX = Math.min(minX, j[k][0]); maxX = Math.max(maxX, j[k][0]); minYb = Math.min(minYb, j[k][1]); maxY = Math.max(maxY, j[k][1]); }
    var bp = 16; c.strokeStyle = col; c.lineWidth = 1.5; c.setLineDash([6, 4]);
    c.strokeRect(minX - bp, minYb - bp - 10, maxX - minX + bp * 2, maxY - minYb + bp * 2 + 10); c.setLineDash([]);
    c.font = '500 11px "JetBrains Mono",monospace'; var label = alert ? 'POSE: FALL' : 'POSE: UPRIGHT';
    var lw = c.measureText(label).width + 14, lx = minX - bp, ly = minYb - bp - 10 - 20;
    c.fillStyle = col; c.fillRect(lx, ly, lw, 18); c.fillStyle = '#05070b'; c.fillText(label, lx + 7, ly + 13);
    c.globalAlpha = 1;
  }

  /* atencion: densa vs dispersa */
  function drawAttn(c, w, h, t) {
    var n = 28, gap = 24, side = Math.min((w - gap * 3) / 2, h - 34);
    side = Math.max(side, 40);
    var y0 = (h - side) / 2 - 6, xs = [w / 2 - side - gap / 2, w / 2 + gap / 2];
    var cell = side / n, q = Math.floor((t * 5) % n); // fila consulta
    for (var m = 0; m < 2; m++) {
      var x0 = xs[m];
      for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) {
        if (j > i) continue; // causal
        var keep = m === 0 ? true : (i - j < 4 || j % 7 === 0 || j < 2);
        var hot = i === q;
        var a;
        if (m === 0) a = hot ? .95 : .28 + .0;
        else a = keep ? (hot ? .98 : .55) : 0.04;
        c.fillStyle = m === 0 ? 'rgba(109,176,255,' + a + ')' : 'rgba(95,242,200,' + a + ')';
        c.fillRect(x0 + j * cell + .5, y0 + i * cell + .5, cell - 1, cell - 1);
      }
      c.font = '500 10px "JetBrains Mono",monospace'; c.fillStyle = 'rgba(255,255,255,.65)';
      c.fillText(m === 0 ? 'DENSE: every pair' : 'SPARSE: only what matters', x0, y0 + side + 16);
    }
  }

  /* =====================================================================
     WEBGL compartido
     ===================================================================== */
  var THREE = window.THREE;
  var glReady = false;

  function startGL() {
    var slotsEls = [].slice.call(document.querySelectorAll('canvas.slot'));
    var renderer;
    try {
      var test = document.createElement('canvas');
      if (!(test.getContext('webgl2') || test.getContext('webgl'))) throw new Error('sin webgl');
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch (e) { console.info('[deinorus] WebGL no disponible, uso fallback estatico'); return; }
    renderer.setClearColor(0x000000, 0);
    var gl = renderer.domElement;
    var DPR = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(DPR);

    var glow = (function () { // sprite de brillo
      var c = document.createElement('canvas'); c.width = c.height = 64; var x = c.getContext('2d');
      var g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.25, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, 64, 64); var t = new THREE.CanvasTexture(c); return t;
    })();

    /* --- shaders --- */
    var pointsVS = 'attribute float aSize; attribute float aAlpha; attribute vec3 aColor; uniform float uScale; varying float vA; varying vec3 vC;' +
      'void main(){ vA=aAlpha; vC=aColor; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=aSize*uScale/(-mv.z); gl_Position=projectionMatrix*mv; }';
    var pointsFS = 'uniform sampler2D uMap; varying float vA; varying vec3 vC; void main(){ vec4 t=texture2D(uMap,gl_PointCoord); gl_FragColor=vec4(vC,1.0)*vec4(1.0,1.0,1.0,t.a*vA); gl_FragColor.rgb*= (0.55+0.9*t.r); }';
    function makePoints(n) {
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(n), 1));
      g.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(n), 1));
      g.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      var m = new THREE.ShaderMaterial({ vertexShader: pointsVS, fragmentShader: pointsFS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uMap: { value: glow }, uScale: { value: 300 } } });
      var p = new THREE.Points(g, m); p.frustumCulled = false; return p;
    }
    var floorVS = 'varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }';
    var floorFS = 'varying vec3 vP; uniform float uOff; uniform vec3 uColor; uniform float uRad;' +
      'void main(){ vec2 p=vec2(vP.x, vP.y - uOff); vec2 g=abs(fract(p/0.5-0.5)-0.5)/(fwidth(p/0.5)); float l=1.0-min(min(g.x,g.y),1.0);' +
      'float d=length(vP.xy); float fade=smoothstep(uRad,0.0,d); gl_FragColor=vec4(uColor,l*fade*0.55); }';
    function makeFloor(color, rad) {
      var m = new THREE.ShaderMaterial({ vertexShader: floorVS, fragmentShader: floorFS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uOff: { value: 0 }, uColor: { value: new THREE.Color(color) }, uRad: { value: rad } }, extensions: { derivatives: true } });
      var f = new THREE.Mesh(new THREE.PlaneGeometry(rad * 2.2, rad * 2.2), m); f.rotation.x = -Math.PI / 2; return f;
    }

    /* ---------------- escena STUDIO : esqueleto mocap caminando ---------------- */
    function sceneStudio() {
      var scene = new THREE.Scene();
      var cam = new THREE.PerspectiveCamera(34, 1, .1, 60); cam.position.set(3.4, 1.45, 5.4); cam.lookAt(0, .95, 0);
      var floor = makeFloor(BLUE, 5.5); floor.position.y = 0;
      var boneMat = new THREE.MeshStandardMaterial({ color: 0x2f8cff, emissive: 0x0a3a80, roughness: .35, metalness: .2, flatShading: true });
      var jointMat = new THREE.MeshBasicMaterial({ color: 0xe8f2ff });
      scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x06080c, 1.1));
      var d1 = new THREE.DirectionalLight(0xffffff, 1.2); d1.position.set(3, 4, 4); scene.add(d1);
      var d2 = new THREE.DirectionalLight(0x2f8cff, 1.4); d2.position.set(-4, 2, -3); scene.add(d2);

      var fig = new THREE.Group(); scene.add(fig); fig.add(floor);
      function limb(parent, len, rad, rad2) {
        var piv = new THREE.Group(); parent.add(piv);
        var m = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad2 || rad * .75, len, 6, 1), boneMat); m.position.y = -len / 2; piv.add(m);
        var end = new THREE.Group(); end.position.y = -len; piv.add(end);
        var jm = new THREE.Mesh(new THREE.IcosahedronGeometry(rad * 1.25, 0), jointMat); end.add(jm);
        return { piv: piv, end: end };
      }
      var hip = new THREE.Group(); hip.position.y = .98; fig.add(hip);
      var pelvis = new THREE.Mesh(new THREE.IcosahedronGeometry(.13, 0), jointMat); hip.add(pelvis);
      var spine = new THREE.Group(); hip.add(spine);
      var torso = new THREE.Mesh(new THREE.CylinderGeometry(.11, .15, .56, 6), boneMat); torso.position.y = .3; spine.add(torso);
      var chest = new THREE.Group(); chest.position.y = .58; spine.add(chest);
      var neck = new THREE.Mesh(new THREE.CylinderGeometry(.04, .05, .14, 6), boneMat); neck.position.y = .08; chest.add(neck);
      var head = new THREE.Mesh(new THREE.IcosahedronGeometry(.13, 1), new THREE.MeshStandardMaterial({ color: 0xe8f2ff, emissive: 0x1a4a8a, roughness: .4, flatShading: true })); head.position.y = .28; chest.add(head);
      var sh = new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, .42, 6), boneMat); sh.rotation.z = Math.PI / 2; chest.add(sh);
      var arms = [-1, 1].map(function (s) { var a = limb(chest, .3, .035); a.piv.position.x = s * .21; var f = limb(a.end, .28, .03); return { u: a, f: f, s: s }; });
      var legs = [-1, 1].map(function (s) { var a = limb(hip, .48, .06); a.piv.position.x = s * .1; var f = limb(a.end, .48, .05); var foot = new THREE.Mesh(new THREE.BoxGeometry(.09, .05, .22), boneMat); foot.position.set(0, -.02, .07); f.end.add(foot); return { u: a, f: f, s: s }; });

      // marcadores de mocap (brillos) en las juntas
      var markers = makePoints(14); scene.add(markers);
      var trailN = 56, trails = [];
      var trailTargets = [arms[0].f.end, arms[1].f.end, legs[0].f.end, legs[1].f.end];
      trailTargets.forEach(function (tg, i) {
        var geo = new THREE.BufferGeometry(); var pos = new Float32Array(trailN * 3), col = new Float32Array(trailN * 3);
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        var ln = new THREE.Line(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        ln.frustumCulled = false; scene.add(ln); trails.push({ pts: [], geo: geo, tg: tg, line: ln });
      });
      var v = new THREE.Vector3(), phase = 0, speed = 1.0, lastT = 0, GS = 1.6, backDir = new THREE.Vector3(0, 0, -1), yAxis = new THREE.Vector3(0, 1, 0);
      function pose(ph) {
        legs.forEach(function (L, i) {
          var p = ph + (i ? Math.PI : 0);
          L.u.piv.rotation.x = -.62 * Math.sin(p);
          L.f.piv.rotation.x = .08 + .85 * Math.max(0, Math.sin(p + 1.7)) * (Math.cos(p) > -.4 ? 1 : .6);
        });
        arms.forEach(function (A, i) {
          var p = ph + (i ? 0 : Math.PI);
          A.u.piv.rotation.x = -.5 * Math.sin(p); A.f.piv.rotation.x = -.35 - .25 * (Math.sin(p) + 1) * .5;
          A.u.piv.rotation.z = A.s * .08;
        });
        hip.position.y = .98 - .035 * Math.abs(Math.sin(ph)) * 1.0;
        hip.rotation.y = .12 * Math.sin(ph); spine.rotation.y = -.16 * Math.sin(ph); spine.rotation.z = .03 * Math.sin(ph * 2);
      }
      var mp = markers.geometry.attributes;
      var mk = [pelvis, head, sh].concat(arms.map(function (a) { return a.u.end; }), arms.map(function (a) { return a.f.end; }), legs.map(function (l) { return l.u.end; }), legs.map(function (l) { return l.f.end; }));
      var tmp = new THREE.Vector3(), c1 = new THREE.Color(0x9fd0ff);
      function update(t, slot) {
        var dt = Math.min(.05, t - lastT); lastT = t;
        var boost = slot.hover ? 1.35 : 1; speed += (boost - speed) * .06;
        phase += dt * 4.2 * speed; pose(phase);
        floor.material.uniforms.uOff.value += dt * GS * speed;
        fig.rotation.y = (wide() ? .95 : 1.05) + .2 * Math.sin(t * .25);
        backDir.set(0, 0, -1).applyAxisAngle(yAxis, fig.rotation.y); fig.updateMatrixWorld(true);
        // marcadores
        for (var i = 0; i < mk.length && i < 14; i++) { mk[i].getWorldPosition(tmp); mp.position.setXYZ(i, tmp.x, tmp.y, tmp.z); mp.aSize.setX(i, i < 3 ? .3 : .24); mp.aAlpha.setX(i, .9); mp.aColor.setXYZ(i, c1.r, c1.g, c1.b); }
        mp.position.needsUpdate = mp.aSize.needsUpdate = mp.aAlpha.needsUpdate = mp.aColor.needsUpdate = true;
        // estelas: puntos en espacio de mundo que se corren hacia atras (cinta)
        trails.forEach(function (T) {
          T.pts.forEach(function (p) { p.addScaledVector(backDir, dt * GS * speed); });
          T.tg.getWorldPosition(v); T.pts.unshift(v.clone()); if (T.pts.length > trailN) T.pts.pop();
          var pos = T.geo.attributes.position, col = T.geo.attributes.color;
          for (var k = 0; k < trailN; k++) { var p = T.pts[Math.min(k, T.pts.length - 1)]; pos.setXYZ(k, p.x, p.y, p.z); var f = Math.pow(1 - k / trailN, 2); col.setXYZ(k, .18 * f, .55 * f, 1 * f); }
          pos.needsUpdate = col.needsUpdate = true;
        });
      }
            return { scene: scene, cam: cam, update: update, offset: function (w, h) { return wide() ? [0, h * .09] : [-w * .2, h * .02]; }, pts: markers };
    }

    /* ---------------- escena LAB : red neuronal con pulsos ---------------- */
    function sceneLab() {
      var scene = new THREE.Scene();
      var cam = new THREE.PerspectiveCamera(36, 1, .1, 60); cam.position.set(0, .4, 9.6); cam.lookAt(0, 0, 0);
      var layers = [5, 7, 8, 7, 4], r = rng(21), nodes = [], layerNodes = [];
      var gx = 4.6;
      layers.forEach(function (n, li) {
        var arr = [];
        for (var i = 0; i < n; i++) {
          var y = (i - (n - 1) / 2) * (1.55 - li * .02) + (r() - .5) * .35;
          var z = (r() - .5) * 2.2;
          var node = { p: new THREE.Vector3(lerp(-gx, gx, li / (layers.length - 1)), y * .78, z), l: li, ph: r() * 6.28 };
          nodes.push(node); arr.push(node);
        }
        layerNodes.push(arr);
      });
      var edges = [];
      for (var li = 0; li < layerNodes.length - 1; li++) layerNodes[li].forEach(function (a) {
        var tgt = layerNodes[li + 1].slice().sort(function () { return r() - .5; }).slice(0, 2 + (r() > .6 ? 1 : 0));
        tgt.forEach(function (b) { edges.push([a, b]); });
      });
      var ep = new Float32Array(edges.length * 6);
      edges.forEach(function (e, i) { ep.set([e[0].p.x, e[0].p.y, e[0].p.z, e[1].p.x, e[1].p.y, e[1].p.z], i * 6); });
      var eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.BufferAttribute(ep, 3));
      var lines = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0x5ff2c8, transparent: true, opacity: .24, blending: THREE.AdditiveBlending, depthWrite: false }));
      var grp = new THREE.Group(); grp.add(lines); scene.add(grp);
      var np = makePoints(nodes.length); grp.add(np);
      var NP = 46, pulses = makePoints(NP); grp.add(pulses);
      var pulseData = []; for (var i = 0; i < NP; i++) pulseData.push({ e: Math.floor(r() * edges.length), t: r(), s: .35 + r() * .5 });
      var green = new THREE.Color(MINT), white = new THREE.Color(0xe6fff8);
      var na = np.geometry.attributes, pa = pulses.geometry.attributes;
      nodes.forEach(function (n, i) { na.position.setXYZ(i, n.p.x, n.p.y, n.p.z); na.aColor.setXYZ(i, green.r, green.g, green.b); });
      na.position.needsUpdate = true;
      var last = 0, act = 0;
      function update(t, slot) {
        var dt = Math.min(.05, t - last); last = t; var boost = slot.hover ? 2.1 : 1; act += (boost - act) * .08 || 0;
        grp.rotation.y = Math.sin(t * .22) * .42 + (wide() ? 0 : -.3);
        grp.rotation.x = .12 * Math.sin(t * .17);
        nodes.forEach(function (n, i) { var a = .5 + .5 * Math.sin(t * 1.6 + n.ph); na.aSize.setX(i, .34 + .16 * a); na.aAlpha.setX(i, .7 + .3 * a); });
        na.aSize.needsUpdate = na.aAlpha.needsUpdate = true;
        pulseData.forEach(function (p, i) {
          p.t += dt * p.s * boost; if (p.t >= 1) { p.t = 0; var cur = edges[p.e][1]; var nxt = []; edges.forEach(function (e, k) { if (e[0] === cur) nxt.push(k); }); p.e = nxt.length ? nxt[Math.floor(Math.random() * nxt.length)] : Math.floor(r() * edges.length); }
          var e = edges[p.e]; pa.position.setXYZ(i, lerp(e[0].p.x, e[1].p.x, p.t), lerp(e[0].p.y, e[1].p.y, p.t), lerp(e[0].p.z, e[1].p.z, p.t));
          pa.aSize.setX(i, .42); pa.aAlpha.setX(i, Math.sin(p.t * 3.14159)); pa.aColor.setXYZ(i, white.r, white.g, white.b);
        });
        pa.position.needsUpdate = pa.aSize.needsUpdate = pa.aAlpha.needsUpdate = pa.aColor.needsUpdate = true;
      }
      return { scene: scene, cam: cam, update: update, offset: function (w, h) { return wide() ? [0, 0] : [-w * .2, 0]; } };
    }

    /* ---------------- escena CREATURA : personaje estilizado interactivo ---------------- */
    function sceneCreature() {
      var scene = new THREE.Scene();
      var cam = new THREE.PerspectiveCamera(32, 1, .1, 60); cam.position.set(0, 1.6, 6.6); cam.lookAt(0, 1.05, 0);
      scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x0b0f18, 1.0));
      var key = new THREE.DirectionalLight(0xffffff, 1.25); key.position.set(3, 5, 4); scene.add(key);
      var rim = new THREE.DirectionalLight(0x2f8cff, 2.0); rim.position.set(-4, 2.5, -3); scene.add(rim);
      var fill = new THREE.DirectionalLight(0x5ff2c8, .45); fill.position.set(4, 1, -2); scene.add(fill);
      function mat(c, e, rough) { return new THREE.MeshStandardMaterial({ color: c, emissive: e || 0x000000, roughness: rough == null ? .5 : rough, metalness: .05, flatShading: true }); }
      var skin = mat(0x8ea6c8, 0x0a1426), belly = mat(0xdde7f4, 0x101c30), blue = mat(0x2f8cff, 0x0f3d85, .35), dark = mat(0x0a0d14, 0x000000, .3), white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .2, emissive: 0x222a38 });

      var root = new THREE.Group(); scene.add(root);
      var ring = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.56, 64), new THREE.MeshBasicMaterial({ color: BLUE, transparent: true, opacity: .75, side: THREE.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.position.y = .01; scene.add(ring);
      var ring2 = new THREE.Mesh(new THREE.RingGeometry(1.95, 1.97, 64), new THREE.MeshBasicMaterial({ color: BLUE, transparent: true, opacity: .3, side: THREE.DoubleSide })); ring2.rotation.x = -Math.PI / 2; ring2.position.y = .01; scene.add(ring2);
      var floor = makeFloor(BLUE, 4.2); floor.position.y = 0; scene.add(floor);

      function ico(r, d, sx, sy, sz, m, x, y, z, parent) { var o = new THREE.Mesh(new THREE.IcosahedronGeometry(r, d), m); o.scale.set(sx, sy, sz); o.position.set(x, y, z); (parent || root).add(o); return o; }
      var body = ico(.72, 1, 1, .92, 1.25, skin, 0, .95, -.05);
      ico(.6, 1, .8, .85, 1.1, belly, 0, .82, .22);
      // cuello + cabeza
      var neck = ico(.34, 1, 1, 1.5, 1, skin, 0, 1.55, .55); neck.rotation.x = .5;
      var headG = new THREE.Group(); headG.position.set(0, 2.0, .8); root.add(headG);
      ico(.5, 1, 1, .9, 1.05, skin, 0, 0, 0, headG);
      ico(.34, 1, .9, .68, 1.25, skin, 0, -.1, .46, headG);      // hocico
      ico(.3, 1, .9, .4, 1.15, belly, 0, -.27, .42, headG);      // mandibula
      ico(.05, 0, 1, 1, 1, dark, -.12, -.02, .86, headG); ico(.05, 0, 1, 1, 1, dark, .12, -.02, .86, headG);   // fosas
      var eyes = [-1, 1].map(function (s) {
        var g = new THREE.Group(); g.position.set(s * .27, .2, .38); headG.add(g);
        ico(.17, 1, 1, 1, 1, white, 0, 0, 0, g); var pu = ico(.09, 1, 1, 1, 1, dark, s * -.01, 0, .13, g); ico(.03, 0, 1, 1, 1, white, .035, .035, .2, g);
        return g;
      });
      [-1, 1].forEach(function (s) { ico(.12, 0, 1, 1.4, .6, blue, s * .22, .5, -.05, headG); }); // crestas
      // placas de la espalda
      var plates = [];
      for (var i = 0; i < 6; i++) {
        var cone = new THREE.Mesh(new THREE.ConeGeometry(.17 - i * .014, .42 - i * .03, 4), blue);
        var u = i / 5; cone.position.set(0, 1.58 - u * .75 + (i === 0 ? .0 : 0), .35 - u * 1.3); cone.rotation.x = -.35 - u * .6; root.add(cone); plates.push(cone);
      }
      // cola
      var tail = []; var tp = root;
      var tg = new THREE.Group(); tg.position.set(0, .85, -.95); root.add(tg); var par = tg;
      for (var k = 0; k < 6; k++) {
        var seg = new THREE.Group(); seg.position.z = k === 0 ? 0 : -.38 + k * .02; par.add(seg);
        ico(.46 - k * .06, 1, .9, .9, 1.1, skin, 0, 0, -.1, seg); tail.push(seg); par = seg;
        if (k > 0 && k < 5) { var pc = new THREE.Mesh(new THREE.ConeGeometry(.1, .25, 4), blue); pc.position.set(0, .3 - k * .04, -.05); pc.rotation.x = -.5; seg.add(pc); }
      }
      // patas y brazos
      var feet = [-1, 1].map(function (s) {
        var g = new THREE.Group(); g.position.set(s * .5, .55, .1); root.add(g);
        var thigh = ico(.34, 1, .9, 1.4, 1, skin, 0, 0, 0, g); var foot = ico(.3, 1, 1, .45, 1.5, belly, 0, -.42, .17, g);
        return g;
      });
      var arms = [-1, 1].map(function (s) {
        var g = new THREE.Group(); g.position.set(s * .66, 1.1, .45); root.add(g);
        ico(.15, 1, 1, 1.6, 1, skin, s * .06, -.1, .1, g).rotation.x = -.6; ico(.08, 0, 1, 1, 1, white, s * .06, -.28, .27, g);
        return g;
      });

      var yaw = 0.5, vel = 0, drag = false, lastX = 0, px = 0, py = 0, blink = 0, nextBlink = 2, lastT = 0, touched = false;
      var el = null;
      function bind(canvas) {
        el = canvas;
        canvas.addEventListener('pointerdown', function (e) { drag = true; touched = true; lastX = e.clientX; try { canvas.setPointerCapture(e.pointerId); } catch (x) {} });
        canvas.addEventListener('pointermove', function (e) {
          var r = canvas.getBoundingClientRect(); px = ((e.clientX - r.left) / r.width) * 2 - 1; py = ((e.clientY - r.top) / r.height) * 2 - 1;
          if (drag) { var dx = e.clientX - lastX; lastX = e.clientX; yaw += dx * .011; vel = dx * .011; if (reduce) requestRender(); }
        });
        function up() { drag = false; }
        canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
        canvas.addEventListener('pointerleave', function () { px = 0; py = 0; });
        canvas.setAttribute('tabindex', '0');
        canvas.addEventListener('keydown', function (e) { if (e.key === 'ArrowLeft') { yaw -= .25; if (reduce) requestRender(); } if (e.key === 'ArrowRight') { yaw += .25; if (reduce) requestRender(); } });
      }
      function update(t) {
        var dt = Math.min(.05, t - lastT); lastT = t;
        if (!drag) { vel *= .94; yaw += vel * .35 + (touched ? .0015 : .004); }
        root.rotation.y = yaw; ring.rotation.z = yaw; ring2.rotation.z = -yaw * .6;
        var br = Math.sin(t * 1.9); body.scale.y = .92 + .018 * br; headG.position.y = 2.0 + .02 * br;
        headG.rotation.y = lerp(headG.rotation.y, px * .5, .08); headG.rotation.x = lerp(headG.rotation.x, py * .25, .08);
        tail.forEach(function (s, i) { s.rotation.y = Math.sin(t * 1.5 - i * .55) * .17; s.rotation.x = .1; });
        nextBlink -= dt; if (nextBlink < 0) { blink = .14; nextBlink = 2 + Math.random() * 3; }
        blink = Math.max(0, blink - dt); var sc = blink > 0 ? .1 : 1; eyes.forEach(function (e) { e.scale.y = sc; });
        arms.forEach(function (a, i) { a.rotation.x = .1 * Math.sin(t * 1.9 + i); });
      }
      return { scene: scene, cam: cam, update: update, bind: bind, offset: function () { return [0, 0]; }, yMax: 1 };
    }

    /* ---------------- gestor de slots ---------------- */
    var slots = [], maxW = 0, maxH = 0, running = false, rafId = 0, t0 = performance.now();
    var factories = { studio: sceneStudio, lab: sceneLab, creature: sceneCreature };
    var pending = false;
    function requestRender() { if (pending) return; pending = true; requestAnimationFrame(function () { pending = false; frame(performance.now(), true); }); }
    window.__reqRender = requestRender;

    slotsEls.forEach(function (c) {
      var kind = c.getAttribute('data-scene'); if (!factories[kind]) return;
      var sc = factories[kind]();
      var s = { el: c, ctx: c.getContext('2d'), sc: sc, vis: false, w: 0, h: 0, hover: false, kind: kind };
      if (sc.bind) sc.bind(c);
      var host = c.closest('.door');
      if (host) { host.addEventListener('pointerenter', function () { s.hover = true; }); host.addEventListener('pointerleave', function () { s.hover = false; }); host.addEventListener('focus', function () { s.hover = true; }); host.addEventListener('blur', function () { s.hover = false; }); }
      function size() {
        var r = c.getBoundingClientRect(); s.w = Math.max(2, Math.floor(r.width)); s.h = Math.max(2, Math.floor(r.height));
        c.width = Math.floor(s.w * DPR); c.height = Math.floor(s.h * DPR);
        sc.cam.aspect = s.w / s.h;
        var o = sc.offset(s.w, s.h); sc.cam.setViewOffset(s.w, s.h, o[0], o[1], s.w, s.h); sc.cam.updateProjectionMatrix();
        // ajustar encuadre para pantallas anchas o angostas
        if (kind === 'creature') { var a = s.w / s.h; sc.cam.position.z = a < .9 ? 8.4 : 6.9 - Math.min(a, 2) * .3; }
        if (kind === 'studio' || kind === 'lab') { var a2 = s.w / s.h; var base = kind === 'studio' ? 4.7 : 9.6; var f = a2 < 1.2 ? 1.25 : (a2 > 2 ? .95 : 1); sc.cam.position.z = base * f; if (kind === 'studio') sc.cam.position.x = 3.0 * f; }
        sc.cam.updateProjectionMatrix();
        recalcMax();
        if (!running) requestRender();
      }
      if ('ResizeObserver' in window) new ResizeObserver(size).observe(c); else window.addEventListener('resize', size);
      onVisible(c, function (v) { s.vis = v; if (v) start(); });
      slots.push(s); size();
    });
    function recalcMax() {
      maxW = 0; maxH = 0; slots.forEach(function (s) { maxW = Math.max(maxW, s.w); maxH = Math.max(maxH, s.h); });
      renderer.setSize(maxW, maxH, false);
    }
    var scaleU = 1;
    function frame(now, once) {
      var t = (now - t0) / 1000;
      var any = false;
      slots.forEach(function (s) {
        if (!s.vis && !once) return; any = true;
        var tt = reduce ? 3.2 : t;
        if (reduce && (s.kind === 'studio' || s.kind === 'lab')) { for (var w = 0; w < 36; w++) s.sc.update(1.1 + w * .05, s); } // calentar estelas/pulsos para el cuadro estatico
        s.sc.update(reduce ? (s.kind === 'creature' ? 3.2 : 3.0) : tt, s);
        // escala de puntos segun alto del viewport del slot
        scene_points_scale(s.sc.scene, s.h * DPR);
        renderer.setViewport(0, 0, s.w, s.h); renderer.setScissor(0, 0, s.w, s.h); renderer.setScissorTest(true);
        renderer.clear(); renderer.render(s.sc.scene, s.sc.cam);
        var sw = Math.floor(s.w * DPR), sh = Math.floor(s.h * DPR);
        s.ctx.clearRect(0, 0, s.el.width, s.el.height);
        s.ctx.drawImage(gl, 0, gl.height - sh, sw, sh, 0, 0, s.el.width, s.el.height);
      });
      return any;
    }
    function scene_points_scale(scene, hpx) {
      scene.traverse(function (o) { if (o.isPoints && o.material.uniforms && o.material.uniforms.uScale) o.material.uniforms.uScale.value = hpx * .9; });
    }
    function loop(now) {
      rafId = 0;
      if (document.hidden) { running = false; return; }
      var any = frame(now);
      if (any) { running = true; rafId = requestAnimationFrame(loop); } else running = false;
    }
    function start() { if (reduce) { requestRender(); return; } if (!rafId) { running = true; rafId = requestAnimationFrame(loop); } }
    document.addEventListener('visibilitychange', function () { if (!document.hidden) start(); });
    window.addEventListener('resize', function () { requestRender(); });
    glReady = slots.length > 0;
    if (glReady) { document.documentElement.classList.add('gl-on'); window.__glInfo = { ok: true, version: renderer.capabilities.isWebGL2 ? 'webgl2' : 'webgl1', slots: slots.length }; console.info('[deinorus] WebGL ok:', window.__glInfo.version, slots.length, 'slots'); }
    start();
  }

  /* ---------- arranque ---------- */
  function boot2d() {
    [].forEach.call(document.querySelectorAll('canvas.c2d'), function (c) {
      var k = c.getAttribute('data-viz');
      setup2d(c, k === 'mocap' ? drawMocap : k === 'pose' ? drawPose : drawAttn);
    });
    var last = 0;
    (function tick(now) {
      if (!reduce && !document.hidden) { viz2d.forEach(function (o) { if (o.vis) paint(o, (now - o.t0) / 1000); }); }
      requestAnimationFrame(tick);
    })(performance.now());
  }
  function go() {
    boot2d();
    if (THREE) { try { startGL(); } catch (e) { console.error('[deinorus] error GL', e); } } else console.info('[deinorus] Three.js no cargo, uso fallback estatico');
  }
  if (document.readyState === 'complete') go(); else window.addEventListener('load', go);
})();
