import { el, formatMoney, formatShortDate, icon, sourceLogo } from '../format.js';
import { store } from '../state.js';
import { renderDataTable } from '../components/table.js';
import { openModal, closeModal } from '../components/modal.js';

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
    const gallery = el('div', {
        class: 'object-photo-gallery object-photo-gallery-interactive',
        tabindex: photos.length ? '0' : '-1',
        'aria-label': 'Галерея фотографий объекта'
    });

    if (!photos.length) {
        gallery.appendChild(el('div', { class: 'object-photo-empty' }, [
            el('span', { class: 'object-photo-empty-icon' }, [icon('building', 22)]),
            el('strong', {}, 'Фотографии не загружены'),
            el('span', {}, 'В текущих выгрузках нет изображений этого объекта')
        ]));
        return gallery;
    }

    const visiblePhotos = photos.slice(0, 12);
    let activeIndex = 0;
    const mainFrame = el('figure', { class: 'object-photo-main' });
    const mainImage = el('img', {
        src: visiblePhotos[0],
        alt: `${obj.title || 'Объект недвижимости'} — фото 1`,
        referrerpolicy: 'no-referrer'
    });
    const mainFallback = el('div', { class: 'object-photo-fallback' }, [
        el('span', { class: 'object-photo-fallback-icon' }, [icon('building', 24)]),
        el('span', {}, 'Фото недоступно')
    ]);
    mainFallback.hidden = true;
    const counter = el('span', { class: 'object-photo-counter' }, `1 / ${visiblePhotos.length}`);
    const previousButton = el('button', {
        class: 'object-photo-nav object-photo-nav-prev',
        type: 'button',
        'aria-label': 'Предыдущее фото',
        disabled: visiblePhotos.length < 2
    }, '\u2039');
    const nextButton = el('button', {
        class: 'object-photo-nav object-photo-nav-next',
        type: 'button',
        'aria-label': 'Следующее фото',
        disabled: visiblePhotos.length < 2
    }, '\u203A');

    mainImage.addEventListener('error', () => {
        mainImage.hidden = true;
        mainFallback.hidden = false;
        mainFrame.classList.add('is-unavailable');
    });
    mainImage.addEventListener('load', () => {
        mainImage.hidden = false;
        mainFallback.hidden = true;
        mainFrame.classList.remove('is-unavailable');
    });
    mainFrame.append(
        mainImage,
        mainFallback,
        el('div', { class: 'object-photo-main-overlay' }, [counter]),
        previousButton,
        nextButton
    );

    const thumbs = el('div', { class: 'object-photo-thumbs' });
    const thumbButtons = visiblePhotos.map((url, index) => {
        const button = el('button', {
            class: `object-photo-thumb${index === 0 ? ' is-active' : ''}`,
            type: 'button',
            'aria-label': `Открыть фото ${index + 1}`,
            'aria-pressed': index === 0 ? 'true' : 'false'
        }, [
            el('img', {
                src: url,
                alt: '',
                loading: 'lazy',
                referrerpolicy: 'no-referrer'
            })
        ]);
        button.addEventListener('click', () => setActivePhoto(index));
        return button;
    });
    thumbs.append(...thumbButtons);

    function setActivePhoto(nextIndex) {
        activeIndex = (nextIndex + visiblePhotos.length) % visiblePhotos.length;
        mainImage.src = visiblePhotos[activeIndex];
        mainImage.alt = `${obj.title || 'Объект недвижимости'} — фото ${activeIndex + 1}`;
        counter.textContent = `${activeIndex + 1} / ${visiblePhotos.length}`;
        thumbButtons.forEach((button, index) => {
            const isActive = index === activeIndex;
            button.classList.toggle('is-active', isActive);
            button.setAttribute('aria-pressed', String(isActive));
        });
    }

    previousButton.addEventListener('click', () => setActivePhoto(activeIndex - 1));
    nextButton.addEventListener('click', () => setActivePhoto(activeIndex + 1));
    gallery.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowLeft') setActivePhoto(activeIndex - 1);
        if (event.key === 'ArrowRight') setActivePhoto(activeIndex + 1);
    });

    gallery.append(mainFrame, thumbs);

    return gallery;
}

function detailItem(label, value, className = '') {
    return el('div', { class: `object-detail-item${className ? ` ${className}` : ''}` }, [
        el('span', { class: 'object-detail-label' }, label),
        el('strong', { class: 'object-detail-value' }, String(value ?? '—'))
    ]);
}

function hasFieldDiff(obj, field) {
    return Array.isArray(obj.fieldDiffs) && obj.fieldDiffs.some((diff) => diff.field === field);
}

function diffClass(obj, ...fields) {
    return fields.some((field) => hasFieldDiff(obj, field)) ? 'is-diff-highlight' : '';
}

function normalizedDiffValue(value) {
    if (value === null || value === undefined || value === '') return '__empty__';
    const numericValue = Number(value);
    if (Number.isFinite(numericValue)) return `number:${numericValue}`;
    return `text:${String(value).trim().toLocaleLowerCase('ru-RU')}`;
}

function diffValueState(values, source) {
    const entries = Object.entries(values).filter(([, value]) => value !== undefined && value !== null && value !== '');
    if (entries.length < 2) return 'is-neutral';

    const counts = new Map();
    entries.forEach(([, value]) => {
        const key = normalizedDiffValue(value);
        counts.set(key, (counts.get(key) || 0) + 1);
    });

    const valueKey = normalizedDiffValue(values[source]);
    const maxCount = Math.max(...counts.values());
    return counts.get(valueKey) === maxCount && maxCount > 1
        ? 'is-consistent'
        : 'is-different';
}

function sourceStatusRow(source, label, present) {
    return el('div', { class: `object-source-row ${present ? 'is-present' : 'is-missing'}` }, [
        el('span', { class: 'object-source-logo' }, [sourceLogo(source)]),
        el('span', { class: 'object-source-name' }, label),
        el('span', { class: 'object-source-state' }, [
            el('span', { class: 'object-source-dot' }),
            present ? 'Найдено' : 'Нет записи'
        ])
    ]);
}

function renderObjectSources(obj) {
    return el('div', { class: 'object-source-list' }, [
        sourceStatusRow('site', 'Сайт ГермесГарант', obj.presence.site),
        sourceStatusRow('ilvo', 'ILVO CRM', obj.presence.ilvo),
        sourceStatusRow('kufar', 'Kufar', obj.presence.kufar)
    ]);
}

function renderObjectDiffs(obj) {
    if (!obj.fieldDiffs || !obj.fieldDiffs.length) {
        return el('div', { class: 'object-clean-state' }, [
            el('span', { class: 'object-clean-icon' }, [icon('check', 17)]),
            el('div', {}, [
                el('strong', {}, 'Расхождений не найдено'),
                el('span', {}, 'Значения по доступным источникам совпадают')
            ])
        ]);
    }

    return el('div', { class: 'object-diff-list' }, obj.fieldDiffs.map((d) =>
        el('div', { class: 'field-diff-card' }, [
            el('div', { class: 'field-name' }, [
                el('span', { class: 'object-diff-marker' }),
                d.label
            ]),
            el('div', { class: 'field-diff-values' }, ['site', 'ilvo', 'kufar'].map((src) =>
                d.values[src] !== undefined ? el('div', {
                    class: `fv ${diffValueState(d.values, src)}`,
                    title: diffValueState(d.values, src) === 'is-different'
                        ? 'Значение отличается от большинства источников'
                        : 'Значение совпадает с большинством источников'
                }, [
                    el('span', { class: 'src' }, src === 'site' ? 'Сайт' : src === 'ilvo' ? 'ILVO' : 'Kufar'),
                    el('strong', {}, [
                        diffValueState(d.values, src) === 'is-different'
                            ? el('span', { class: 'fv-alert-mark', 'aria-hidden': 'true' }, '!')
                            : null,
                        formatMoney(d.values[src], d.unit)
                    ])
                ]) : null
            )),
            el('span', { class: 'badge badge-warning' }, '\u26A0 Значения отличаются')
        ])
    ));
}

function showObjectDetail(obj) {
    const sourceCount = Object.values(obj.presence || {}).filter(Boolean).length;
    const price = formatObjectPrice(obj);
    const status = statusBadge(obj.status, obj.listingStatus, obj.listingStatusDate);
    const listingNote = obj.listingStatus === 'sold'
        ? `Снят с продажи${obj.listingStatusDate ? ` · ${formatShortDate(obj.listingStatusDate)}` : ''}`
        : obj.listingStatus === 'inactive' ? 'Неактивен в ILVO' : 'Активное размещение';

    const body = el('div', { class: 'object-detail-shell' }, [
        el('section', { class: 'object-detail-hero' }, [
            renderObjectPhotos(obj),
            el('div', { class: 'object-hero-summary' }, [
                el('div', { class: 'object-hero-topline' }, [
                    el('span', { class: 'object-eyebrow' }, `ОБЪЕКТ №${obj.objectNumber}`),
                    status
                ]),
                el('h2', { class: 'object-hero-title' }, obj.title || `Объект №${obj.objectNumber}`),
                el('div', { class: 'object-hero-location' }, [
                    icon('building', 16),
                    el('span', {}, [obj.city, obj.address].filter(Boolean).join(', ') || 'Адрес не указан')
                ]),
                el('div', { class: `object-hero-price ${diffClass(obj, 'price', 'priceUsd')}`.trim() }, [
                    el('strong', {}, price),
                    obj.price && obj.priceUsd
                        ? el('span', {}, formatMoney(obj.priceUsd, 'USD'))
                        : null
                ]),
                el('div', { class: 'object-quick-stats' }, [
                    detailItem('Площадь', formatMoney(obj.totalArea, 'м²'), diffClass(obj, 'totalArea')),
                    detailItem('Комнаты', obj.rooms || '—', diffClass(obj, 'rooms')),
                    detailItem('Этаж', obj.floor ? `${obj.floor} / ${obj.floors ?? '—'}` : '—', diffClass(obj, 'floor', 'floors'))
                ]),
                el('div', { class: 'object-hero-note' }, [
                    el('span', { class: 'object-hero-note-dot' }),
                    el('span', {}, listingNote)
                ])
            ])
        ]),
        el('div', { class: 'object-detail-content' }, [
            el('main', { class: 'object-detail-main' }, [
                el('section', { class: 'object-info-section object-diffs-section object-priority-section' }, [
                    el('div', { class: 'object-section-heading' }, [
                        el('div', {}, [
                            el('span', { class: 'object-section-kicker' }, 'Контроль качества'),
                            el('h3', {}, obj.fieldDiffs?.length ? `Расхождения · ${obj.fieldDiffs.length}` : 'Проверка данных')
                        ]),
                        obj.fieldDiffs?.length
                            ? el('span', { class: 'object-priority-badge' }, 'Требует внимания')
                            : el('span', { class: 'object-priority-badge is-clean' }, 'Проверено')
                    ]),
                    renderObjectDiffs(obj)
                ]),
                el('section', { class: 'object-info-section' }, [
                    el('div', { class: 'object-section-heading' }, [
                        el('div', {}, [
                            el('span', { class: 'object-section-kicker' }, 'Обзор'),
                            el('h3', {}, 'Характеристики объекта')
                        ]),
                        obj.dealType ? el('span', { class: 'object-deal-tag' }, obj.dealType) : null
                    ]),
                    el('div', { class: 'object-spec-grid' }, [
                        detailItem('Тип объекта', obj.type),
                        detailItem('Город', obj.city),
                        detailItem('Адрес', obj.address),
                        detailItem('Жилая площадь', formatMoney(obj.livingArea, 'м²'), diffClass(obj, 'livingArea')),
                        detailItem('Площадь кухни', formatMoney(obj.kitchenArea, 'м²'), diffClass(obj, 'kitchenArea')),
                        detailItem('Этажность', obj.floors ? `${obj.floors} этажей` : '—', diffClass(obj, 'floors')),
                        detailItem('Договор', obj.contractNumber || 'Не указан', obj.contractNumber ? '' : 'is-warning'),
                        detailItem('Размещение', listingNote)
                    ])
                ]),
            ]),
            el('aside', { class: 'object-detail-aside' }, [
                el('section', { class: 'object-aside-card object-source-card' }, [
                    el('div', { class: 'object-aside-heading' }, [
                        el('span', { class: 'object-aside-icon' }, [icon('database', 17)]),
                        el('div', {}, [
                            el('h3', {}, 'Синхронизация'),
                            el('span', {}, `${sourceCount} из 3 источников`)
                        ])
                    ]),
                    renderObjectSources(obj)
                ]),
                el('section', { class: 'object-aside-card object-match-card' }, [
                    el('div', { class: 'object-aside-heading' }, [
                        el('span', { class: 'object-aside-icon' }, [icon('shield', 17)]),
                        el('div', {}, [
                            el('h3', {}, 'Идентификация'),
                            el('span', {}, 'Как объединены записи')
                        ])
                    ]),
                    matchBasis(obj),
                    el('p', { class: 'object-aside-note' }, 'Система использует номер договора и адрес, чтобы сопоставить один объект в разных источниках.')
                ]),
                el('section', { class: 'object-aside-card object-contract-card' }, [
                    el('span', { class: 'object-section-kicker' }, 'Номер договора'),
                    el('strong', { class: 'object-contract-number' }, obj.contractNumber || 'Не указан'),
                    obj.contractForms ? el('div', { class: 'object-contract-forms' },
                        Object.entries(obj.contractForms)
                            .filter(([, value]) => value)
                            .map(([source, value]) => el('span', {}, `${source === 'site' ? 'Сайт' : source === 'ilvo' ? 'ILVO' : 'Kufar'}: ${value}`))
                    ) : null
                ])
            ])
        ])
    ]);

    openModal({
        title: `Объект №${obj.objectNumber}`,
        body: [body],
        footer: [
            el('button', { class: 'btn btn-secondary', type: 'button', onclick: closeModal }, [
                icon('arrowRight', 15),
                'Закрыть карточку'
            ])
        ],
        className: 'object-modal'
    });
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
                { key: 'contractNumber', label: 'Договор', render: (o) => o.contractNumber || '—' },
                { key: 'site', label: 'Сайт', sortValue: (o) => o.presence.site, render: (o) => presenceChip(o.presence.site) },
                { key: 'ilvo', label: 'ILVO', sortValue: (o) => o.presence.ilvo, render: (o) => presenceChip(o.presence.ilvo) },
                { key: 'kufar', label: 'Kufar', sortValue: (o) => o.presence.kufar, render: (o) => presenceChip(o.presence.kufar) },
                { key: 'status', label: 'Статус', render: (o) => statusBadge(o.status, o.listingStatus, o.listingStatusDate) }
            ],
            rows,
            searchFields: ['objectNumber', 'title', 'city', 'address', 'contractNumber'],
            emptyText: 'Объекты не найдены',
            tableClassName: 'data-table--objects',
            onRowClick: showObjectDetail,
            rowLabel: (o) => `Открыть объект ${o.objectNumber || o.title || ''}`.trim()
        }));
    }

    draw();
}
