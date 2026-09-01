import { el, formatMoney, formatNumber, icon } from '../format.js';
import { store } from '../state.js';
import { renderDataTable } from '../components/table.js';
import { closeModal, openModal } from '../components/modal.js';

const SEVERITY_LABEL = { critical: 'Критическая', warning: 'Предупреждение', info: 'Информационная' };
const SOURCE_LABELS = { site: 'Сайт', ilvo: 'ILVO', kufar: 'Kufar' };
const MATCHING_LABELS = {
    contract: 'По номеру договора',
    address_price: 'По адресу и цене',
    address: 'По адресу',
    descriptor: 'По цене и параметрам',
    none: 'Без совпадения'
};
const ERROR_FIELDS = {
    'Разная цена': ['price', 'priceUsd'],
    'Разная площадь': ['totalArea', 'livingArea', 'kitchenArea'],
    'Разный адрес': ['address'],
    'Разное количество комнат': ['rooms'],
    'Разный тип объекта': ['type'],
    'Разный тип сделки': ['dealType'],
    'Разный этаж': ['floor'],
    'Разная этажность': ['floors'],
    // Отдельные ошибки по типу объекта, сделке и этажности показывают
    // значения каждого источника непосредственно в карточке ошибки.
    'Другие несоответствия': ['type', 'dealType', 'floor', 'floors']
};

function targetLabel(error, report) {
    return error.targetType === 'contract'
        ? `Договор ${error.target || '—'}`
        : `Договор ${findErrorObject(error, report)?.contractNumber || 'не указан'}`;
}

function severityBadge(sev) {
    if (sev === 'critical') return el('span', { class: 'badge badge-danger' }, SEVERITY_LABEL[sev]);
    if (sev === 'warning') return el('span', { class: 'badge badge-warning' }, SEVERITY_LABEL[sev]);
    return el('span', { class: 'badge badge-neutral' }, SEVERITY_LABEL[sev]);
}

function hasValue(value) {
    return value !== null && value !== undefined && value !== '';
}

function formatFieldValue(value, field) {
    if (!hasValue(value)) return 'Нет данных';
    if (field === 'price') return formatMoney(value, 'BYN');
    if (field === 'priceUsd') return formatMoney(value, 'USD');
    if (['totalArea', 'livingArea', 'kitchenArea'].includes(field)) return formatNumber(value, 'м²');
    return String(value);
}

function normalizedComparisonValue(value) {
    if (!hasValue(value)) return '__empty__';
    const numericValue = Number(String(value).replace(',', '.'));
    if (Number.isFinite(numericValue)) return `number:${numericValue}`;
    return `text:${String(value).trim().toLocaleLowerCase('ru-RU')}`;
}

function comparisonValueState(values, source, field) {
    const entries = Object.entries(values).filter(([, value]) => hasValue(value));
    if (entries.length < 2) return 'is-neutral';

    const currentKey = normalizedComparisonValue(values[source]);
    if (['price', 'priceUsd'].includes(field) && hasValue(values.ilvo)) {
        if (source === 'ilvo') return 'is-reference';
        return currentKey === normalizedComparisonValue(values.ilvo) ? 'is-consistent' : 'is-different';
    }

    const counts = new Map();
    entries.forEach(([, value]) => {
        const key = normalizedComparisonValue(value);
        counts.set(key, (counts.get(key) || 0) + 1);
    });
    const maxCount = Math.max(...counts.values());
    return counts.get(currentKey) === maxCount && maxCount > 1 ? 'is-consistent' : 'is-different';
}

function findErrorObject(error, report) {
    if (!report || error.targetType === 'contract') return null;
    const objects = report.objects || [];
    const byNumber = objects.find((object) => String(object.objectNumber) === String(error.target));
    if (byNumber) return byNumber;
    const index = Number(error.target) - 1;
    return Number.isInteger(index) && index >= 0 ? objects[index] || null : null;
}

function findErrorContract(error, report) {
    if (!report || error.targetType !== 'contract') return null;
    return (report.contracts || []).find((contract) => (
        String(contract.number ?? contract.key) === String(error.target)
    )) || null;
}

function detailMeta(label, value) {
    return el('div', { class: 'error-detail-meta-item' }, [
        el('div', { class: 'text-secondary' }, label),
        el('div', { class: 'error-detail-meta-value' }, String(value ?? '—'))
    ]);
}

function detailSection(title, content, className = '') {
    return el('section', { class: `error-detail-section${className ? ` ${className}` : ''}` }, [
        el('h4', {}, title),
        content
    ]);
}

function comparisonBlock(diff) {
    const values = diff.values || {};
    const isPrice = ['price', 'priceUsd'].includes(diff.field);
    const sourceOrder = isPrice ? ['ilvo', 'site', 'kufar'] : ['site', 'ilvo', 'kufar'];
    const rows = sourceOrder
        .filter((source) => Object.prototype.hasOwnProperty.call(values, source))
        .map((source) => {
            const valueState = comparisonValueState(values, source, diff.field);
            return el('div', { class: `error-value-row ${valueState}` }, [
            el('span', { class: 'error-value-source' }, SOURCE_LABELS[source]),
            el('span', { class: 'error-value-value' }, [
                valueState === 'is-different'
                    ? el('span', { class: 'error-value-alert', 'aria-hidden': 'true' }, '!')
                    : null,
                formatFieldValue(values[source], diff.field)
            ]),
            valueState === 'is-reference'
                ? el('span', { class: 'badge badge-success error-reference-badge' }, 'Эталон ILVO')
                : null
            ]);
        });

    return el('div', { class: 'error-comparison-block' }, [
        el('div', { class: 'error-comparison-title' }, [
            el('span', {}, diff.label),
            el('span', { class: 'error-comparison-hint' }, isPrice ? 'ILVO — эталон' : 'сравнение источников')
        ]),
        el('div', { class: 'error-value-list' }, rows)
    ]);
}

function sourcePresence(object) {
    return el('div', { class: 'error-source-list' }, ['site', 'ilvo', 'kufar'].map((source) => {
        const present = object.presence && object.presence[source];
        return el('div', { class: `error-source-row ${present ? 'is-present' : 'is-missing'}` }, [
            el('span', { class: 'error-source-mark' }, [icon(present ? 'check' : 'errorCircle', 14)]),
            el('span', {}, SOURCE_LABELS[source]),
            el('span', { class: 'text-secondary' }, present ? 'Запись найдена' : 'Запись отсутствует')
        ]);
    }));
}

function contractForms(object) {
    const forms = object && object.contractForms ? object.contractForms : {};
    return el('div', { class: 'error-value-list' }, ['site', 'ilvo', 'kufar'].map((source) =>
        el('div', { class: 'error-value-row' }, [
            el('span', { class: 'error-value-source' }, SOURCE_LABELS[source]),
            el('span', { class: 'error-value-value' }, hasValue(forms[source]) ? String(forms[source]) : 'Нет номера')
        ])
    ));
}

function errorReason(error) {
    const reasons = {
        'Разная цена': 'ILVO является эталонным источником цены. Ошибка появляется, если цена на сайте или в Kufar отличается от цены в ILVO больше допустимой погрешности.',
        'Разная площадь': 'В карточках одного объекта указана разная площадь. Из-за этого данные об объекте нельзя считать одинаковыми.',
        'Разный адрес': 'Адреса источников не удалось признать одним и тем же адресом после нормализации.',
        'Разное количество комнат': 'Количество комнат в источниках различается.',
        'Разный тип объекта': 'Тип недвижимости в источниках различается.',
        'Разный тип сделки': 'Тип сделки различается между источниками. Сравниваются только явно переданные значения; пустое поле не считается ошибкой.',
        'Разный этаж': 'Этаж объекта в источниках различается.',
        'Разная этажность': 'Количество этажей в источниках различается.',
        'Объект отсутствует на сайте': 'Объект найден в другом источнике, но для него нет соответствующей записи на сайте.',
        'Объект отсутствует в ILVO': 'Объект найден в другом источнике, но для него нет записи в эталонном источнике ILVO.',
        'Объект отсутствует в Kufar': 'Объект найден на сайте или в ILVO, но для него нет соответствующей записи в Kufar.',
        'Нет договора': 'У объекта нет распознанного номера договора ни в одном из загруженных источников.',
        'Разные данные договора': 'Один и тот же объект связан с разными номерами договоров в источниках.',
        'Разные разделители номера договора': 'Смысл номера договора совпадает, но в источниках используются разные разделители, например «41/1» и «41-1».',
        'Дубликат договора': 'Один номер договора связан с несколькими объектами или повторяется среди бесхозных записей.',
        'Договор без объекта': 'Номер договора найден в реестре, но его нельзя связать ни с одним объектом.',
        'Другие несоответствия': 'Одно из сравнительных полей объекта отличается между источниками. Сверьте значения ниже и исправьте источник, в котором указана неверная информация.',
    };
    return reasons[error.type] || error.description || 'Проверка обнаружила несоответствие данных.';
}

function errorAction(error) {
    if (['Разная цена', 'Разная площадь', 'Разный адрес', 'Разное количество комнат'].includes(error.type)) {
        return 'Проверьте данные в указанном источнике, исправьте запись, затем повторно импортируйте файл и запустите проверку.';
    }
    if (error.type === 'Разные разделители номера договора') {
        return 'Приведите запись номера договора к единому формату в исходном файле и повторно загрузите его.';
    }
    if (error.type === 'Нет договора') {
        return 'Добавьте номер договора хотя бы в один источник и повторно запустите проверку.';
    }
    if (error.type === 'Дубликат договора' || error.type === 'Договор без объекта') {
        return 'Проверьте реестр договоров и привязку номера к объекту в исходных данных.';
    }
    if (error.type.startsWith('Объект отсутствует')) {
        return 'Проверьте, нужно ли добавить объект в этот источник, затем повторно импортируйте его данные.';
    }
    return 'Проверьте исходные данные и повторно запустите проверку после исправления.';
}

function errorColumns(report, includeType = true) {
    const columns = [
        { key: 'description', label: 'Описание' },
        { key: 'target', label: 'Объект / Договор', render: (error) => targetLabel(error, report) },
        { key: 'source', label: 'Источник' },
        { key: 'date', label: 'Дата проверки' },
        { key: 'severity', label: 'Важность', render: (e) => severityBadge(e.severity) },
        {
            key: 'status',
            label: 'Статус',
            render: (error) => error.status === 'open'
                ? el('button', {
                    class: 'badge badge-neutral error-status-trigger',
                    title: 'Открыть пояснение ошибки',
                    'aria-label': 'Открыть пояснение ошибки',
                    onclick: () => openErrorDetails(error, report)
                }, 'Открыта')
                : el('span', { class: 'badge badge-success' }, 'Исправлена')
        }
    ];
    if (includeType) columns.unshift({ key: 'type', label: 'Тип' });
    return columns;
}

function openErrorDetails(error, report) {
    const object = findErrorObject(error, report);
    const contract = findErrorContract(error, report);
    const fieldKeys = ERROR_FIELDS[error.type] || [];
    const diffs = object
        ? (object.fieldDiffs || []).filter((diff) => fieldKeys.includes(diff.field))
        : [];
    const body = [
        el('div', { class: 'error-detail-heading' }, [
            severityBadge(error.severity),
            el('span', { class: 'error-detail-type' }, error.type)
        ]),
        el('div', { class: 'error-detail-summary' }, error.description || errorReason(error)),
        el('div', { class: 'error-detail-meta' }, [
            detailMeta('Где обнаружено', error.source || '—'),
            detailMeta('Дата проверки', error.date || '—'),
            detailMeta('Статус', error.status === 'open' ? 'Открыта' : 'Исправлена'),
            detailMeta('Объект / договор', targetLabel(error, report))
        ])
    ];

    if (object) {
        body.push(detailSection('Объект', el('div', { class: 'error-detail-meta' }, [
            detailMeta('Название', object.title || '—'),
            detailMeta('Номер договора', object.contractNumber || 'Нет номера'),
            detailMeta('Сопоставление', MATCHING_LABELS[object.matchedBy] || '—'),
            detailMeta('Присутствие', `${Object.values(object.presence || {}).filter(Boolean).length} из 3 источников`)
        ])));
    } else if (contract) {
        body.push(detailSection('Договор', el('div', { class: 'error-detail-meta' }, [
            detailMeta('Номер', contract.number || contract.key || '—'),
            detailMeta('Дата', contract.date || '—'),
            detailMeta('Объект', contract.objectId || 'Не привязан')
        ])));
    }

    if (diffs.length) {
        body.push(detailSection(
            'Какие данные расходятся',
            el('div', { class: 'error-comparison-list' }, diffs.map(comparisonBlock))
        ));
    }

    if (error.type === 'Объект отсутствует на сайте'
        || error.type === 'Объект отсутствует в ILVO'
        || error.type === 'Объект отсутствует в Kufar') {
        body.push(detailSection('Наличие записи по источникам', sourcePresence(object)));
    }

    if (error.type === 'Разные данные договора'
        || error.type === 'Разные разделители номера договора'
        || error.type === 'Нет договора') {
        body.push(detailSection('Номера договора по источникам', contractForms(object)));
    }

    body.push(detailSection('Почему это ошибка', el('p', { class: 'error-detail-text' }, errorReason(error))));
    body.push(detailSection('Что исправить', el('p', { class: 'error-detail-text' }, errorAction(error)), 'error-detail-recommendation'));

    openModal({
        title: 'Подробности ошибки',
        kicker: 'Центр ошибок',
        body,
        footer: [el('button', { class: 'btn btn-primary', onclick: closeModal }, 'Понятно')],
        width: '720px',
        className: 'error-modal'
    });
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
    let viewMode = 'grouped';
    let query = '';
    const tabs = el('div', { class: 'errors-tabs' }, [
        el('span', { class: 'filter-chip active', onclick: (e) => setTab('all', e) }, `Все (${errors.length})`),
        el('span', { class: 'filter-chip', onclick: (e) => setTab('critical', e) }, `Критические (${errors.filter((x) => x.severity === 'critical').length})`),
        el('span', { class: 'filter-chip', onclick: (e) => setTab('warning', e) }, `Предупреждения (${errors.filter((x) => x.severity === 'warning').length})`),
        el('span', { class: 'filter-chip', onclick: (e) => setTab('info', e) }, `Информационные (${errors.filter((x) => x.severity === 'info').length})`)
    ]);

    const viewControls = el('div', { class: 'errors-view-controls' }, [
        el('span', { class: 'errors-view-label' }, 'Показывать:'),
        el('button', {
            type: 'button',
            class: 'filter-chip errors-view-mode active',
            'aria-pressed': 'true',
            onclick: (e) => setViewMode('grouped', e)
        }, 'По типу'),
        el('button', {
            type: 'button',
            class: 'filter-chip errors-view-mode',
            'aria-pressed': 'false',
            onclick: (e) => setViewMode('list', e)
        }, 'Единым списком')
    ]);
    const searchInput = el('input', {
        class: 'search-input errors-search-input',
        placeholder: 'Поиск по ошибкам...',
        oninput: (e) => { query = e.target.value.toLowerCase(); draw(); }
    });
    const tableHolder = el('div');
    container.appendChild(el('div', { class: 'card card-pad' }, [
        tabs,
        viewControls,
        el('div', { class: 'errors-search' }, [searchInput]),
        tableHolder
    ]));

    function setTab(t, e) {
        activeTab = t;
        tabs.querySelectorAll('.filter-chip').forEach((c) => c.classList.remove('active'));
        e.currentTarget.classList.add('active');
        draw();
    }

    function setViewMode(mode, e) {
        viewMode = mode;
        viewControls.querySelectorAll('.errors-view-mode').forEach((button) => {
            const isActive = button === e.currentTarget;
            button.classList.toggle('active', isActive);
            button.setAttribute('aria-pressed', String(isActive));
        });
        draw();
    }

    function matchesQuery(error) {
        if (!query) return true;
        return [
            error.type,
            error.description,
            error.target,
            targetLabel(error, report),
            error.source,
            error.date,
            error.status
        ].some((value) => String(value ?? '').toLowerCase().includes(query));
    }

    function groupedRows(rows) {
        const groups = new Map();
        rows.forEach((error) => {
            const type = error.type || 'Другие ошибки';
            if (!groups.has(type)) groups.set(type, []);
            groups.get(type).push(error);
        });
        return Array.from(groups.entries())
            .sort(([first], [second]) => first.localeCompare(second, 'ru'))
            .map(([type, groupRows]) => el('section', { class: 'error-group' }, [
                el('div', { class: 'error-group-header' }, [
                    el('div', { class: 'error-group-title' }, type),
                    el('span', { class: 'badge badge-neutral' }, `${groupRows.length}`)
                ]),
                renderDataTable({
                    columns: errorColumns(report, false),
                    rows: groupRows,
                    pageSize: 50,
                    emptyText: 'Ошибок не найдено'
                })
            ]));
    }

    function draw() {
        let rows = errors;
        if (activeTab !== 'all') rows = rows.filter((x) => x.severity === activeTab);
        rows = rows.filter(matchesQuery);
        tableHolder.innerHTML = '';
        if (viewMode === 'grouped') {
            const groups = groupedRows(rows);
            tableHolder.appendChild(el('div', { class: 'error-groups' }, groups.length
                ? groups
                : [el('div', { class: 'table-empty' }, 'Ошибок не найдено')]));
        } else {
            tableHolder.appendChild(renderDataTable({
                columns: errorColumns(report),
                rows,
                pageSize: 50,
                emptyText: 'Ошибок не найдено'
            }));
        }
    }

    draw();
}
