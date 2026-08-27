import { el } from '../format.js';

export function openModal({ title, body, footer, width }) {
    const root = document.getElementById('modal-root');
    root.innerHTML = '';
    const box = el('div', { class: 'modal-box', style: width ? `width:${width}` : '' }, [
        el('div', { class: 'modal-header' }, [
            el('h3', {}, title),
            el('span', { class: 'modal-close', onclick: closeModal }, '\u2715')
        ]),
        el('div', { class: 'modal-body' }, body),
        footer ? el('div', { class: 'modal-footer' }, footer) : null
    ]);
    root.appendChild(box);
    root.classList.add('open');
    root.onclick = (e) => { if (e.target === root) closeModal(); };
    return box;
}

export function closeModal() {
    const root = document.getElementById('modal-root');
    root.classList.remove('open');
    root.innerHTML = '';
}
