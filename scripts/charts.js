/* ===================================================
   LEARNTRACK — CHARTS ENGINE
   Chart.js wrappers for all visualizations + Heatmap
   =================================================== */

'use strict';

const Charts = (() => {

  /* ---- Chart.js global defaults -------------------- */
  const CHART_DEFAULTS = {
    responsive:          true,
    maintainAspectRatio: false,
    animation:           { duration: 600, easing: 'easeInOutQuart' },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(15,15,19,0.9)',
        borderColor:     'rgba(255,255,255,0.1)',
        borderWidth:     1,
        titleColor:      '#e8e8f0',
        bodyColor:       '#a0a0b8',
        padding:         10,
        cornerRadius:    8,
        titleFont:       { family: 'Inter', weight: '600', size: 13 },
        bodyFont:        { family: 'Inter', size: 12 },
      },
    },
  };

  // Cache for chart instances and recreator functions
  const _charts = {};
  const _recreators = {};

  function getAccentColor() {
    return getComputedStyle(document.documentElement)
      .getPropertyValue('--accent').trim() || '#6c63ff';
  }

  function getTextColor() {
    return getComputedStyle(document.documentElement)
      .getPropertyValue('--text-3').trim() || '#606080';
  }

  function getBorderColor() {
    return getComputedStyle(document.documentElement)
      .getPropertyValue('--border').trim() || 'rgba(255,255,255,0.07)';
  }

  function destroyChart(id) {
    if (_charts[id]) {
      _charts[id].destroy();
      delete _charts[id];
    }
    delete _recreators[id];
  }

  // Chart.js is loaded from a CDN. If it failed to load (offline), every renderer
  // would throw a ReferenceError and abort the surrounding page render. Guard each
  // renderer with this and show an inline placeholder instead.
  function _chartLibReady(canvasId) {
    if (typeof Chart !== 'undefined') return true;
    const canvas = document.getElementById(canvasId);
    const container = canvas ? (canvas.closest('.chart-container') || canvas.parentElement) : null;
    if (container && !container.querySelector('.chart-unavailable')) {
      const msg = document.createElement('div');
      msg.className = 'chart-unavailable';
      msg.textContent = 'Charts unavailable — offline or failed to load.';
      container.appendChild(msg);
    }
    return false;
  }

  /* ---- Heatmap cell tooltip (works on mobile tap) -- */

  function _showHeatTip(text, anchor) {
    let tip = document.getElementById('_hm-tip');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = '_hm-tip';
      tip.style.cssText = 'position:fixed;background:var(--surface);border:1px solid rgba(255,255,255,0.18);border-radius:8px;padding:7px 12px;font-size:12px;font-weight:500;color:var(--text);white-space:nowrap;z-index:9999;box-shadow:0 6px 24px rgba(0,0,0,0.55);pointer-events:none;opacity:0;transition:opacity 0.15s;';
      document.body.appendChild(tip);
      document.addEventListener('click', e => {
        if (!e.target.classList.contains('heatmap-day')) tip.style.opacity = '0';
      });
    }
    tip.textContent = text;
    const ar = anchor.getBoundingClientRect();
    const tr = tip.getBoundingClientRect();
    let top  = ar.top - tr.height - 8;
    let left = ar.left + ar.width / 2 - tr.width / 2;
    if (top < 8) top = ar.bottom + 8;
    left = Math.max(8, Math.min(left, window.innerWidth - tr.width - 8));
    tip.style.top  = top + 'px';
    tip.style.left = left + 'px';
    tip.style.opacity = '1';
    clearTimeout(tip._t);
    tip._t = setTimeout(() => { tip.style.opacity = '0'; }, 2500);
  }

  /* ---- Daily Time Line Chart ----------------------- */

  function renderDailyTimeChart(canvasId, data, onPointClick) {
    if (!_chartLibReady(canvasId)) return;
    destroyChart(canvasId);
    _recreators[canvasId] = () => renderDailyTimeChart(canvasId, data, onPointClick);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    if (data.length) {
      const total = data.reduce((s, d) => s + d.hours, 0);
      const peak  = data.reduce((a, d) => d.hours > a.hours ? d : a, data[0]);
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label',
        `Daily study time over the last ${data.length} day${data.length !== 1 ? 's' : ''}.` +
        (peak.hours > 0 ? ` Peak: ${peak.hours.toFixed(1)}h on ${peak.label}.` : '') +
        ` Total: ${total.toFixed(1)}h.`
      );
    }

    const accent = getAccentColor();
    const ctx    = canvas.getContext('2d');

    const gradient = ctx.createLinearGradient(0, 0, 0, 280);
    gradient.addColorStop(0, accent + '55');
    gradient.addColorStop(1, accent + '00');

    _charts[canvasId] = new Chart(ctx, {
      type: 'line',
      data: {
        labels:   data.map(d => d.label),
        datasets: [{
          label:           'Hours',
          data:            data.map(d => d.hours),
          borderColor:     accent,
          backgroundColor: gradient,
          borderWidth:     2.5,
          tension:         0.4,
          fill:            true,
          pointBackgroundColor: accent,
          pointRadius:     data.length > 60 ? 0 : 4,
          pointHoverRadius: 6,
        }],
      },
      options: {
        ...CHART_DEFAULTS,
        onClick: onPointClick ? (event, elements) => {
          if (!elements.length) return;
          const idx = elements[0].index;
          if (data[idx]) onPointClick(data[idx].date, data[idx].label);
        } : undefined,
        onHover: onPointClick ? (event, elements) => {
          if (event.native?.target) event.native.target.style.cursor = elements.length ? 'pointer' : 'default';
        } : undefined,
        scales: {
          x: {
            ticks: {
              color: getTextColor(),
              font: { family: 'Inter', size: window.innerWidth <= 768 ? 9 : 11 },
              maxTicksLimit: window.innerWidth <= 768 ? 7 : 10,
              maxRotation: 0,
            },
            grid: { color: getBorderColor() },
          },
          y: {
            beginAtZero: true,
            ticks: {
              color: getTextColor(),
              font: { family: 'Inter', size: window.innerWidth <= 768 ? 9 : 11 },
              callback: (v) => v + 'h',
              maxTicksLimit: 5,
            },
            grid: { color: getBorderColor() },
          },
        },
        plugins: {
          ...CHART_DEFAULTS.plugins,
          tooltip: {
            ...CHART_DEFAULTS.plugins.tooltip,
            callbacks: {
              label: (ctx) => ` ${Analytics.formatDuration(Math.round(ctx.raw * 60))}`,
            },
          },
        },
      },
    });
  }

  /* ---- Topic Distribution Doughnut Chart ----------- */

  function renderTopicChart(canvasId, data, onSliceClick) {
    if (!_chartLibReady(canvasId)) return;
    destroyChart(canvasId);
    _recreators[canvasId] = () => renderTopicChart(canvasId, data, onSliceClick);
    const canvas = document.getElementById(canvasId);
    if (!canvas || data.length === 0) return;

    const _esc   = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const slices = data.slice(0, 10);
    const totalH = slices.reduce((s, d) => s + d.hours, 0);
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label',
      'Topic distribution. ' +
      slices.slice(0, 5).map(d => `${d.label}: ${d.hours.toFixed(1)}h`).join(', ') +
      (slices.length > 5 ? ` and ${slices.length - 5} more.` : '.')
    );
    const prev = canvas.parentElement.querySelector('.chart-sr-table');
    if (prev) prev.remove();
    const tbl = document.createElement('table');
    tbl.className = 'sr-only chart-sr-table';
    tbl.innerHTML = '<caption>Topic study time breakdown</caption>' +
      '<thead><tr><th scope="col">Topic</th><th scope="col">Hours</th><th scope="col">Share</th></tr></thead>' +
      '<tbody>' + slices.map(d => {
        const pct = totalH > 0 ? Math.round(d.hours / totalH * 100) : 0;
        return `<tr><td>${_esc(d.label)}</td><td>${d.hours.toFixed(1)}h</td><td>${pct}%</td></tr>`;
      }).join('') + '</tbody>';
    canvas.parentElement.insertBefore(tbl, canvas.nextSibling);

    const PALETTE = [
      '#6c63ff','#10b981','#f59e0b','#ef4444','#3b82f6',
      '#ec4899','#8b5cf6','#06b6d4','#84cc16','#f97316',
    ];

    _charts[canvasId] = new Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels:   data.slice(0, 10).map(d => d.label),
        datasets: [{
          data:            data.slice(0, 10).map(d => d.hours),
          backgroundColor: PALETTE.slice(0, data.length),
          borderColor:     'transparent',
          borderWidth:     2,
          hoverOffset:     6,
        }],
      },
      options: {
        ...CHART_DEFAULTS,
        onClick: onSliceClick ? (event, elements) => {
          if (!elements.length) return;
          const idx = elements[0].index;
          const slice = data.slice(0, 10)[idx];
          if (slice) onSliceClick(slice.label);
        } : undefined,
        onHover: onSliceClick ? (event, elements) => {
          if (event.native?.target) event.native.target.style.cursor = elements.length ? 'pointer' : 'default';
        } : undefined,
        cutout: '65%',
        plugins: {
          ...CHART_DEFAULTS.plugins,
          legend: {
            display:  true,
            position: window.innerWidth <= 768 ? 'right' : 'bottom',
            labels: {
              color:     getTextColor(),
              font:      { family: 'Inter', size: window.innerWidth <= 768 ? 9 : 11 },
              padding:   window.innerWidth <= 768 ? 6 : 12,
              boxWidth:  window.innerWidth <= 768 ? 8 : 10,
              boxHeight: window.innerWidth <= 768 ? 8 : 10,
              usePointStyle: true,
            },
          },
          tooltip: {
            ...CHART_DEFAULTS.plugins.tooltip,
            callbacks: {
              label: (ctx) => ` ${ctx.label}: ${Analytics.formatDuration(Math.round(ctx.raw * 60))}`,
            },
          },
        },
      },
    });
  }

  /* ---- Monthly Progress Bar Chart ------------------ */

  function renderMonthlyChart(canvasId, data, onBarClick) {
    if (!_chartLibReady(canvasId)) return;
    destroyChart(canvasId);
    _recreators[canvasId] = () => renderMonthlyChart(canvasId, data, onBarClick);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    if (data.length) {
      const total = data.reduce((s, d) => s + d.hours, 0);
      const best  = data.reduce((a, d) => d.hours > a.hours ? d : a, data[0]);
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label',
        `Monthly study time over ${data.length} month${data.length !== 1 ? 's' : ''}.` +
        ` Total: ${total.toFixed(1)}h.` +
        (best.hours > 0 ? ` Best month: ${best.label} at ${best.hours.toFixed(1)}h.` : '')
      );
    }

    const accent = getAccentColor();
    const ctx    = canvas.getContext('2d');

    _charts[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels:   data.map(d => d.label),
        datasets: [{
          label:           'Hours',
          data:            data.map(d => d.hours),
          backgroundColor: (ctx) => {
            const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 220);
            g.addColorStop(0, accent + 'cc');
            g.addColorStop(1, accent + '55');
            return g;
          },
          borderColor:     accent,
          borderWidth:     0,
          borderRadius:    6,
          borderSkipped:   false,
        }],
      },
      options: {
        ...CHART_DEFAULTS,
        onClick: onBarClick ? (event, elements) => {
          if (!elements.length) return;
          const idx = elements[0].index;
          if (data[idx]) onBarClick(data[idx].from, data[idx].to, data[idx].label);
        } : undefined,
        onHover: onBarClick ? (event, elements) => {
          if (event.native?.target) event.native.target.style.cursor = elements.length ? 'pointer' : 'default';
        } : undefined,
        scales: {
          x: {
            ticks: {
              color: getTextColor(),
              font: { family: 'Inter', size: window.innerWidth <= 768 ? 9 : 11 },
              maxRotation: 0,
            },
            grid:  { display: false },
          },
          y: {
            beginAtZero: true,
            ticks: {
              color: getTextColor(),
              font: { family: 'Inter', size: window.innerWidth <= 768 ? 9 : 11 },
              callback: (v) => v + 'h',
              maxTicksLimit: 5,
            },
            grid: { color: getBorderColor() },
          },
        },
        plugins: {
          ...CHART_DEFAULTS.plugins,
          tooltip: {
            ...CHART_DEFAULTS.plugins.tooltip,
            callbacks: {
              label: (ctx) => ` ${Analytics.formatDuration(Math.round(ctx.raw * 60))}`,
            },
          },
        },
      },
    });
  }

  /* ---- Learning Curve Line Chart ------------------- */

  function renderLearningCurveChart(canvasId, curveData) {
    if (!_chartLibReady(canvasId)) return;
    destroyChart(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas || curveData.points.length < 2) return;

    const accent = getAccentColor();
    const ctx    = canvas.getContext('2d');

    const gradient = ctx.createLinearGradient(0, 0, 0, 280);
    gradient.addColorStop(0, accent + '44');
    gradient.addColorStop(1, accent + '00');

    const fmtLabel = ds => {
      const d = new Date(ds + 'T00:00:00');
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    _charts[canvasId] = new Chart(ctx, {
      type: 'line',
      data: {
        labels:   curveData.points.map(p => fmtLabel(p.date)),
        datasets: [
          {
            label:            'Growth Score',
            data:             curveData.points.map(p => p.value),
            borderColor:      accent,
            backgroundColor:  gradient,
            borderWidth:      2.5,
            tension:          0.4,
            fill:             true,
            pointRadius:      0,
            pointHoverRadius: 5,
          },
          {
            label:       'Trend',
            data:        smoothData(curveData.points.map(p => p.value), 14),
            borderColor: '#f59e0b',
            borderWidth: 1.5,
            borderDash:  [4, 4],
            tension:     0.4,
            fill:        false,
            pointRadius: 0,
          },
        ],
      },
      options: {
        ...CHART_DEFAULTS,
        scales: {
          x: {
            ticks: {
              color: getTextColor(),
              font: { family: 'Inter', size: 11 },
              maxTicksLimit: 10,
              maxRotation: 0,
            },
            grid: { color: getBorderColor() },
          },
          y: {
            beginAtZero: true,
            ticks: { color: getTextColor(), font: { family: 'Inter', size: 11 } },
            grid: { color: getBorderColor() },
          },
        },
        plugins: {
          ...CHART_DEFAULTS.plugins,
          legend: {
            display:  true,
            position: 'top',
            labels: {
              color: getTextColor(),
              font:  { family: 'Inter', size: 11 },
              boxWidth:  16,
              usePointStyle: true,
            },
          },
        },
      },
    });
  }

  /* ---- Dashboard Sparkline (14-day mini trend) ----- */

  function renderSparklineChart(canvasId, data) {
    if (!_chartLibReady(canvasId)) return;
    destroyChart(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const accent   = getAccentColor();
    const ctx      = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 130);
    gradient.addColorStop(0, accent + '40');
    gradient.addColorStop(1, accent + '00');

    _charts[canvasId] = new Chart(ctx, {
      type: 'line',
      data: {
        labels:   data.map(d => d.label),
        datasets: [{
          data:             data.map(d => d.hours),
          borderColor:      accent,
          backgroundColor:  gradient,
          borderWidth:      2,
          tension:          0.4,
          fill:             true,
          pointRadius:      0,
          pointHoverRadius: 4,
          pointBackgroundColor: accent,
        }],
      },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        animation:           { duration: 500 },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(15,15,19,0.9)',
            borderColor:     'rgba(255,255,255,0.1)',
            borderWidth:     1,
            bodyColor:       '#a0a0b8',
            padding:         8,
            cornerRadius:    6,
            callbacks: {
              title: (items) => items[0].label,
              label: (ctx)   => ` ${Analytics.formatDuration(Math.round(ctx.raw * 60))}`,
            },
          },
        },
        scales: {
          x: {
            ticks: {
              color:         getTextColor(),
              font:          { family: 'Inter', size: 10 },
              maxTicksLimit: 7,
              maxRotation:   0,
            },
            grid: { display: false },
          },
          y: { display: false, beginAtZero: true },
        },
      },
    });
  }

  function smoothData(data, window) {
    return data.map((_, i) => {
      const start = Math.max(0, i - Math.floor(window / 2));
      const end   = Math.min(data.length - 1, i + Math.floor(window / 2));
      const slice = data.slice(start, end + 1);
      return slice.reduce((s, v) => s + v, 0) / slice.length;
    });
  }

  /* ---- Dashboard Mini Curve Chart ------------------ */

  function renderDashboardCurve(canvasId, curveData) {
    if (!_chartLibReady(canvasId)) return;
    destroyChart(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas || curveData.points.length < 2) return;

    const accent = getAccentColor();
    const ctx    = canvas.getContext('2d');

    const gradient = ctx.createLinearGradient(0, 0, 0, 160);
    gradient.addColorStop(0, accent + '55');
    gradient.addColorStop(1, accent + '00');

    _charts[canvasId] = new Chart(ctx, {
      type: 'line',
      data: {
        labels:   curveData.points.map(p => p.date.slice(5)), // MM-DD for mini
        datasets: [{
          data:            curveData.points.map(p => p.value),
          borderColor:     accent,
          backgroundColor: gradient,
          borderWidth:     2,
          tension:         0.5,
          fill:            true,
          pointRadius:     0,
        }],
      },
      options: {
        ...CHART_DEFAULTS,
        animation: { duration: 400 },
        scales: { x: { display: false }, y: { display: false } },
        plugins: { ...CHART_DEFAULTS.plugins, tooltip: { enabled: false } },
      },
    });
  }

  /* ---- GitHub-style Heatmap ------------------------ */

  function renderHeatmap(containerId, cells, onCellClick) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';

    if (cells.length === 0) {
      container.innerHTML = '<p style="color:var(--text-3);font-size:13px;padding:8px">No data yet</p>';
      return;
    }

    // Group by week column
    let weeks = [];
    let week    = [];
    let weekday = cells[0].weekday;

    // Pad first week
    for (let i = 0; i < weekday; i++) week.push(null);

    for (const cell of cells) {
      week.push(cell);
      if (week.length === 7) { weeks.push(week); week = []; }
    }
    if (week.length > 0) {
      while (week.length < 7) week.push(null);
      weeks.push(week);
    }

    const accent = getAccentColor();
    const isMobile = window.innerWidth <= 768;
    const cs  = isMobile ? 10 : 12;  // cell size px
    const gap = isMobile ? 2  : 3;   // gap px
    const stride = cs + gap;

    // On mobile show complete months that fit without horizontal scroll
    if (isMobile) {
      const availW = container.offsetWidth || (window.innerWidth - 48);
      const maxW   = Math.max(13, Math.floor((availW - gap) / stride));
      if (weeks.length > maxW) weeks = weeks.slice(-maxW);
      // Trim leading partial month so display starts at a clean month boundary
      for (let i = 1; i < weeks.length; i++) {
        const prev = weeks[i - 1].find(c => c !== null);
        const curr = weeks[i].find(c => c !== null);
        if (prev && curr && new Date(prev.date + 'T12:00:00').getMonth() !== new Date(curr.date + 'T12:00:00').getMonth()) {
          weeks = weeks.slice(i);
          break;
        }
      }
    }

    // Update hint label with actual period shown
    const hintEl = document.getElementById('heatmap-hint');
    if (hintEl) {
      if (isMobile) {
        const monthKeys = new Set();
        weeks.forEach(w => w.forEach(c => {
          if (c) {
            const d = new Date(c.date + 'T12:00:00');
            monthKeys.add(d.getFullYear() + '-' + d.getMonth());
          }
        }));
        const n = monthKeys.size;
        hintEl.textContent = `Last ${n} month${n !== 1 ? 's' : ''}`;
      } else {
        hintEl.textContent = 'Last 52 weeks';
      }
    }

    // Month labels — absolutely positioned so each label aligns exactly with its week column
    const monthRow = document.createElement('div');
    monthRow.style.cssText = 'position:relative;height:14px;margin-bottom:4px;';

    let prevMonth = -1;
    weeks.forEach((w, wi) => {
      for (const cell of w) {
        if (!cell) continue;
        const m = new Date(cell.date + 'T12:00:00').getMonth();
        if (m !== prevMonth) {
          const label = document.createElement('div');
          label.textContent = new Date(cell.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short' });
          label.style.cssText = `position:absolute;left:${wi * stride}px;font-size:10px;color:var(--text-3);white-space:nowrap;line-height:14px;`;
          monthRow.appendChild(label);
          prevMonth = m;
        }
      }
    });

    const grid = document.createElement('div');
    grid.style.cssText = `display:flex;gap:${gap}px;`;

    for (const week of weeks) {
      const col = document.createElement('div');
      col.style.cssText = `display:flex;flex-direction:column;gap:${gap}px;`;

      for (const cell of week) {
        const el = document.createElement('div');
        el.style.cssText = `width:${cs}px;height:${cs}px;border-radius:2px;`;

        if (!cell) {
          el.style.background = 'transparent';
        } else {
          el.className = 'heatmap-day';
          el.title     = cell.label;
          el.setAttribute('role', 'gridcell');
          el.setAttribute('aria-label', cell.label);

          if (cell.level === 0) {
            el.style.background = 'var(--border)';
            el.style.cursor = 'default';
            el.addEventListener('click', e => { e.stopPropagation(); _showHeatTip(cell.label, el); });
          } else {
            const opacities = [0, 0.10, 0.19, 0.28, 0.37, 0.46, 0.55, 0.64, 0.73, 0.82, 1.0];
            el.style.background = accent;
            el.style.opacity    = opacities[cell.level];
            el.style.cursor     = 'pointer';
            el.addEventListener('click', e => {
              e.stopPropagation();
              if (onCellClick) onCellClick(cell.date);
              else _showHeatTip(cell.label, el);
            });
          }
        }
        col.appendChild(el);
      }
      grid.appendChild(col);
    }

    // Give monthRow the same width as the grid so absolute labels stay in bounds
    const gridWidth = weeks.length * stride - gap;
    monthRow.style.width = gridWidth + 'px';

    const outerWrap = document.createElement('div');
    outerWrap.style.cssText = 'width:fit-content;';
    outerWrap.appendChild(monthRow);
    outerWrap.appendChild(grid);
    container.appendChild(outerWrap);
  }

  /* ---- Refresh all charts on theme/accent change --- */

  function refreshAllCharts() {
    // Recreate charts so getAccentColor() is called fresh inside each render function.
    // In-place patching of Chart.js dataset options does not work reliably because
    // Chart.js caches resolved element options in meta._sharedOptions and returns
    // them verbatim on every subsequent update(), ignoring mutations to ds.pointBackgroundColor.
    // Suppress animation so the accent change is instant instead of replaying the 600ms intro.
    CHART_DEFAULTS.animation.duration = 0;
    Object.keys(_recreators).forEach(id => _recreators[id]());
    CHART_DEFAULTS.animation.duration = 600;
    const accent = getAccentColor();
    document.querySelectorAll('.heatmap-day').forEach(el => {
      if (el.style.opacity) el.style.background = accent;
    });
  }

  function resizeAllCharts() {
    Object.keys(_charts).forEach(id => {
      const chart = _charts[id];
      if (chart) chart.resize();
    });
  }

  /* ---- Public API ---------------------------------- */
  return {
    renderDailyTimeChart,
    renderTopicChart,
    renderMonthlyChart,
    renderLearningCurveChart,
    renderDashboardCurve,
    renderSparklineChart,
    renderHeatmap,
    refreshAllCharts,
    resizeAllCharts,
    destroyChart,
  };

})();
