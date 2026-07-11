"use strict";

/* ==========================================================================
   Constantes físicas (idénticas al modelo Python original)
   ========================================================================== */
const C_SOUND = 343;
const RHO = 1.21;
const Z0 = RHO * C_SOUND;
const L = 1.0;

/* ==========================================================================
   Aritmética compleja mínima
   ========================================================================== */
function cAdd(a, b) { return { re: a.re + b.re, im: a.im + b.im }; }
function cSub(a, b) { return { re: a.re - b.re, im: a.im - b.im }; }
function cMul(a, b) { return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re }; }
function cAbs(a) { return Math.sqrt(a.re * a.re + a.im * a.im); }
function cAngle(a) { return Math.atan2(a.im, a.re); }

/* ==========================================================================
   Modelo físico del tubo (portado 1:1 desde tubo_kundt_streamlit.py,
   verificado numéricamente contra el original en 420 combinaciones de
   f/R/M/x — diferencia máxima ~1e-14, error de punto flotante).
   Gamma se calcula una sola vez por combinación (f,R,M) y se reutiliza,
   en vez de recalcularse en cada función como en el script original.
   ========================================================================== */
function reflexionCoeff(R, M, f) {
  const ZL = { re: R, im: 2 * Math.PI * f * M };
  const Z0c = { re: Z0, im: 0 };
  const num = cSub(ZL, Z0c);
  const den = cAdd(ZL, Z0c);
  const denom = den.re * den.re + den.im * den.im;
  return { re: (num.re * den.re + num.im * den.im) / denom, im: (num.im * den.re - num.re * den.im) / denom };
}

function kOf(f) { return 2 * Math.PI * f / C_SOUND; }
function expNegJKX(k, x) { return { re: Math.cos(k * x), im: -Math.sin(k * x) }; }
function expPosJKX(k, x) { return { re: Math.cos(k * x), im: Math.sin(k * x) }; }

function pComplexG(x, k, Gamma) {
  return cAdd(expNegJKX(k, x), cMul(Gamma, expPosJKX(k, x)));
}
function uComplexG(x, k, Gamma) {
  const diff = cSub(expNegJKX(k, x), cMul(Gamma, expPosJKX(k, x)));
  return cMul({ re: 0, im: -1 }, diff);
}
function pressureDbG(x, k, Gamma) { return 20 * Math.log10(cAbs(pComplexG(x, k, Gamma)) + 1e-12); }
function velocityAmpG(x, k, Gamma) { return cAbs(uComplexG(x, k, Gamma)); }
function particleDispG(x, k, Gamma) {
  const u = uComplexG(x, k, Gamma);
  return { normAmp: cAbs(u) / 2.0, phaseShifted: cAngle(u) - Math.PI / 2 };
}
// Presión instantánea real en el tiempo normalizado t (un ciclo = t:0→1),
// misma convención de fase que usa el desplazamiento de partículas.
function instantPressure(x, k, Gamma, t) {
  const rot = { re: Math.cos(2 * Math.PI * t), im: Math.sin(2 * Math.PI * t) };
  return cMul(pComplexG(x, k, Gamma), rot).re;
}

/* ==========================================================================
   Colormaps
   - "diverging": rojo/azul divergente (ColorBrewer RdBu), sobre presión
     instantánea con signo → respira con la animación.
   - "sequential": mapa de calor continuo tipo "turbo", sobre la envolvente
     |p(x)| → patrón estacionario de nodos/antinodos, no depende de t.
   ========================================================================== */
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function lerpStops(stops, t) {
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1];
    if (t >= a.p && t <= b.p) {
      const f = (t - a.p) / (b.p - a.p);
      const r = Math.round(a.c[0] + f * (b.c[0] - a.c[0]));
      const g = Math.round(a.c[1] + f * (b.c[1] - a.c[1]));
      const bl = Math.round(a.c[2] + f * (b.c[2] - a.c[2]));
      return `rgb(${r},${g},${bl})`;
    }
  }
  const last = stops[stops.length - 1].c;
  return `rgb(${last[0]},${last[1]},${last[2]})`;
}

const DIVERGING_STOPS = [
  { p: -1.0, c: [33, 102, 172] },
  { p: -0.5, c: [146, 197, 222] },
  { p: 0.0, c: [246, 246, 244] },
  { p: 0.5, c: [244, 165, 130] },
  { p: 1.0, c: [178, 24, 43] },
];
const SEQUENTIAL_STOPS = [
  { p: 0.00, c: [30, 20, 55] },
  { p: 0.22, c: [63, 88, 210] },
  { p: 0.46, c: [37, 176, 168] },
  { p: 0.68, c: [147, 205, 70] },
  { p: 0.86, c: [247, 197, 60] },
  { p: 1.00, c: [206, 66, 45] },
];

function colormapDiverging(v) { return lerpStops(DIVERGING_STOPS, clamp(v, -1, 1)); }
function colormapSequential(v) { return lerpStops(SEQUENTIAL_STOPS, clamp(v, 0, 1)); }

/* ==========================================================================
   Utilidades numéricas
   ========================================================================== */
function linspace(a, b, n) {
  const out = new Array(n);
  const step = (b - a) / (n - 1);
  for (let i = 0; i < n; i++) out[i] = a + step * i;
  return out;
}

function makeScale(domain, range) {
  const [d0, d1] = domain, [r0, r1] = range;
  return (v) => r0 + (v - d0) / (d1 - d0) * (r1 - r0);
}

// Equivalente aproximado a scipy.signal.find_peaks(-y, distance=minDist):
// toma mínimos locales estrictos y descarta los más débiles cuando quedan
// demasiado cerca de uno ya aceptado (se procesan del más profundo al menos profundo).
function findLocalMinimaWithDistance(arr, minDist) {
  const candidates = [];
  for (let i = 1; i < arr.length - 1; i++) {
    if (arr[i] < arr[i - 1] && arr[i] < arr[i + 1]) candidates.push({ idx: i, val: arr[i] });
  }
  candidates.sort((a, b) => a.val - b.val);
  const accepted = [];
  for (const cand of candidates) {
    if (accepted.every((a) => Math.abs(a.idx - cand.idx) >= minDist)) accepted.push(cand);
  }
  accepted.sort((a, b) => a.idx - b.idx);
  return accepted.map((a) => a.idx);
}

function fitCanvasToDisplaySize(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width: w, height: h };
}

/* ==========================================================================
   Estado
   ========================================================================== */
const state = {
  f: 200,
  R: 2000,
  M: 0.001,
  showNodes: false,
  colorMode: 'diverging', // 'diverging' | 'sequential'
  playing: false,
  time: 0,
};

let derived = null;
let rafId = null;

/* ==========================================================================
   Referencias DOM
   ========================================================================== */
const el = {
  tube: document.getElementById('tubeCanvas'),
  pressure: document.getElementById('pressureCanvas'),
  velocity: document.getElementById('velocityCanvas'),
  colorbar: document.getElementById('colorbarCanvas'),
  colorbarTop: document.getElementById('colorbarTop'),
  colorbarMid: document.getElementById('colorbarMid'),
  colorbarBottom: document.getElementById('colorbarBottom'),
  freqSlider: document.getElementById('freqSlider'),
  freqValue: document.getElementById('freqValue'),
  freqReadoutTop: document.getElementById('freqReadoutTop'),
  rSlider: document.getElementById('rSlider'),
  rValue: document.getElementById('rValue'),
  mSlider: document.getElementById('mSlider'),
  mValue: document.getElementById('mValue'),
  nodesCheckbox: document.getElementById('nodesCheckbox'),
  modeDiverging: document.getElementById('modeDiverging'),
  modeSequential: document.getElementById('modeSequential'),
  playBtn: document.getElementById('playBtn'),
  playIcon: document.getElementById('playIcon'),
  playLabel: document.getElementById('playLabel'),
  gammaReadout: document.getElementById('gammaReadout'),
  lambdaReadout: document.getElementById('lambdaReadout'),
};

/* ==========================================================================
   Recalculo de datos derivados (se ejecuta al mover un slider)
   ========================================================================== */
function recomputeDerived() {
  const { f, R, M } = state;
  const k = kOf(f);
  const Gamma = reflexionCoeff(R, M, f);

  const xCols = linspace(0.05, L - 0.05, 46);
  const yRows = linspace(-0.15, 0.15, 9);
  const amps = new Array(xCols.length);
  const phases = new Array(xCols.length);
  for (let i = 0; i < xCols.length; i++) {
    const d = particleDispG(xCols[i], k, Gamma);
    amps[i] = d.normAmp;
    phases[i] = d.phaseShifted;
  }

  const xPres = linspace(0, L, 300);
  const pressureDb = new Array(xPres.length);
  const velocityAmp = new Array(xPres.length);
  for (let i = 0; i < xPres.length; i++) {
    pressureDb[i] = pressureDbG(xPres[i], k, Gamma);
    velocityAmp[i] = velocityAmpG(xPres[i], k, Gamma);
  }

  const nodosX = state.showNodes
    ? findLocalMinimaWithDistance(pressureDb, 20).map((i) => xPres[i])
    : [];

  derived = {
    k, Gamma, xCols, yRows, amps, phases, xPres, pressureDb, velocityAmp, nodosX,
    gammaAbs: cAbs(Gamma), lambda: C_SOUND / f,
  };
}

/* ==========================================================================
   Render: vista del tubo (hero)
   ========================================================================== */
const AMP_FACTOR = 0.08;

function renderTube() {
  const { ctx, width: W, height: H } = fitCanvasToDisplaySize(el.tube);
  ctx.clearRect(0, 0, W, H);

  const padL = 18, padR = 18, padT = 22, padB = 22;
  const xScale = makeScale([-0.12, L + 0.12], [padL, W - padR]);
  const yScale = makeScale([-0.3, 0.3], [H - padB, padT]);

  const tubeTop = yScale(0.2);
  const tubeBottom = yScale(-0.2);
  const tubeX0 = xScale(0);
  const tubeX1 = xScale(L);

  // --- extremos: fuente (izq.) y muestra R,M (der.) ---
  ctx.fillStyle = '#0e1114';
  ctx.fillRect(xScale(-0.12), tubeTop - 4, tubeX0 - xScale(-0.12) + 2, tubeBottom - tubeTop + 8);
  ctx.fillStyle = '#3a4148';
  ctx.fillRect(tubeX1 - 1, tubeTop - 6, xScale(L + 0.12) - tubeX1 + 2, tubeBottom - tubeTop + 12);

  // --- gradiente de presión dentro del tubo ---
  const grad = ctx.createLinearGradient(tubeX0, 0, tubeX1, 0);
  const stops = 90;
  for (let i = 0; i <= stops; i++) {
    const t = i / stops;
    const xPhys = t * L;
    let norm, color;
    if (state.colorMode === 'diverging') {
      norm = clamp(instantPressure(xPhys, derived.k, derived.Gamma, state.time) / 2, -1, 1);
      color = colormapDiverging(norm);
    } else {
      norm = clamp(cAbs(pComplexG(xPhys, derived.k, derived.Gamma)) / 2, 0, 1);
      color = colormapSequential(norm);
    }
    grad.addColorStop(t, color);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(tubeX0, tubeTop, tubeX1 - tubeX0, tubeBottom - tubeTop);

  // --- sombreado cilíndrico (da sensación de tubo de vidrio/acrílico) ---
  const shade = ctx.createLinearGradient(0, tubeTop, 0, tubeBottom);
  shade.addColorStop(0.0, 'rgba(255,255,255,0.30)');
  shade.addColorStop(0.16, 'rgba(255,255,255,0.06)');
  shade.addColorStop(0.55, 'rgba(0,0,0,0)');
  shade.addColorStop(1.0, 'rgba(0,0,0,0.38)');
  ctx.fillStyle = shade;
  ctx.fillRect(tubeX0, tubeTop, tubeX1 - tubeX0, tubeBottom - tubeTop);

  // --- paredes del tubo ---
  ctx.strokeStyle = 'rgba(190,198,205,0.85)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(tubeX0 + 0.75, tubeTop + 0.75, tubeX1 - tubeX0 - 1.5, tubeBottom - tubeTop - 1.5);

  // --- nodos de presión ---
  if (state.showNodes) {
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(232,163,61,0.85)';
    ctx.lineWidth = 1;
    for (const xn of derived.nodosX) {
      const px = xScale(xn);
      ctx.beginPath();
      ctx.moveTo(px, tubeTop - 6);
      ctx.lineTo(px, tubeBottom + 6);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // --- partículas ---
  const { xCols, yRows, amps, phases } = derived;
  for (let c = 0; c < xCols.length; c++) {
    const disp = AMP_FACTOR * amps[c] * Math.cos(2 * Math.PI * state.time + phases[c]);
    const xPhys = xCols[c] + disp;
    const px = xScale(xPhys);

    let norm, color;
    if (state.colorMode === 'diverging') {
      norm = clamp(instantPressure(xPhys, derived.k, derived.Gamma, state.time) / 2, -1, 1);
      color = colormapDiverging(norm);
    } else {
      norm = clamp(cAbs(pComplexG(xPhys, derived.k, derived.Gamma)) / 2, 0, 1);
      color = colormapSequential(norm);
    }

    for (let r = 0; r < yRows.length; r++) {
      const py = yScale(yRows[r]);

      // halo/sombra: separa la partícula del fondo por luminancia, no por tono
      // (el cuerpo puede compartir color con el fondo en ese x; el halo no depende de eso)
      ctx.beginPath();
      ctx.arc(px + 0.6, py + 0.9, 4.4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(6,8,10,0.40)';
      ctx.fill();

      // cuerpo: color de presión (colormap)
      ctx.beginPath();
      ctx.arc(px, py, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 0.7;
      ctx.strokeStyle = 'rgba(6,8,10,0.55)';
      ctx.stroke();

      // brillo especular: aspecto "cuenta de vidrio", asegura lectura como objeto discreto
      ctx.beginPath();
      ctx.arc(px - 1.15, py - 1.25, 1.05, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fill();
    }
  }

  // --- etiquetas de extremos ---
  ctx.font = '11px "IBM Plex Mono", monospace';
  ctx.fillStyle = 'rgba(238,241,243,0.55)';
  ctx.textAlign = 'left';
  ctx.fillText('FUENTE', xScale(-0.12) + 6, tubeTop - 10);
  ctx.textAlign = 'right';
  ctx.fillText('MUESTRA (R, M)', xScale(L + 0.12) - 6, tubeTop - 10);
}

/* ==========================================================================
   Render: gráficos de presión (dB) y velocidad (normalizada)
   ========================================================================== */
function drawLineChart(canvas, { xData, yData, yDomain, lineColor, lineColorRgba, nodesX, yTickFmt }) {
  const { ctx, width: W, height: H } = fitCanvasToDisplaySize(canvas);
  ctx.clearRect(0, 0, W, H);

  const padL = 34, padR = 8, padT = 8, padB = 16;
  const xScale = makeScale([-0.12, L + 0.12], [padL, W - padR]);
  const yScale = makeScale(yDomain, [H - padB, padT]);

  ctx.strokeStyle = 'rgba(51,60,67,0.9)';
  ctx.lineWidth = 1;
  ctx.font = '10px "IBM Plex Mono", monospace';
  ctx.fillStyle = 'rgba(238,241,243,0.45)';
  ctx.textAlign = 'right';
  const nTicks = 4;
  for (let i = 0; i <= nTicks; i++) {
    const yv = yDomain[0] + (yDomain[1] - yDomain[0]) * (i / nTicks);
    const py = yScale(yv);
    ctx.beginPath();
    ctx.moveTo(padL, py);
    ctx.lineTo(W - padR, py);
    ctx.stroke();
    ctx.fillText(yTickFmt(yv), padL - 6, py + 3);
  }

  if (nodesX && nodesX.length) {
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = 'rgba(232,163,61,0.6)';
    for (const xn of nodesX) {
      const px = xScale(xn);
      ctx.beginPath();
      ctx.moveTo(px, padT);
      ctx.lineTo(px, H - padB);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  ctx.beginPath();
  for (let i = 0; i < xData.length; i++) {
    const px = xScale(xData[i]);
    const py = yScale(clamp(yData[i], yDomain[0], yDomain[1]));
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.lineTo(xScale(xData[xData.length - 1]), H - padB);
  ctx.lineTo(xScale(xData[0]), H - padB);
  ctx.closePath();
  const fillGrad = ctx.createLinearGradient(0, padT, 0, H - padB);
  fillGrad.addColorStop(0, lineColorRgba(0.18));
  fillGrad.addColorStop(1, lineColorRgba(0));
  ctx.fillStyle = fillGrad;
  ctx.fill();
}

function renderCharts() {
  drawLineChart(el.pressure, {
    xData: derived.xPres,
    yData: derived.pressureDb,
    yDomain: [-40, 10],
    lineColor: 'rgb(224,122,95)',
    lineColorRgba: (a) => `rgba(224,122,95,${a})`,
    nodesX: state.showNodes ? derived.nodosX : [],
    yTickFmt: (v) => Math.round(v).toString(),
  });
  drawLineChart(el.velocity, {
    xData: derived.xPres,
    yData: derived.velocityAmp,
    yDomain: [0, 2.2],
    lineColor: 'rgb(79,176,168)',
    lineColorRgba: (a) => `rgba(79,176,168,${a})`,
    nodesX: state.showNodes ? derived.nodosX : [],
    yTickFmt: (v) => v.toFixed(1),
  });
}

/* ==========================================================================
   Render: barra de color
   ========================================================================== */
function renderColorbar() {
  const { ctx, width: W, height: H } = fitCanvasToDisplaySize(el.colorbar);
  ctx.clearRect(0, 0, W, H);
  const vertical = H >= W;
  const grad = vertical ? ctx.createLinearGradient(0, 0, 0, H) : ctx.createLinearGradient(0, 0, W, 0);
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // La posición "0" del gradiente es siempre el extremo donde cae la
    // etiqueta "top" (arriba en vertical, izquierda en horizontal), y ahí
    // queremos el valor alto — de ahí 1 - t en ambas orientaciones.
    const posT = 1 - t;
    const color = state.colorMode === 'diverging'
      ? colormapDiverging(t * 2 - 1)
      : colormapSequential(t);
    grad.addColorStop(posT, color);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  if (state.colorMode === 'diverging') {
    el.colorbarTop.textContent = '+';
    el.colorbarMid.textContent = '0';
    el.colorbarBottom.textContent = '–';
  } else {
    el.colorbarTop.textContent = 'máx';
    el.colorbarMid.textContent = '';
    el.colorbarBottom.textContent = 'mín';
  }
}

/* ==========================================================================
   Lectura de estado (nameplate)
   ========================================================================== */
function renderReadouts() {
  el.gammaReadout.textContent = derived.gammaAbs.toFixed(3);
  el.lambdaReadout.textContent = `${derived.lambda.toFixed(2)} m`;
  el.freqReadoutTop.textContent = `${state.f} Hz`;
}

/* ==========================================================================
   Recalcular todo + redibujar todo (llamado al mover sliders / cambiar modo)
   ========================================================================== */
function fullUpdate() {
  recomputeDerived();
  renderReadouts();
  renderCharts();
  renderColorbar();
  renderTube();
}

/* ==========================================================================
   Bucle de animación (partículas + gradiente del tubo únicamente;
   los dos gráficos inferiores muestran la envolvente y no necesitan
   redibujarse en cada frame)
   ========================================================================== */
function animate() {
  state.time += 0.02;
  if (state.time >= 1.0) state.time -= 1.0;
  renderTube();
  rafId = requestAnimationFrame(animate);
}

function setPlaying(playing) {
  state.playing = playing;
  el.playBtn.classList.toggle('playing', playing);
  if (playing) {
    el.playIcon.innerHTML = '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>';
    el.playLabel.textContent = 'Pausar';
    if (rafId) cancelAnimationFrame(rafId);
    animate();
  } else {
    el.playIcon.innerHTML = '<path d="M8 5v14l11-7z"/>';
    el.playLabel.textContent = 'Reproducir';
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    state.time = 0;
    renderTube();
  }
}

/* ==========================================================================
   Eventos de UI
   ========================================================================== */
el.freqSlider.addEventListener('input', () => {
  state.f = Number(el.freqSlider.value);
  el.freqValue.value = state.f;
  fullUpdate();
});
el.freqValue.addEventListener('input', () => {
  const raw = el.freqValue.value.trim();
  const v = Number(raw);
  if (raw !== '' && Number.isFinite(v)) {
    state.f = clamp(v, Number(el.freqSlider.min), Number(el.freqSlider.max));
    el.freqSlider.value = state.f;
    fullUpdate();
  }
});
el.freqValue.addEventListener('change', () => {
  el.freqValue.value = state.f; // normaliza el texto al perder el foco (vacío, fuera de rango, etc.)
});

el.rSlider.addEventListener('input', () => {
  state.R = Number(el.rSlider.value);
  el.rValue.value = state.R;
  fullUpdate();
});
el.rValue.addEventListener('input', () => {
  const raw = el.rValue.value.trim();
  const v = Number(raw);
  if (raw !== '' && Number.isFinite(v)) {
    state.R = clamp(v, Number(el.rSlider.min), Number(el.rSlider.max));
    el.rSlider.value = state.R;
    fullUpdate();
  }
});
el.rValue.addEventListener('change', () => {
  el.rValue.value = state.R;
});

el.mSlider.addEventListener('input', () => {
  state.M = Number(el.mSlider.value);
  el.mValue.value = state.M.toFixed(4);
  fullUpdate();
});
el.mValue.addEventListener('input', () => {
  const raw = el.mValue.value.trim();
  const v = Number(raw);
  if (raw !== '' && Number.isFinite(v)) {
    state.M = clamp(v, Number(el.mSlider.min), Number(el.mSlider.max));
    el.mSlider.value = state.M;
    fullUpdate();
  }
});
el.mValue.addEventListener('change', () => {
  el.mValue.value = state.M.toFixed(4);
});

el.nodesCheckbox.addEventListener('change', () => {
  state.showNodes = el.nodesCheckbox.checked;
  fullUpdate();
});

function setColorMode(mode) {
  state.colorMode = mode;
  el.modeDiverging.classList.toggle('active', mode === 'diverging');
  el.modeDiverging.setAttribute('aria-checked', String(mode === 'diverging'));
  el.modeSequential.classList.toggle('active', mode === 'sequential');
  el.modeSequential.setAttribute('aria-checked', String(mode === 'sequential'));
  renderColorbar();
  renderTube();
}
el.modeDiverging.addEventListener('click', () => setColorMode('diverging'));
el.modeSequential.addEventListener('click', () => setColorMode('sequential'));

el.playBtn.addEventListener('click', () => setPlaying(!state.playing));

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    renderCharts();
    renderColorbar();
    renderTube();
  }, 100);
});

/* ==========================================================================
   Inicio
   ========================================================================== */
fullUpdate();
