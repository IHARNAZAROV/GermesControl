import { el, icon } from '../format.js';
import { openModal, closeModal } from './modal.js';
import { runCheck } from '../state.js';
import { showToast } from './toast.js';

const STEPS = [
    'Сайт',
    'ILVO',
    'Kufar',
    'Сравнение объектов',
    'Проверка договоров',
    'Проверка цен',
    'Проверка площадей',
    'Проверка адресов'
];

let activeRun = null;

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runCheckWithProgress(onDone) {
    const runToken = {};
    activeRun = runToken;
    const stepNodes = STEPS.map((label) => el('div', { class: 'check-step' }, [
        el('span', { class: 'check-mark' }, [icon('play', 15)]),
        el('span', {}, label)
    ]));

    const body = [
        el('div', { class: 'check-steps' }, stepNodes),
        el('div', { id: 'check-result' })
    ];

    openModal({ title: 'Проверка данных', width: '420px', body });

    for (let i = 0; i < stepNodes.length; i++) {
        await wait(180);
        if (activeRun !== runToken) return;
        stepNodes[i].classList.add('done');
        stepNodes[i].classList.remove('active');
        const mark = stepNodes[i].querySelector('.check-mark');
        mark.innerHTML = '';
        mark.appendChild(icon('check', 15));
        if (i + 1 < stepNodes.length) stepNodes[i + 1].classList.add('active');
    }

    let report;
    try {
        report = await runCheck();
    } catch (err) {
        if (activeRun === runToken) {
            showToast(err.message || 'Ошибка при проверке данных', 'error');
            closeModal();
            activeRun = null;
        }
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
        if (activeRun !== runToken) return;
        closeModal();
        showToast('Проверка завершена', 'success');
        if (onDone) onDone(report);
        activeRun = null;
    }, 900);
}
