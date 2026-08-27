import { el } from '../format.js';

/**
 * segments: [{ label, value, color }]
 * Возвращает DOM-узел с SVG donut-диаграммой и легендой (легенду строит вызывающий код).
 */
export function renderDonut(segments, centerLabel) {
    const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;
    const size = 168;
    const stroke = 22;
    const r = (size - stroke) / 2;
    const c = size / 2;
    const circumference = 2 * Math.PI * r;

    let offset = 0;
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);

    const bg = document.createElementNS(svgNS, 'circle');
    bg.setAttribute('cx', c); bg.setAttribute('cy', c); bg.setAttribute('r', r);
    bg.setAttribute('fill', 'none');
    bg.setAttribute('stroke', '#EAF5F1');
    bg.setAttribute('stroke-width', stroke);
    svg.appendChild(bg);

    for (const seg of segments) {
        if (seg.value <= 0) continue;
        const frac = seg.value / total;
        const len = frac * circumference;
        const circle = document.createElementNS(svgNS, 'circle');
        circle.setAttribute('cx', c); circle.setAttribute('cy', c); circle.setAttribute('r', r);
        circle.setAttribute('fill', 'none');
        circle.setAttribute('stroke', seg.color);
        circle.setAttribute('stroke-width', stroke);
        circle.setAttribute('stroke-dasharray', `${len} ${circumference - len}`);
        circle.setAttribute('stroke-dashoffset', -offset);
        circle.setAttribute('transform', `rotate(-90 ${c} ${c})`);
        circle.setAttribute('stroke-linecap', 'butt');
        svg.appendChild(circle);
        offset += len;
    }

    const wrap = el('div', { style: 'position:relative;width:' + size + 'px;height:' + size + 'px;' }, [svg]);
    if (centerLabel) {
        const overlay = el('div', {
            class: 'donut-center-label',
            style: 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;'
        }, [
            el('div', { class: 'pct' }, centerLabel.value),
            el('div', { class: 'caption' }, centerLabel.caption)
        ]);
        wrap.appendChild(overlay);
    }
    return wrap;
}
