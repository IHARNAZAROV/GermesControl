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

    const wrap = el('div', {});
    const toolbar = el('div', { class: 'table-toolbar' });
    const searchInput = el('input', {
        class: 'search-input',
        placeholder: 'Поиск...',
        oninput: (e) => { query = e.target.value.toLowerCase(); page = 0; renderBody(); }
    });
    if (searchFields.length) toolbar.appendChild(searchInput);
    wrap.appendChild(toolbar);

    const tableWrap = el('div', { class: 'table-wrap' });
    const table = el('table', { class: 'data-table' });
    const thead = el('thead');
    const headRow = el('tr');
    columns.forEach((col) => {
        const th = el('th', {
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

    function matches(row) {
        if (!query) return true;
        return searchFields.some((f) => String(row[f] ?? '').toLowerCase().includes(query));
    }

    function renderBody() {
        let filtered = rows.filter(matches);
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
            pageRows.forEach((row) => {
                const tr = el('tr');
                columns.forEach((col) => {
                    const td = el('td', {});
                    const value = col.render ? col.render(row) : (row[col.key] ?? '—');
                    if (value instanceof Node) td.appendChild(value);
                    else td.textContent = value;
                    tr.appendChild(td);
                });
                tbody.appendChild(tr);
            });
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
    }

    renderBody();
    return wrap;
}
