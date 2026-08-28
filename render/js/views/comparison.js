import { el } from '../format.js';
import { store } from '../state.js';
import { renderDataTable } from '../components/table.js';

function chip(present) {
    return el('span', { class: `presence-chip ${present ? 'ok' : 'no'}` }, present ? '\u2713' : '\u00D7');
}

export function renderComparison(container) {
    container.innerHTML = '';
    container.appendChild(el('div', { class: 'page-title' }, 'Сравнение площадок'));
    container.appendChild(el('div', { class: 'page-subtitle' }, 'Какие объекты потерялись при передаче данных между системами'));

    const report = store.report;
    if (!report) {
        container.appendChild(el('div', { class: 'card card-pad table-empty' }, 'Запустите проверку на главной странице, чтобы увидеть сравнение'));
        return;
    }

    const cat = report.categories;
    const cards = [
        ['Есть везде', cat.everywhere],
        ['Только на сайте', cat.onlySite],
        ['Только в ILVO', cat.onlyIlvo],
        ['Только в XML/Kufar', cat.onlyKufar],
        ['Нет на сайте', cat.missingSite],
        ['Нет в ILVO', cat.missingIlvo],
        ['Нет в XML/Kufar', cat.missingKufar]
    ];
    container.appendChild(el('div', { class: 'cat-grid' }, cards.map(([label, value]) =>
        el('div', { class: 'card cat-card' }, [
            el('div', { class: 'cat-value' }, String(value)),
            el('div', { class: 'cat-label' }, label)
        ])
    )));

    let activeFilter = 'all';
    const chips = el('div', { class: 'table-toolbar' }, [
        el('span', { class: 'filter-chip active', onclick: (e) => setFilter('all', e) }, 'Все объекты'),
        el('span', { class: 'filter-chip', onclick: (e) => setFilter('mismatch', e) }, 'Только расхождения')
    ]);
    const tableHolder = el('div');
    container.appendChild(el('div', { class: 'card card-pad' }, [chips, tableHolder]));

    function setFilter(f, e) {
        activeFilter = f;
        chips.querySelectorAll('.filter-chip').forEach((c) => c.classList.remove('active'));
        e.target.classList.add('active');
        draw();
    }

    function draw() {
        let rows = report.objects;
        if (activeFilter === 'mismatch') rows = rows.filter((o) => o.status !== 'ok');
        tableHolder.innerHTML = '';
        tableHolder.appendChild(renderDataTable({
            columns: [
                { key: 'objectNumber', label: '№' },
                { key: 'title', label: 'Объект', render: (o) => o.title || '—' },
                { key: 'site', label: 'Сайт', sortValue: (o) => o.presence.site, render: (o) => chip(o.presence.site) },
                { key: 'ilvo', label: 'ILVO', sortValue: (o) => o.presence.ilvo, render: (o) => chip(o.presence.ilvo) },
                { key: 'kufar', label: 'XML / Kufar', sortValue: (o) => o.presence.kufar, render: (o) => chip(o.presence.kufar) }
            ],
            rows,
            searchFields: ['objectNumber', 'title', 'city', 'address', 'contractNumber'],
            emptyText: 'Объекты не найдены'
        }));
    }

    draw();
}
