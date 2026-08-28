import { el } from '../format.js';
import { store } from '../state.js';
import { renderDataTable } from '../components/table.js';

const SEVERITY_LABEL = { critical: 'Критическая', warning: 'Предупреждение', info: 'Информационная' };

function targetLabel(error) {
    return error.targetType === 'contract'
        ? `Договор ${error.target || '—'}`
        : `№${error.target || '—'}`;
}

function severityBadge(sev) {
    if (sev === 'critical') return el('span', { class: 'badge badge-danger' }, SEVERITY_LABEL[sev]);
    if (sev === 'warning') return el('span', { class: 'badge badge-warning' }, SEVERITY_LABEL[sev]);
    return el('span', { class: 'badge badge-neutral' }, SEVERITY_LABEL[sev]);
}

export function renderErrors(container) {
    container.innerHTML = '';
    container.appendChild(el('div', { class: 'page-title' }, 'Ошибки'));
    container.appendChild(el('div', { class: 'page-subtitle' }, 'Единый центр ошибок и несоответствий'));

    const report = store.report;
    if (!report) {
        container.appendChild(el('div', { class: 'card card-pad table-empty' }, 'Запустите проверку на главной странице, чтобы увидеть ошибки'));
        return;
    }

    const errors = report.errors;
    let activeTab = 'all';
    const tabs = el('div', { class: 'errors-tabs' }, [
        el('span', { class: 'filter-chip active', onclick: (e) => setTab('all', e) }, `Все (${errors.length})`),
        el('span', { class: 'filter-chip', onclick: (e) => setTab('critical', e) }, `Критические (${errors.filter((x) => x.severity === 'critical').length})`),
        el('span', { class: 'filter-chip', onclick: (e) => setTab('warning', e) }, `Предупреждения (${errors.filter((x) => x.severity === 'warning').length})`),
        el('span', { class: 'filter-chip', onclick: (e) => setTab('info', e) }, `Информационные (${errors.filter((x) => x.severity === 'info').length})`)
    ]);

    const tableHolder = el('div');
    container.appendChild(el('div', { class: 'card card-pad' }, [tabs, tableHolder]));

    function setTab(t, e) {
        activeTab = t;
        tabs.querySelectorAll('.filter-chip').forEach((c) => c.classList.remove('active'));
        e.target.classList.add('active');
        draw();
    }

    function draw() {
        let rows = errors;
        if (activeTab !== 'all') rows = rows.filter((x) => x.severity === activeTab);
        tableHolder.innerHTML = '';
        tableHolder.appendChild(renderDataTable({
            columns: [
                { key: 'type', label: 'Тип' },
                { key: 'description', label: 'Описание' },
                { key: 'target', label: 'Объект / Договор', render: targetLabel },
                { key: 'source', label: 'Источник' },
                { key: 'date', label: 'Дата проверки' },
                { key: 'severity', label: 'Важность', render: (e) => severityBadge(e.severity) },
                { key: 'status', label: 'Статус', render: (e) => e.status === 'open' ? el('span', { class: 'badge badge-neutral' }, 'Открыта') : el('span', { class: 'badge badge-success' }, 'Исправлена') }
            ],
            rows,
            searchFields: ['type', 'description', 'target', 'source'],
            emptyText: 'Ошибок не найдено'
        }));
    }

    draw();
}
