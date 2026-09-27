import { esc } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function niceStep(max, ticks = 4) {
  if (max <= 0) return 1;
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
}

function smoothPath(points) {
  // Monotone (Fritsch–Carlson) : lisse sans dépasser les valeurs réelles.
  const n = points.length;
  if (n < 2) return points.length ? `M${points[0][0]},${points[0][1]}` : '';
  const dx = [], dy = [], m = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = points[i + 1][0] - points[i][0]; dy[i] = (points[i + 1][1] - points[i][1]) / dx[i]; }
  m[0] = dy[0]; m[n - 1] = dy[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = dy[i - 1] * dy[i] <= 0 ? 0 : (dy[i - 1] + dy[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (dy[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / dy[i], b = m[i + 1] / dy[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * dy[i]; m[i + 1] = t * b * dy[i]; }
  }
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C${points[i][0] + h},${points[i][1] + m[i] * h} ${points[i + 1][0] - h},${points[i + 1][1] - m[i + 1] * h} ${points[i + 1][0]},${points[i + 1][1]}`;
  }
  return d;
}

/**
 * Courbes multi-séries sur un axe unique.
 * series: [{ key, label, color (var CSS), values: number[] }]
 */
export function lineChart(host, { labels, series, format, formatAxis, tooltipTitle, animate = true }) {
  host.classList.add('chart');
  host.innerHTML = '';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${series.map((s) => s.label).join(' et ')} sur ${labels.length} mois. Utilisez les flèches pour parcourir.`);
  svg.setAttribute('tabindex', '0');
  const tip = document.createElement('div');
  tip.className = 'chart-tip glass-solid';
  tip.hidden = true;
  host.append(svg, tip);

  let active = -1;
  let geom = null;

  function draw(first) {
    const W = host.clientWidth;
    const H = host.clientHeight || 280;
    if (W < 10) return;
    const pad = { top: 16, right: 92, bottom: 30, left: 56 };
    const iw = W - pad.left - pad.right;
    const ih = H - pad.top - pad.bottom;
    const max = Math.max(1, ...series.flatMap((s) => s.values));
    const step = niceStep(max);
    const top = Math.ceil(max / step) * step;
    const x = (i) => pad.left + (labels.length === 1 ? iw / 2 : (i / (labels.length - 1)) * iw);
    const y = (v) => pad.top + ih - (v / top) * ih;
    geom = { x, y, pad, iw, ih, W, H };

    let out = '';
    for (let v = 0; v <= top + 1e-9; v += step) {
      out += `<line class="grid" x1="${pad.left}" x2="${W - pad.right + 8}" y1="${y(v)}" y2="${y(v)}"/>`;
      out += `<text class="axis" x="${pad.left - 10}" y="${y(v) + 4}" text-anchor="end">${esc(formatAxis(v))}</text>`;
    }
    const every = iw / labels.length < 44 ? 2 : 1;
    labels.forEach((l, i) => {
      if (i % every === 0 || i === labels.length - 1) out += `<text class="axis" x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(l)}</text>`;
    });

    // Aire discrète sous la première série uniquement (repère de volume, pas de couleur par-dessus couleur).
    const s0 = series[0];
    const p0 = s0.values.map((v, i) => [x(i), y(v)]);
    out += `<defs><linearGradient id="area-${s0.key}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:${s0.color};stop-opacity:0.2"/><stop offset="1" style="stop-color:${s0.color};stop-opacity:0"/></linearGradient></defs>`;
    out += `<path class="area" d="${smoothPath(p0)} L${x(labels.length - 1)},${y(0)} L${x(0)},${y(0)} Z" fill="url(#area-${s0.key})"/>`;

    series.forEach((s) => {
      const pts = s.values.map((v, i) => [x(i), y(v)]);
      out += `<path class="line" data-key="${s.key}" d="${smoothPath(pts)}" style="stroke:${s.color}"/>`;
    });

    // Étiquettes directes en bout de courbe, écartées si elles se chevauchent.
    const ends = series.map((s) => ({ s, y: y(s.values.at(-1)) })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 30) ends[i].y = ends[i - 1].y + 30;
    ends.forEach(({ s, y: ly }) => {
      const cy = y(s.values.at(-1));
      out += `<circle class="end" cx="${x(labels.length - 1)}" cy="${cy}" r="4.5" style="fill:${s.color}"/>`;
      out += `<text class="end-label" x="${x(labels.length - 1) + 12}" y="${ly - 2}">${esc(s.label)}</text>`;
      out += `<text class="end-value" x="${x(labels.length - 1) + 12}" y="${ly + 13}">${esc(formatAxis(s.values.at(-1)))}</text>`;
    });

    out += `<line class="crosshair" y1="${pad.top}" y2="${pad.top + ih}" x1="0" x2="0" opacity="0"/>`;
    out += series.map((s) => `<circle class="hover-dot" data-key="${s.key}" r="5" style="fill:${s.color}" opacity="0"/>`).join('');
    out += `<rect class="hit" x="${pad.left - 12}" y="${pad.top}" width="${iw + 24}" height="${ih}" fill="transparent"/>`;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    svg.innerHTML = out;

    if (first && animate && !reduceMotion()) {
      svg.querySelectorAll('.line').forEach((p, i) => {
        const len = p.getTotalLength();
        p.style.strokeDasharray = `${len}`;
        p.style.strokeDashoffset = `${len}`;
        p.getBoundingClientRect();
        p.style.transition = `stroke-dashoffset 900ms cubic-bezier(0.16,1,0.3,1) ${i * 120}ms`;
        p.style.strokeDashoffset = '0';
        p.addEventListener('transitionend', () => { p.style.strokeDasharray = ''; }, { once: true });
      });
      svg.querySelectorAll('.area, .end, .end-label, .end-value').forEach((el) => {
        el.style.opacity = '0';
        el.style.transition = 'opacity 500ms ease 650ms';
        requestAnimationFrame(() => (el.style.opacity = ''));
      });
    }
    if (active >= 0) show(active);
  }

  function show(i) {
    if (!geom || i < 0) return;
    active = i;
    const { x, y, W } = geom;
    const cx = x(i);
    const ch = svg.querySelector('.crosshair');
    ch.setAttribute('x1', cx); ch.setAttribute('x2', cx); ch.setAttribute('opacity', '1');
    series.forEach((s) => {
      const dot = svg.querySelector(`.hover-dot[data-key="${s.key}"]`);
      dot.setAttribute('cx', cx); dot.setAttribute('cy', y(s.values[i])); dot.setAttribute('opacity', '1');
    });
    tip.innerHTML = `<strong>${esc(tooltipTitle(i))}</strong>` + series.map((s) =>
      `<div class="tip-row"><span class="swatch" style="background:${s.color}"></span><span>${esc(s.label)}</span><b class="num">${esc(format(s.values[i]))}</b></div>`).join('');
    tip.hidden = false;
    const tw = tip.offsetWidth;
    tip.style.left = `${Math.min(Math.max(cx - tw / 2, 0), W - tw)}px`;
    tip.style.top = `${Math.max(0, Math.min(...series.map((s) => y(s.values[i]))) - tip.offsetHeight - 14)}px`;
  }
  function hide() {
    active = -1;
    tip.hidden = true;
    svg.querySelector('.crosshair')?.setAttribute('opacity', '0');
    svg.querySelectorAll('.hover-dot').forEach((d) => d.setAttribute('opacity', '0'));
  }

  svg.addEventListener('pointermove', (e) => {
    if (!geom) return;
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * geom.W;
    const i = Math.round(((px - geom.pad.left) / geom.iw) * (labels.length - 1));
    show(Math.max(0, Math.min(labels.length - 1, i)));
  });
  svg.addEventListener('pointerleave', hide);
  svg.addEventListener('blur', hide);
  svg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = active < 0 ? labels.length - 1 : active + (e.key === 'ArrowRight' ? 1 : -1);
      show(Math.max(0, Math.min(labels.length - 1, next)));
    } else if (e.key === 'Escape') hide();
  });

  draw(true);
  const ro = new ResizeObserver(() => draw(false));
  ro.observe(host);
  const onTheme = () => draw(false);
  window.addEventListener('themechange', onTheme);
  return () => { ro.disconnect(); window.removeEventListener('themechange', onTheme); };
}

/** Barres horizontales à une seule teinte (magnitude), valeur en bout de barre. */
export function barList(host, rows, { format, animate = true }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const total = rows.reduce((s, r) => s + r.value, 0) || 1;
  host.innerHTML = `<ul class="bars" role="list">${rows.map((r) => `
    <li class="bar-row" tabindex="0" aria-label="${esc(r.label)} : ${esc(format(r.value))}, ${Math.round((r.value / total) * 100)} %">
      <span class="bar-label">${esc(r.label)}</span>
      <span class="bar-track"><span class="bar-fill" style="--w:${(r.value / max) * 100}%"></span></span>
      <span class="bar-value num">${esc(format(r.value))}<small>${Math.round((r.value / total) * 100)} %</small></span>
    </li>`).join('')}</ul>`;
  if (animate && !reduceMotion()) {
    host.querySelectorAll('.bar-fill').forEach((el, i) => {
      el.style.transform = 'scaleX(0)';
      requestAnimationFrame(() => {
        el.style.transition = `transform 700ms cubic-bezier(0.16,1,0.3,1) ${150 + i * 60}ms`;
        el.style.transform = '';
      });
    });
  }
}

/** Compteur animé une seule fois au chargement (le moment « vivant » du tableau de bord). */
export function countUp(el, target, format, duration = 900) {
  if (reduceMotion() || target === 0) { el.textContent = format(target); return; }
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - 2 ** (-10 * t);
    el.textContent = format(Math.round(target * (t === 1 ? 1 : eased)));
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
