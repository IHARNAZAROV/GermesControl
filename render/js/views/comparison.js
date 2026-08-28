import { el, formatShortDate, sourceLogo, icon } from '../format.js';
import { store } from '../state.js';
import { renderDataTable } from '../components/table.js';

function chip(present) {
    return el('span', { class: `presence-chip ${present ? 'ok' : 'no'}` }, present ? '\u2713' : '\u00D7');
}

function listingBadge(object) {
    if (object.listingStatus !== 'sold') return el('span', { class: 'text-secondary' }, 'Активен');
    const date = object.listingStatusDate ? ` · ${formatShortDate(object.listingStatusDate)}` : '';
    return el('span', { class: 'badge badge-warning' }, `Снят с продажи${date}`);
}

function categoryIcon(sources) {
    if (!sources || sources.length === 0) {
        return el('div', { class: 'cat-card-icon cat-card-icon-neutral' }, [icon('shield', 20)]);
    }
    return el('div', { class: 'cat-card-icon-list' }, sources.map((source) =>
        el('span', { class: 'cat-card-icon' }, [sourceLogo(source)])
    ));
}

export function renderComparison(container) {
    container.innerHTML = '';
    container.appendChild(el('div', { class: 'page-title' }, 'Сравнение площадок'));
    container.appendChild(el('div', { class: 'page-subtitle' }, 'Какие объекты потерялись при передаче данных между системами. Снятые с продажи учитываются отдельно и не считаются пропущенными.'));

    const report = store.report;
    if (!report) {
        container.appendChild(el('div', { class: 'card card-pad table-empty' }, 'Запустите проверку на главной странице, чтобы увидеть сравнение'));
        return;
    }

    const cat = report.categories;
    const cards = [
        { label: 'Есть везде', value: cat.everywhere, sources: ['site', 'ilvo', 'kufar'] },
        { label: 'Только на сайте', value: cat.onlySite, sources: ['site'] },
        { label: 'Только в ILVO', value: cat.onlyIlvo, sources: ['ilvo'] },
        { label: 'Только в Kufar', value: cat.onlyKufar, sources: ['kufar'] },
        { label: 'Нет на сайте', value: cat.missingSite, sources: ['site'] },
        { label: 'Нет в ILVO', value: cat.missingIlvo, sources: ['ilvo'] },
        { label: 'Нет в Kufar', value: cat.missingKufar, sources: ['kufar'] },
        { label: 'Сняты с продажи', value: report.stats.soldCount || 0, sources: [] }
    ];
    container.appendChild(el('div', { class: 'cat-grid' }, cards.map(({ label, value, sources }) =>
        el('div', { class: 'card cat-card' }, [
            categoryIcon(sources),
            el('div', { class: 'cat-card-content' }, [
                el('div', { class: 'cat-value' }, String(value)),
                el('div', { class: 'cat-label' }, label)
            ])
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
                { key: 'kufar', label: 'Kufar', sortValue: (o) => o.presence.kufar, render: (o) => chip(o.presence.kufar) },
                { key: 'listingStatus', label: 'Статус размещения', render: listingBadge }
            ],
            rows,
            searchFields: ['objectNumber', 'title', 'city', 'address', 'contractNumber'],
            emptyText: 'Объекты не найдены'
        }));
    }

    draw();
}
