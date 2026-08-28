import { el, formatShortDate } from '../format.js';
import { store } from '../state.js';
import { renderDataTable } from '../components/table.js';

function compareContractNumbers(a, b) {
    const left = String(a || '').trim();
    const right = String(b || '').trim();
    if (!left && !right) return 0;
    if (!left) return 1;
    if (!right) return -1;

    const leftParts = left.match(/\d+|[^\d]+/g) || [left];
    const rightParts = right.match(/\d+|[^\d]+/g) || [right];
    for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
        const leftPart = leftParts[index];
        const rightPart = rightParts[index];
        if (leftPart === undefined) return -1;
        if (rightPart === undefined) return 1;
        const leftIsNumber = /^\d+$/.test(leftPart);
        const rightIsNumber = /^\d+$/.test(rightPart);
        if (leftIsNumber && rightIsNumber) {
            const difference = Number(leftPart) - Number(rightPart);
            if (difference !== 0) return difference;
        } else {
            const difference = leftPart.localeCompare(rightPart, 'ru', { sensitivity: 'base' });
            if (difference !== 0) return difference;
        }
    }
    return 0;
}

function contractSeparator(value) {
    const match = String(value || '').match(/\d+\s*([/-])\s*[0-9A-Za-zА-Яа-яЁё]+/u);
    return match ? match[1] : null;
}

function hasContractFormatMismatch(contract) {
    const separators = Object.values(contract.obj?.contractForms || {})
        .map(contractSeparator)
        .filter(Boolean);
    return new Set(separators).size > 1;
}

function sourceContractCell(contract, source) {
    const value = contract[`${source}Contract`];
    if (!value) return el('span', { class: 'text-secondary' }, '—');
    const separator = contractSeparator(value);
    const isDifferentSeparator = contract.isFormatMismatch && separator;
    return el('span', {
        class: isDifferentSeparator ? 'contract-source-value contract-source-value-diff' : 'contract-source-value',
        title: isDifferentSeparator ? `В номере используется разделитель «${separator}»` : ''
    }, value);
}

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
        const isDuplicate = c.duplicate || (c.number && contractCounts.get(c.number) > 1);
        const isOrphan = !c.objectId || !obj;
        const isFormatMismatch = obj ? hasContractFormatMismatch({ obj }) : false;
        let problem = null;
        if (isDuplicate) problem = 'Дубликат договора';
        else if (isOrphan) problem = 'Договор без объекта';
        return {
            ...c,
            obj,
            siteContract: obj?.contractForms?.site || null,
            ilvoContract: obj?.contractForms?.ilvo || null,
            kufarContract: obj?.contractForms?.kufar || null,
            isDuplicate,
            isOrphan,
            isFormatMismatch,
            problem
        };
    });

    const objectsWithoutContract = report.objects.filter((o) => !o.contractNumber && (
        o.presence.site || o.presence.ilvo || o.presence.kufar
    ));

    let activeFilter = 'all';
    const chips = el('div', { class: 'table-toolbar' }, [
        el('span', { class: 'filter-chip active', onclick: (e) => setFilter('all', e) }, `Все договоры (${enriched.length})`),
        el('span', { class: 'filter-chip', onclick: (e) => setFilter('linked', e) }, `Привязаны к объектам (${enriched.filter((c) => c.obj).length})`),
        el('span', { class: 'filter-chip', onclick: (e) => setFilter('orphan', e) }, `Без объекта (${enriched.filter((c) => c.isOrphan).length})`),
        el('span', { class: 'filter-chip', onclick: (e) => setFilter('dup', e) }, `Дубли (${enriched.filter((c) => c.isDuplicate).length})`),
        el('span', { class: 'filter-chip', onclick: (e) => setFilter('format', e) }, `Разные разделители (${enriched.filter((c) => c.isFormatMismatch).length})`),
        el('span', { class: 'filter-chip', onclick: (e) => setFilter('problem', e) }, `Проблемные (${enriched.filter((c) => c.problem).length})`)
    ]);

    const tableHolder = el('div');
    const card = el('div', { class: 'card card-pad' }, [chips, tableHolder]);
    container.appendChild(card);

    const formatMismatchCount = enriched.filter((c) => c.isFormatMismatch).length;
    if (formatMismatchCount) {
        container.appendChild(el('div', { class: 'card card-pad contract-format-help' }, [
            el('div', { class: 'card-title' }, 'Как читать расхождение разделителей'),
            el('p', { class: 'card-subtitle', style: 'margin-top:8px;' },
                'В колонках «Сайт», «ILVO» и «Kufar» показаны исходные значения. Например, 41/1 и 41-1 — один договор, но разделитель нужно привести к одному виду.'),
            el('p', { class: 'card-subtitle', style: 'margin-top:6px;' },
                'Исправлять нужно в выгрузке источника (чаще всего в ILVO), затем повторно импортировать файл и запустить проверку. Программа не изменяет исходные файлы автоматически.')
        ]));
    }

    if (report.contractRegistrySource === 'demo') {
        container.appendChild(el('div', { class: 'card card-pad', style: 'margin-top:16px;' }, [
            el('div', { class: 'card-title' }, 'Демонстрационный реестр'),
            el('p', { class: 'card-subtitle', style: 'margin-top:8px;' },
                'Эти номера созданы для демо-режима. После импорта реального файла они заменяются договорами, найденными в текущих объектах.')
        ]));
    }

    if (objectsWithoutContract.length) {
        container.appendChild(el('div', { class: 'card card-pad', style: 'margin-top:16px;' }, [
            el('div', { class: 'card-title' }, `Объекты без договора (${objectsWithoutContract.length})`),
            renderDataTable({
                columns: [
                    { key: 'objectNumber', label: '№' },
                    { key: 'title', label: 'Объект', render: (o) => o.title || '—' },
                    { key: 'city', label: 'Город', render: (o) => o.city || '—' }
                ],
                rows: objectsWithoutContract,
                searchFields: ['objectNumber', 'title', 'city'],
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
        if (activeFilter === 'format') rows = rows.filter((c) => c.isFormatMismatch);
        if (activeFilter === 'problem') rows = rows.filter((c) => c.problem);

        tableHolder.innerHTML = '';
        tableHolder.appendChild(renderDataTable({
            columns: [
                { key: 'number', label: '№ договора', compare: compareContractNumbers },
                { key: 'siteContract', label: 'Сайт', render: (c) => sourceContractCell(c, 'site') },
                { key: 'ilvoContract', label: 'ILVO', render: (c) => sourceContractCell(c, 'ilvo') },
                { key: 'kufarContract', label: 'Kufar', render: (c) => sourceContractCell(c, 'kufar') },
                { key: 'date', label: 'Дата', render: (c) => formatShortDate(c.date) },
                { key: 'objTitle', label: 'Объект', render: (c) => (c.obj ? c.obj.title : '—') },
                { key: 'objectNumber', label: '№ объекта', render: (c) => c.obj ? c.obj.objectNumber : '—' },
                {
                    key: 'status',
                    label: 'Статус',
                    render: (c) => c.problem
                        ? el('span', { class: 'badge badge-danger' }, c.problem)
                        : c.isFormatMismatch
                            ? el('span', { class: 'badge badge-warning' }, '\u26A0 формат')
                            : el('span', { class: 'badge badge-success' }, '\u2713 ок')
                },
                {
                    key: 'problem',
                    label: 'Проблема',
                    render: (c) => c.problem || (c.isFormatMismatch ? 'Разные разделители номера договора' : '—')
                }
            ],
            rows,
            searchFields: ['number', 'siteContract', 'ilvoContract', 'kufarContract', 'date'],
            emptyText: 'Договоры не найдены',
            initialSortKey: 'number'
        }));
    }

    draw();
}
