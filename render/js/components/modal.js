import { el } from '../format.js';

export function openModal({ title, body, footer, width, className = '', kicker = 'Информация' }) {
    const root = document.getElementById('modal-root');
    if (root._escHandler) document.removeEventListener('keydown', root._escHandler);
    root.innerHTML = '';
    const titleId = `modal-title-${Date.now()}`;
    const box = el('div', {
        class: `modal-box${className ? ` ${className}` : ''}`,
        style: width ? `width:${width}` : '',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': titleId
    }, [
        el('div', { class: 'modal-header' }, [
            el('div', { class: 'modal-header-title' }, [
                el('span', { class: 'modal-header-kicker' }, kicker),
                el('h3', { id: titleId }, title)
            ]),
            el('button', {
                class: 'modal-close',
                type: 'button',
                onclick: closeModal,
                'aria-label': 'Закрыть окно'
            }, '\u2715')
        ]),
        el('div', { class: 'modal-body' }, body),
        footer ? el('div', { class: 'modal-footer' }, footer) : null
    ]);
    root.appendChild(box);
    root.classList.add('open');
    root.onclick = (e) => { if (e.target === root) closeModal(); };
    root._escHandler = (e) => {
        if (e.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', root._escHandler);
    return box;
}

export function closeModal() {
    const root = document.getElementById('modal-root');
    if (root._escHandler) {
        document.removeEventListener('keydown', root._escHandler);
        root._escHandler = null;
    }
    root.classList.remove('open');
    root.innerHTML = '';
}
