import { el } from '../format.js';
import { openModal, closeModal } from './modal.js';
import { runCheck } from '../state.js';
import { showToast } from './toast.js';

const STEPS = [
    'Сайт',
    'ILVO',
    'XML Kufar',
    'Сравнение объектов',
    'Проверка договоров',
    'Проверка цен',
    'Проверка площадей',
    'Проверка адресов'
];

export async function runCheckWithProgress(onDone) {
    const stepNodes = STEPS.map((label) => el('div', { class: 'check-step' }, [
        el('span', { class: 'check-mark' }, '\u25CB'),
        el('span', {}, label)
    ]));

    const body = [
        el('div', { class: 'check-steps' }, stepNodes),
        el('div', { id: 'check-result' })
    ];

    openModal({ title: 'Проверка данных', width: '420px', body });

    for (let i = 0; i < stepNodes.length; i++) {
        await new Promise((r) => setTimeout(r, 180));
        stepNodes[i].classList.add('done');
        stepNodes[i].classList.remove('active');
        stepNodes[i].querySelector('.check-mark').textContent = '\u2713';
        if (i + 1 < stepNodes.length) stepNodes[i + 1].classList.add('active');
    }

    let report;
    try {
        report = await runCheck();
    } catch (err) {
        showToast(err.message || 'Ошибка при проверке данных', 'error');
        closeModal();
        return;
    }

    const resultBox = document.getElementById('check-result');
    if (resultBox) {
        resultBox.appendChild(el('div', { class: 'card card-pad', style: 'margin-top:10px;background:var(--color-surface-mint);border:none;' }, [
            el('div', { style: 'font-weight:700;margin-bottom:6px;' }, 'Проверка завершена'),
            el('div', { class: 'text-secondary', style: 'font-size:12.5px;' }, `Найдено: ${report.stats.problemsCount} проблем, ${report.stats.errorsCount} записей об ошибках`)
        ]));
    }

    setTimeout(() => {
        closeModal();
        showToast('Проверка завершена', 'success');
        if (onDone) onDone(report);
    }, 900);
}
