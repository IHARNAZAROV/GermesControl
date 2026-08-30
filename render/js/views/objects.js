import { el, formatMoney, formatShortDate } from '../format.js';
import { store } from '../state.js';
import { renderDataTable } from '../components/table.js';
import { openModal } from '../components/modal.js';

function presenceChip(present, label) {
    return el('span', { class: `presence-chip ${present ? 'ok' : 'no'}`, title: label }, present ? '\u2713' : '\u00D7');
}

function statusBadge(status, listingStatus, listingStatusDate) {
    if (listingStatus === 'sold') {
        const date = listingStatusDate ? ` · ${formatShortDate(listingStatusDate)}` : '';
        return el('span', {
            class: 'badge badge-warning',
            title: listingStatusDate ? `Дата снятия с продажи: ${formatShortDate(listingStatusDate)}` : 'Объект продан'
        }, `Снят с продажи${date}`);
    }
    if (listingStatus === 'inactive') {
        const date = listingStatusDate ? ` · ${formatShortDate(listingStatusDate)}` : '';
        return el('span', {
            class: 'badge badge-warning',
            title: listingStatusDate ? `Дата деактивации в ILVO: ${formatShortDate(listingStatusDate)}` : 'Запись неактивна в ILVO'
        }, `Неактивен в ILVO${date}`);
    }
    if (status === 'ok') return el('span', { class: 'badge badge-success' }, '\u2713 ок');
    if (status === 'missing') return el('span', { class: 'badge badge-danger' }, '\u00D7 отсутствует');
    return el('span', { class: 'badge badge-warning' }, '\u26A0 расхождение');
}

function formatObjectPrice(obj) {
    if (obj.price !== null && obj.price !== undefined && obj.price !== '') {
        return formatMoney(obj.price, 'BYN');
    }
    return formatMoney(obj.priceUsd, 'USD');
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

function renderObjectPhotos(obj) {
    const photos = Array.isArray(obj.photos) ? obj.photos.filter(Boolean) : [];
    const gallery = el('div', { class: 'object-photo-gallery' });

    if (!photos.length) {
        gallery.appendChild(el('div', { class: 'object-photo-empty' }, 'Фотография в загруженных данных не найдена'));
        return gallery;
    }

    photos.slice(0, 6).forEach((url, index) => {
        const frame = el('figure', { class: 'object-photo-frame' });
        const image = el('img', {
            src: url,
            alt: `${obj.title || 'Объект недвижимости'} — фото ${index + 1}`,
            loading: 'lazy',
            referrerpolicy: 'no-referrer'
        });
        const fallback = el('div', { class: 'object-photo-fallback' }, 'Фото недоступно');
        fallback.hidden = true;
        image.addEventListener('error', () => {
            image.hidden = true;
            fallback.hidden = false;
            frame.classList.add('is-unavailable');
        });
        frame.append(image, fallback);
        gallery.appendChild(frame);
    });

    return gallery;
}

function showObjectDetail(obj) {
    const rows = [
        ['№ объекта', obj.objectNumber],
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
        ['Договор', obj.contractNumber || '—'],
        ['Статус размещения', obj.listingStatus === 'sold'
            ? 'Снят с продажи'
            : obj.listingStatus === 'inactive' ? 'Неактивен в ILVO' : 'Активен'],
        ['Дата снятия с продажи', obj.listingStatusDate ? formatShortDate(obj.listingStatusDate) : '—']
    ];

    const body = [
        el('div', { class: 'object-photo-section' }, [
            el('div', { class: 'card-title' }, 'Фотографии объекта'),
            renderObjectPhotos(obj)
        ]),
        el('div', { class: 'matching-explanation' }, [
            el('div', { class: 'text-secondary', style: 'font-size:11.5px;margin-bottom:4px;' }, 'Основание объединения'),
            matchBasis(obj),
            el('div', { class: 'text-secondary', style: 'font-size:11.5px;margin-top:8px;' }, 'Записи объединяются по нормализованному номеру договора и адресу. Исходные номера источников сохраняются для контроля формата.')
        ]),
        el('div', { class: 'object-detail-grid' },
            rows.map(([label, value]) => el('div', {}, [
                el('div', { class: 'text-secondary', style: 'font-size:11.5px;' }, label),
                el('div', { style: 'font-weight:600;font-size:13px;' }, String(value ?? '—'))
            ]))
        ),
        el('div', { class: 'presence-list' }, [
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

    openModal({ title: obj.title || `Объект №${obj.objectNumber}`, body, width: '560px' });
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
        // Старые сохранённые отчёты могли быть созданы без objectNumber.
        // Номер восстанавливается по исходному порядку, а не по текущему
        // фильтру, поэтому он остаётся стабильным во всех вкладках.
        rows = rows.map((o) => ({
            ...o,
            objectNumber: o.objectNumber || report.objects.indexOf(o) + 1
        }));

        tableHolder.innerHTML = '';
        tableHolder.appendChild(renderDataTable({
            columns: [
                { key: 'objectNumber', label: '№', nowrap: true },
                { key: 'title', label: 'Объект', render: (o) => o.title || '—' },
                { key: 'price', label: 'Цена', render: formatObjectPrice },
                { key: 'totalArea', label: 'Площадь', render: (o) => formatMoney(o.totalArea, 'м²') },
                { key: 'contractNumber', label: 'Договор', render: (o) => o.contractNumber || '—' },
                { key: 'matchedBy', label: 'Объединено', render: (o) => matchBasis(o) },
                { key: 'site', label: 'Сайт', sortValue: (o) => o.presence.site, render: (o) => presenceChip(o.presence.site) },
                { key: 'ilvo', label: 'ILVO', sortValue: (o) => o.presence.ilvo, render: (o) => presenceChip(o.presence.ilvo) },
                { key: 'kufar', label: 'Kufar', sortValue: (o) => o.presence.kufar, render: (o) => presenceChip(o.presence.kufar) },
                { key: 'status', label: 'Статус', render: (o) => statusBadge(o.status, o.listingStatus, o.listingStatusDate) },
                { key: 'actions', label: '', render: (o) => el('span', { class: 'btn btn-ghost btn-sm', onclick: () => showObjectDetail(o) }, 'Открыть') }
            ],
            rows,
            searchFields: ['objectNumber', 'title', 'city', 'address', 'contractNumber'],
            emptyText: 'Объекты не найдены'
        }));
    }

    draw();
}
