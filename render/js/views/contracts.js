import { el } from '../format.js';
import { store } from '../state.js';
import { renderDataTable } from '../components/table.js';

export function renderContracts(container) {
    container.innerHTML = '';
    container.appendChild(el('div', { class: 'page-title' }, 'Договоры'));
    container.appendChild(el('div', { class: 'page-subtitle' }, 'Контроль договоров и их привязки к объектам'));

    const report = store.report;
    if (!report) {
        container.appendChild(el('div', { class: 'card card-pad table-empty' }, 'Запустите проверку на главной странице, чтобы увидеть договоры'));
        return;
    }

    const contracts = report.contracts || [];
    const objectsById = new Map(report.objects.map((o) => [o.id, o]));
    const contractCounts = new Map();
    contracts.forEach((c) => { if (c.number) contractCounts.set(c.number, (contractCounts.get(c.number) || 0) + 1); });

    const enriched = contracts.map((c) => {
        const obj = c.objectId ? objectsById.get(c.objectId) : null;
        const isDuplicate = c.number && contractCounts.get(c.number) > 1;
        const isOrphan = !c.objectId || !obj;
        let problem = null;
        if (isDuplicate) problem = 'Дубликат договора';
        else if (isOrphan) problem = 'Договор без объекта';
        return { ...c, obj, isDuplicate, isOrphan, problem };
    });

    const objectsWithoutContract = report.objects.filter((o) => !o.contractNumber && (o.presence.site || o.presence.ilvo));

    let activeFilter = 'all';
    const chips = el('div', { class: 'table-toolbar' }, [
        el('span', { class: 'filter-chip active', onclick: (e) => setFilter('all', e) }, `Все договоры (${enriched.length})`),
        el('span', { class: 'filter-chip', onclick: (e) => setFilter('linked', e) }, `Привязаны к объектам (${enriched.filter((c) => c.obj).length})`),
        el('span', { class: 'filter-chip', onclick: (e) => setFilter('orphan', e) }, `Без объекта (${enriched.filter((c) => c.isOrphan).length})`),
        el('span', { class: 'filter-chip', onclick: (e) => setFilter('dup', e) }, `Дубли (${enriched.filter((c) => c.isDuplicate).length})`),
        el('span', { class: 'filter-chip', onclick: (e) => setFilter('problem', e) }, `Проблемные (${enriched.filter((c) => c.problem).length})`)
    ]);

    const tableHolder = el('div');
    const card = el('div', { class: 'card card-pad' }, [chips, tableHolder]);
    container.appendChild(card);

    if (objectsWithoutContract.length) {
        container.appendChild(el('div', { class: 'card card-pad', style: 'margin-top:16px;' }, [
            el('div', { class: 'card-title' }, `Объекты без договора (${objectsWithoutContract.length})`),
            renderDataTable({
                columns: [
                    { key: 'id', label: 'ID' },
                    { key: 'title', label: 'Объект', render: (o) => o.title || '—' },
                    { key: 'city', label: 'Город', render: (o) => o.city || '—' }
                ],
                rows: objectsWithoutContract,
                searchFields: ['id', 'title'],
                pageSize: 10
            })
        ]));
    }

    function setFilter(f, e) {
        activeFilter = f;
        chips.querySelectorAll('.filter-chip').forEach((c) => c.classList.remove('active'));
        e.target.classList.add('active');
        draw();
    }

    function draw() {
        let rows = enriched;
        if (activeFilter === 'linked') rows = rows.filter((c) => c.obj);
        if (activeFilter === 'orphan') rows = rows.filter((c) => c.isOrphan);
        if (activeFilter === 'dup') rows = rows.filter((c) => c.isDuplicate);
        if (activeFilter === 'problem') rows = rows.filter((c) => c.problem);

        tableHolder.innerHTML = '';
        tableHolder.appendChild(renderDataTable({
            columns: [
                { key: 'number', label: '№ договора' },
                { key: 'date', label: 'Дата' },
                { key: 'objTitle', label: 'Объект', render: (c) => (c.obj ? c.obj.title : '—') },
                { key: 'objectId', label: 'ID группы', render: (c) => c.objectId || '—' },
                { key: 'status', label: 'Статус', render: (c) => c.problem ? el('span', { class: 'badge badge-danger' }, c.problem) : el('span', { class: 'badge badge-success' }, '\u2713 ок') },
                { key: 'problem', label: 'Проблема', render: (c) => c.problem || '—' }
            ],
            rows,
            searchFields: ['number', 'objectId'],
            emptyText: 'Договоры не найдены'
        }));
    }

    draw();
}
