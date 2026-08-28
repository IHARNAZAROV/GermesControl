import { el, formatMoney } from '../format.js';
import { store } from '../state.js';
import { renderDataTable } from '../components/table.js';
import { openModal } from '../components/modal.js';

function presenceChip(present, label) {
    return el('span', { class: `presence-chip ${present ? 'ok' : 'no'}`, title: label }, present ? '\u2713' : '\u00D7');
}

function statusBadge(status) {
    if (status === 'ok') return el('span', { class: 'badge badge-success' }, '\u2713 ок');
    if (status === 'missing') return el('span', { class: 'badge badge-danger' }, '\u00D7 отсутствует');
    return el('span', { class: 'badge badge-warning' }, '\u26A0 расхождение');
}

function matchBasis(obj) {
    const labels = {
        contract: 'По договору',
        address_price: 'Адрес + цена',
        address: 'По адресу',
        descriptor: 'Цена + параметры',
        none: 'Без совпадения'
    };
    const label = labels[obj.matchedBy] || labels.none;
    const className = obj.matchConfidence === 'strong'
        ? 'badge-success'
        : (obj.matchConfidence === 'review' ? 'badge-warning' : 'badge-danger');
    return el('span', { class: `badge ${className}`, title: 'Правило, по которому записи объединены' }, label);
}

function showObjectDetail(obj) {
    const rows = [
        ['ID объединённой карточки', obj.id],
        ['Название', obj.title],
        ['Тип', obj.type],
        ['Тип сделки', obj.dealType],
        ['Город', obj.city],
        ['Адрес', obj.address],
        ['Цена', formatMoney(obj.price, 'BYN')],
        ['Цена USD', formatMoney(obj.priceUsd, 'USD')],
        ['Комнат', obj.rooms],
        ['Общая площадь', formatMoney(obj.totalArea, 'м²')],
        ['Жилая площадь', formatMoney(obj.livingArea, 'м²')],
        ['Площадь кухни', formatMoney(obj.kitchenArea, 'м²')],
        ['Этаж', `${obj.floor ?? '—'} / ${obj.floors ?? '—'}`],
        ['Договор', obj.contractNumber || '—']
    ];

    const body = [
        el('div', { class: 'matching-explanation' }, [
            el('div', { class: 'text-secondary', style: 'font-size:11.5px;margin-bottom:4px;' }, 'Основание объединения'),
            matchBasis(obj),
            el('div', { class: 'text-secondary', style: 'font-size:11.5px;margin-top:8px;' }, 'Исходные ID не сравниваются: каждая система выдаёт свой ID для той же недвижимости.')
        ]),
        el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px 18px;margin-bottom:16px;' },
            rows.map(([label, value]) => el('div', {}, [
                el('div', { class: 'text-secondary', style: 'font-size:11.5px;' }, label),
                el('div', { style: 'font-weight:600;font-size:13px;' }, String(value ?? '—'))
            ]))
        ),
        el('div', { style: 'margin-bottom:16px;' }, [
            el('div', { class: 'text-secondary', style: 'font-size:11.5px;margin-bottom:6px;' }, 'ID в источниках'),
            ...[
                ['Сайт', obj.presence.site, obj.sourceIds && obj.sourceIds.site],
                ['ILVO', obj.presence.ilvo, obj.sourceIds && obj.sourceIds.ilvo],
                ['Kufar', obj.presence.kufar, obj.sourceIds && obj.sourceIds.kufar]
            ].map(([label, present, sourceId]) => el('div', { style: 'font-size:12px;margin-top:4px;' }, [
                presenceChip(present, label),
                el('span', { style: 'margin-left:7px;font-weight:600;' }, label),
                el('span', { class: 'text-secondary', style: 'margin-left:6px;' }, sourceId || 'нет записи')
            ]))
        ]),
        el('div', { style: 'display:flex;gap:8px;margin-bottom:16px;' }, [
            presenceChip(obj.presence.site, 'Сайт'), el('span', { class: 'text-secondary', style: 'font-size:12px;' }, 'Сайт'),
            presenceChip(obj.presence.ilvo, 'ILVO'), el('span', { class: 'text-secondary', style: 'font-size:12px;' }, 'ILVO'),
            presenceChip(obj.presence.kufar, 'Kufar'), el('span', { class: 'text-secondary', style: 'font-size:12px;' }, 'Kufar')
        ])
    ];

    if (obj.fieldDiffs && obj.fieldDiffs.length) {
        body.push(el('div', { class: 'card-title', style: 'margin-bottom:8px;' }, 'Расхождения'));
        obj.fieldDiffs.forEach((d) => {
            body.push(el('div', { class: 'field-diff-card' }, [
                el('div', { class: 'field-name' }, d.label),
                el('div', { class: 'field-diff-values' }, ['site', 'ilvo', 'kufar'].map((src) =>
                    d.values[src] !== undefined ? el('div', { class: 'fv' }, [
                        el('span', { class: 'src' }, src === 'site' ? 'Сайт:' : src === 'ilvo' ? 'ILVO:' : 'Kufar:'),
                        formatMoney(d.values[src], d.unit)
                    ]) : null
                )),
                el('div', { class: 'badge badge-warning', style: 'margin-top:8px;' }, '\u26A0 Значения отличаются')
            ]));
        });
    }

    openModal({ title: obj.title || obj.id, body, width: '560px' });
}

export function renderObjects(container) {
    container.innerHTML = '';
    container.appendChild(el('div', { class: 'page-title' }, 'Объекты'));
    container.appendChild(el('div', { class: 'page-subtitle' }, 'Единый реестр объектов недвижимости по всем источникам'));

    const report = store.report;
    if (!report) {
        container.appendChild(el('div', { class: 'card card-pad table-empty' }, 'Запустите проверку на главной странице, чтобы увидеть объекты'));
        return;
    }

    container.appendChild(el('div', { class: 'card card-pad matching-rules' }, [
        el('div', { class: 'card-title' }, 'Как система объединяет записи'),
        el('div', { class: 'matching-rules-grid' }, [
            el('div', {}, [
                el('div', { class: 'matching-rule-title' }, '1. Договор — главный ключ'),
                el('div', { class: 'text-secondary' }, '«41/1», «Договор 41/1» и «Договор 41/1 от 01.07.2026» считаются одним номером.')
            ]),
            el('div', {}, [
                el('div', { class: 'matching-rule-title' }, '2. Адрес — резервный ключ'),
                el('div', { class: 'text-secondary' }, 'Улица и номер дома сравниваются после очистки сокращений, регистра и лишних пробелов.')
            ]),
            el('div', {}, [
                el('div', { class: 'matching-rule-title' }, '3. Цена — подтверждение'),
                el('div', { class: 'text-secondary' }, 'Одинаковая цена усиливает совпадение адреса. Одна только цена никогда не объединяет записи.')
            ])
        ]),
        el('div', { class: 'matching-note' }, 'ID в источниках разные и не используются как признак объекта. В таблице показывается внутренний ID объединённой карточки MATCH-…; исходные ID доступны внутри карточки.')
    ]));

    let activeFilter = 'all';
    const card = el('div', { class: 'card card-pad' });
    const chips = el('div', { class: 'table-toolbar' }, [
        el('span', { class: 'filter-chip active', onclick: (e) => setFilter('all', e) }, `Все (${report.objects.length})`),
        el('span', { class: 'filter-chip', onclick: (e) => setFilter('problem', e) }, `Проблемные (${report.objects.filter((o) => o.status !== 'ok').length})`),
        el('span', { class: 'filter-chip', onclick: (e) => setFilter('missing', e) }, `Отсутствующие (${report.objects.filter((o) => o.status === 'missing').length})`)
    ]);
    const tableHolder = el('div');
    card.appendChild(chips);
    card.appendChild(tableHolder);
    container.appendChild(card);

    function setFilter(f, e) {
        activeFilter = f;
        chips.querySelectorAll('.filter-chip').forEach((c) => c.classList.remove('active'));
        e.target.classList.add('active');
        draw();
    }

    function draw() {
        let rows = report.objects;
        if (activeFilter === 'problem') rows = rows.filter((o) => o.status !== 'ok');
        if (activeFilter === 'missing') rows = rows.filter((o) => o.status === 'missing');

        tableHolder.innerHTML = '';
        tableHolder.appendChild(renderDataTable({
            columns: [
                { key: 'title', label: 'Объект', render: (o) => o.title || '—' },
                { key: 'id', label: 'ID группы' },
                { key: 'type', label: 'Тип', render: (o) => o.type || '—' },
                { key: 'city', label: 'Город', render: (o) => o.city || '—' },
                { key: 'price', label: 'Цена', render: (o) => formatMoney(o.price, 'BYN') },
                { key: 'totalArea', label: 'Площадь', render: (o) => formatMoney(o.totalArea, 'м²') },
                { key: 'contractNumber', label: 'Договор', render: (o) => o.contractNumber || '—' },
                { key: 'matchedBy', label: 'Объединено', render: (o) => matchBasis(o) },
                { key: 'site', label: 'Сайт', sortValue: (o) => o.presence.site, render: (o) => presenceChip(o.presence.site) },
                { key: 'ilvo', label: 'ILVO', sortValue: (o) => o.presence.ilvo, render: (o) => presenceChip(o.presence.ilvo) },
                { key: 'kufar', label: 'Kufar', sortValue: (o) => o.presence.kufar, render: (o) => presenceChip(o.presence.kufar) },
                { key: 'status', label: 'Статус', render: (o) => statusBadge(o.status) },
                { key: 'actions', label: '', render: (o) => el('span', { class: 'btn btn-ghost btn-sm', onclick: () => showObjectDetail(o) }, 'Открыть') }
            ],
            rows,
            searchFields: ['id', 'title', 'city', 'address', 'contractNumber', 'sourceIdsText'],
            emptyText: 'Объекты не найдены'
        }));
    }

    draw();
}
