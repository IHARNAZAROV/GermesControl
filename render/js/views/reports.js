import { el } from '../format.js';
import { store } from '../state.js';
import { showToast } from '../components/toast.js';

const REPORT_TYPES = [
    { key: 'missing', title: 'Отчёт по отсутствующим объектам', desc: 'Объекты, которых не хватает на одной или нескольких площадках' },
    { key: 'contracts', title: 'Отчёт по договорам', desc: 'Полный реестр договоров с привязкой к объектам' },
    { key: 'errors', title: 'Отчёт по ошибкам', desc: 'Все выявленные ошибки и несоответствия' },
    { key: 'diffs', title: 'Отчёт по расхождениям данных', desc: 'Поля, значения которых отличаются между источниками' },
    { key: 'full', title: 'Полный отчёт', desc: 'Все объекты со статусом по каждому источнику' }
];
const FORMATS = ['xlsx', 'csv', 'pdf', 'json'];

export function renderReports(container) {
    container.innerHTML = '';
    container.appendChild(el('div', { class: 'page-title' }, 'Отчёты'));
    container.appendChild(el('div', { class: 'page-subtitle' }, 'Формирование отчётов по данным последней проверки'));

    if (!store.report) {
        container.appendChild(el('div', { class: 'card card-pad table-empty' }, 'Запустите проверку на главной странице, чтобы формировать отчёты'));
        return;
    }

    container.appendChild(el('div', { class: 'report-grid' }, REPORT_TYPES.map((rt) =>
        el('div', { class: 'card report-card' }, [
            el('div', { class: 'r-title' }, rt.title),
            el('div', { class: 'r-desc' }, rt.desc),
            el('div', { class: 'format-row' }, FORMATS.map((fmt) =>
                el('button', {
                    class: 'btn btn-secondary btn-sm',
                    onclick: async () => {
                        try {
                            const res = await window.electronAPI.generateReport(rt.key, fmt);
                            if (!res.canceled) showToast(`Отчёт сохранён: ${res.destPath}`, 'success');
                        } catch (err) {
                            showToast(err.message || 'Не удалось сформировать отчёт', 'error');
                        }
                    }
                }, fmt.toUpperCase())
            ))
        ])
    )));
}
