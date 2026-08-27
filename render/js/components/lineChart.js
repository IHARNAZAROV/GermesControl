import { el } from '../format.js';

/**
 * series: [{ date, value }] в хронологическом порядке.
 * Простая SVG-визуализация тренда без внешних библиотек.
 */
export function renderLineChart(series, { color = '#155945', height = 160, formatValue } = {}) {
    const width = 640;
    const padding = 24;
    if (!series.length) {
        return el('div', { class: 'table-empty' }, 'Недостаточно данных для графика');
    }
    const values = series.map((p) => p.value);
    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const range = Math.max(max - min, 1);

    const stepX = series.length > 1 ? (width - padding * 2) / (series.length - 1) : 0;
    const points = series.map((p, i) => {
        const x = padding + i * stepX;
        const y = height - padding - ((p.value - min) / range) * (height - padding * 2);
        return [x, y];
    });

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('preserveAspectRatio', 'none');

    const areaPath = ['M', points[0][0], height - padding];
    points.forEach(([x, y]) => areaPath.push('L', x, y));
    areaPath.push('L', points[points.length - 1][0], height - padding, 'Z');
    const area = document.createElementNS(svgNS, 'path');
    area.setAttribute('d', areaPath.join(' '));
    area.setAttribute('fill', color);
    area.setAttribute('opacity', '0.08');
    svg.appendChild(area);

    const linePath = points.map((p, i) => (i === 0 ? 'M' : 'L') + p[0] + ' ' + p[1]).join(' ');
    const line = document.createElementNS(svgNS, 'path');
    line.setAttribute('d', linePath);
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', '2.5');
    svg.appendChild(line);

    points.forEach(([x, y]) => {
        const dot = document.createElementNS(svgNS, 'circle');
        dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.setAttribute('r', 3.5);
        dot.setAttribute('fill', color);
        svg.appendChild(dot);
    });

    return el('div', {}, [svg]);
}
