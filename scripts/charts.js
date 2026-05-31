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

  // Cache for chart instances
  const _charts = {};

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
  }

  /* ---- Daily Time Line Chart ----------------------- */

  function renderDailyTimeChart(canvasId, data) {
    destroyChart(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

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

  function renderTopicChart(canvasId, data) {
    destroyChart(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas || data.length === 0) return;

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

  function renderMonthlyChart(canvasId, data) {
    destroyChart(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

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

  function renderHeatmap(containerId, cells) {
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

    // On mobile cap weeks so heatmap fits without horizontal scroll
    if (isMobile) {
      const availW = container.offsetWidth || (window.innerWidth - 48);
      const maxW   = Math.max(13, Math.floor((availW - gap) / stride));
      if (weeks.length > maxW) weeks = weeks.slice(-maxW);
    }

    // Month labels — absolutely positioned so each label aligns exactly with its week column
    const monthRow = document.createElement('div');
    monthRow.style.cssText = 'position:relative;height:14px;margin-bottom:4px;';

    let prevMonth = -1;
    weeks.forEach((w, wi) => {
      const firstCell = w.find(c => c !== null);
      if (firstCell) {
        const m = new Date(firstCell.date).getMonth();
        if (m !== prevMonth) {
          const label = document.createElement('div');
          label.textContent = new Date(firstCell.date).toLocaleDateString('en-US', { month: 'short' });
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
          } else {
            const opacities = [0, 0.35, 0.55, 0.75, 1];
            el.style.background = accent;
            el.style.opacity = opacities[cell.level];
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
    Object.keys(_charts).forEach(id => {
      const chart = _charts[id];
      if (!chart) return;
      chart.options.scales?.x?.ticks && (chart.options.scales.x.ticks.color = getTextColor());
      chart.options.scales?.y?.ticks && (chart.options.scales.y.ticks.color = getTextColor());
      chart.options.scales?.x?.grid  && (chart.options.scales.x.grid.color  = getBorderColor());
      chart.options.scales?.y?.grid  && (chart.options.scales.y.grid.color  = getBorderColor());
      chart.update();
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
