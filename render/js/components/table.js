import { el } from '../format.js';

/**
 * Универсальная таблица с поиском/сортировкой, управляемая опциями:
 * { columns: [{key, label, render, sortValue, compare}], rows, searchFields,
 *   emptyText, initialSortKey, initialSortDir }
 * Возвращает DOM-узел; фильтрация по searchFields выполняется на строковом представлении.
 */
export function renderDataTable({
    columns,
    rows,
    searchFields = [],
    emptyText = 'Нет данных',
    pageSize = 50,
    initialSortKey = null,
    initialSortDir = 1
}) {
    let query = '';
    let sortKey = initialSortKey;
    let sortDir = initialSortDir;
    let page = 0;
    const normalizedRows = rows.map((row) => ({
        row,
        searchText: searchFields.map((field) => String(row[field] ?? '').toLowerCase()).join('\u0000')
    }));

    const wrap = el('div', { class: 'filter-animated-content' });
    const toolbar = el('div', { class: 'table-toolbar' });
    const searchInput = el('input', {
        class: 'search-input',
        placeholder: 'Поиск...',
        oninput: (e) => { query = e.target.value.toLowerCase(); page = 0; renderBody(); }
    });
    if (searchFields.length) toolbar.appendChild(searchInput);
    if (searchFields.length) wrap.appendChild(toolbar);

    const tableWrap = el('div', { class: 'table-wrap' });
    const tableClass = columns.length > 8 ? 'data-table data-table--dense' : 'data-table';
    const table = el('table', { class: tableClass });
    const thead = el('thead');
    const headRow = el('tr');
    columns.forEach((col) => {
        const th = el('th', {
            'data-column-key': col.key,
            onclick: () => {
                if (sortKey === col.key) sortDir = -sortDir; else { sortKey = col.key; sortDir = 1; }
                renderBody();
            }
        }, col.label);
        headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    const tbody = el('tbody');
    table.appendChild(thead);
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    wrap.appendChild(tableWrap);

    const pager = el('div', { class: 'table-toolbar', style: 'justify-content:flex-end;' });
    wrap.appendChild(pager);

    function renderBody() {
        const filteredEntries = query
            ? normalizedRows.filter((entry) => entry.searchText.includes(query))
            : normalizedRows;
        let filtered = filteredEntries.map((entry) => entry.row);
        if (sortKey) {
            const col = columns.find((c) => c.key === sortKey);
            filtered = filtered.slice().sort((a, b) => {
                const va = col.sortValue ? col.sortValue(a) : a[sortKey];
                const vb = col.sortValue ? col.sortValue(b) : b[sortKey];
                if (va === vb) return 0;
                if (va === null || va === undefined) return 1;
                if (vb === null || vb === undefined) return -1;
                if (col.compare) return col.compare(va, vb) * sortDir;
                return (va > vb ? 1 : -1) * sortDir;
            });
        }

        headRow.querySelectorAll('th').forEach((th, i) => {
            th.classList.toggle('sorted', columns[i].key === sortKey);
        });

        tbody.innerHTML = '';
        if (filtered.length === 0) {
            const tr = el('tr');
            const td = el('td', { colspan: columns.length, class: 'table-empty' }, emptyText);
            tr.appendChild(td);
            tbody.appendChild(tr);
        } else {
            const pageRows = filtered.slice(page * pageSize, (page + 1) * pageSize);
            const fragment = document.createDocumentFragment();
            pageRows.forEach((row) => {
                const tr = el('tr');
                columns.forEach((col) => {
                    const td = el('td', {
                        class: col.nowrap ? 'nowrap' : '',
                        'data-column-key': col.key
                    });
                    const value = col.render ? col.render(row) : (row[col.key] ?? '—');
                    if (value instanceof Node) td.appendChild(value);
                    else td.textContent = value;
                    tr.appendChild(td);
                });
                fragment.appendChild(tr);
            });
            tbody.appendChild(fragment);
        }

        pager.innerHTML = '';
        const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
        if (totalPages > 1) {
            pager.appendChild(el('span', { class: 'text-secondary', style: 'font-size:12px;margin-right:8px;' }, `Стр. ${page + 1} из ${totalPages} (${filtered.length})`));
            pager.appendChild(el('button', { class: 'btn btn-ghost btn-sm', disabled: page === 0, onclick: () => { page--; renderBody(); } }, '\u2190'));
            pager.appendChild(el('button', { class: 'btn btn-ghost btn-sm', disabled: page >= totalPages - 1, onclick: () => { page++; renderBody(); } }, '\u2192'));
        } else if (filtered.length) {
            pager.appendChild(el('span', { class: 'text-secondary', style: 'font-size:12px;' }, `Всего: ${filtered.length}`));
        }

        wrap.classList.remove('filter-content-enter');
        void wrap.offsetWidth;
        wrap.classList.add('filter-content-enter');
    }

    renderBody();
    return wrap;
}
