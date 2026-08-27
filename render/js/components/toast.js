import { el } from '../format.js';

export function showToast(message, type = 'default') {
    const root = document.getElementById('toast-root');
    const node = el('div', { class: `toast ${type}` }, message);
    root.appendChild(node);
    setTimeout(() => {
        node.style.opacity = '0';
        node.style.transition = 'opacity 0.25s ease';
        setTimeout(() => node.remove(), 250);
    }, 3200);
}
