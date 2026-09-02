'use strict';

const fs = require('fs');
const dayjs = require('dayjs');
const XLSX = require('xlsx');
const JSZip = require('jszip');
const XLSXChart = require('xlsx-chart');

const REPORT_LABELS = {
    missing: 'Отчёт по отсутствующим объектам',
    contracts: 'Отчёт по договорам',
    errors: 'Отчёт по ошибкам',
    diffs: 'Отчёт по расхождениям данных',
    full: 'Полный отчёт'
};

const SOURCE_LABELS = {
    site: 'Сайт',
    ilvo: 'ILVO',
    kufar: 'Kufar'
};

const SOURCE_KEYS = Object.keys(SOURCE_LABELS);

const STATUS_LABELS = {
    active: 'Активен',
    inactive: 'Неактивен в ILVO',
    sold: 'Снят с продажи',
    ok: 'ОК',
    missing: 'Неполное покрытие',
    mismatch: 'Расхождение',
    open: 'Открыта',
    fixed: 'Исправлена'
};

const SEVERITY_LABELS = {
    critical: 'Критическая',
    warning: 'Предупреждение',
    info: 'Информационная'
};

const MATCHING_LABELS = {
    contract: 'По номеру договора',
    address_price: 'По адресу и цене',
    address: 'По адресу',
    descriptor: 'По цене и параметрам',
    none: 'Без совпадения'
};

const OBJECT_REPORT_COLUMNS = [
    '№ объекта', 'ID группы', 'Объект', 'Тип', 'Тип сделки', 'Город', 'Адрес',
    'Цена, BYN', 'Цена, USD', 'Общая площадь, м²', 'Жилая площадь, м²',
    'Площадь кухни, м²', 'Комнат', 'Этаж', 'Этажность', 'Номер договора',
    'Статус размещения', 'Дата снятия / деактивации', 'Есть на сайте',
    'Есть в ILVO', 'Есть в Kufar', 'Источники', 'Метод сопоставления',
    'Уверенность сопоставления', 'Статус данных', 'Количество расхождений',
    'Количество ошибок'
];

const REPORT_COLUMNS = {
    missing: [
        ...OBJECT_REPORT_COLUMNS,
        'Отсутствует в источниках', 'Причина включения'
    ],
    contracts: [
        'Номер договора', 'Дата договора', '№ объекта', 'Объект', 'Город',
        'Адрес', 'Тип', 'Тип сделки', 'Цена, BYN', 'Статус размещения',
        'Форма на сайте', 'Форма в ILVO', 'Форма в Kufar',
        'Статус договора', 'Проблема'
    ],
    errors: [
        'ID ошибки', 'Тип', 'Важность', 'Статус', '№ объекта', 'Объект',
        'Город', 'Адрес', 'Номер договора', 'Объект / договор', 'Источник',
        'Дата проверки', 'Описание', 'Значение — Сайт', 'Значение — ILVO',
        'Значение — Kufar', 'Что проверить'
    ],
    diffs: [
        '№ объекта', 'Объект', 'Город', 'Адрес', 'Номер договора', 'Поле',
        'Единица', 'Значение — Сайт', 'Значение — ILVO', 'Значение — Kufar',
        'Эталон для цены', 'Статус проверки'
    ],
    full: OBJECT_REPORT_COLUMNS
};

const COLUMN_WIDTHS = {
    '№ объекта': 12,
    'ID группы': 18,
    Объект: 34,
    Тип: 18,
    'Тип сделки': 16,
    Город: 16,
    Адрес: 34,
    'Цена, BYN': 15,
    'Цена, USD': 15,
    'Общая площадь, м²': 19,
    'Жилая площадь, м²': 19,
    'Площадь кухни, м²': 19,
    'Комнат': 10,
    'Этаж': 10,
    'Этажность': 12,
    'Номер договора': 18,
    'Дата договора': 16,
    'Статус размещения': 20,
    'Дата снятия / деактивации': 24,
    'Есть на сайте': 16,
    'Есть в ILVO': 16,
    'Есть в Kufar': 16,
    'Источники': 28,
    'Метод сопоставления': 24,
    'Уверенность сопоставления': 22,
    'Статус данных': 20,
    'Количество расхождений': 22,
    'Количество ошибок': 18,
    'Описание': 55,
    'Значение — Сайт': 28,
    'Значение — ILVO': 28,
    'Значение — Kufar': 28,
    'Что проверить': 55
};

const STYLES = {
    title: {
        font: { bold: true, color: 'FFFFFF', sz: 16 },
        fill: { fgColor: { rgb: '155945' } },
        alignment: { vertical: 'center' }
    },
    subtitle: {
        font: { italic: true, color: '52645D', sz: 10 },
        alignment: { wrapText: true, vertical: 'center' }
    },
    header: {
        font: { bold: true, color: 'FFFFFF' },
        fill: { fgColor: { rgb: '287A61' } },
        alignment: { wrapText: true, vertical: 'center', horizontal: 'center' },
        border: {
            top: { style: 'thin', color: { rgb: '155945' } },
            bottom: { style: 'thin', color: { rgb: '155945' } }
        }
    },
    section: {
        font: { bold: true, color: '155945', sz: 12 },
        fill: { fgColor: { rgb: 'E6F0EB' } }
    },
    label: {
        font: { bold: true, color: '34463F' },
        fill: { fgColor: { rgb: 'F2F6F3' } }
    },
    warning: {
        fill: { fgColor: { rgb: 'FFF4D6' } }
    },
    danger: {
        fill: { fgColor: { rgb: 'FDE5E5' } }
    }
};

function valueOrDash(value) {
    return value === null || value === undefined || value === '' ? '—' : value;
}

function formatDate(value) {
    if (!value) return '—';
    const parsed = dayjs(value);
    return parsed.isValid() ? parsed.format('DD.MM.YYYY') : String(value);
}

function formatDateTime(value) {
    if (!value) return '—';
    const parsed = dayjs(value);
    return parsed.isValid() ? parsed.format('DD.MM.YYYY HH:mm') : String(value);
}

function formatNumber(value, digits = 1) {
    if (value === null || value === undefined || value === '') return '—';
    const number = Number(value);
    if (!Number.isFinite(number)) return String(value);
    return number.toLocaleString('ru-RU', { maximumFractionDigits: digits });
}

function formatMoney(value, currency) {
    if (value === null || value === undefined || value === '') return '—';
    const number = Number(value);
    if (!Number.isFinite(number)) return String(value);
    return `${number.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ${currency}`;
}

function presenceLabel(value) {
    return value ? 'Есть' : 'Нет';
}

function listingStatusLabel(value) {
    return STATUS_LABELS[value] || valueOrDash(value);
}

function objectStatusLabel(value) {
    return STATUS_LABELS[value] || valueOrDash(value);
}

function errorSeverityLabel(value) {
    return SEVERITY_LABELS[value] || valueOrDash(value);
}

function matchingLabel(value) {
    return MATCHING_LABELS[value] || valueOrDash(value);
}

function confidenceLabel(value) {
    return {
        strong: 'Высокая',
        review: 'Требует проверки',
        none: 'Нет совпадения'
    }[value] || valueOrDash(value);
}

function objectSourceSummary(object) {
    return SOURCE_KEYS
        .filter((source) => object?.presence?.[source])
        .map((source) => SOURCE_LABELS[source])
        .join(', ') || 'Нет источников';
}

function missingSourceSummary(object) {
    return SOURCE_KEYS
        .filter((source) => !object?.presence?.[source])
        .map((source) => SOURCE_LABELS[source])
        .join(', ') || '—';
}

function statusForObject(object) {
    return objectStatusLabel(object?.status);
}

function findErrorObject(error, objectsByNumber) {
    if (!error || error.targetType === 'contract') return null;
    return objectsByNumber.get(String(error.target)) || null;
}

function findErrorContract(error, contractsByNumber) {
    if (!error || error.targetType !== 'contract') return null;
    return contractsByNumber.get(String(error.target)) || null;
}

function contractIssue(contract, object, contractsByNumber) {
    if (!contract || contract.duplicate) return contract?.duplicate ? 'Дубликат номера' : null;
    if (!object) return 'Договор без объекта';
    const related = contractsByNumber.get(String(contract.number));
    if (related?.duplicate) return 'Дубликат номера';
    return null;
}

function errorAction(error) {
    if (!error) return 'Проверьте исходные данные и повторите проверку.';
    if (['Разная цена', 'Разная площадь', 'Разный адрес', 'Разное количество комнат'].includes(error.type)) {
        return 'Сверьте значения источников и исправьте запись с неверным значением.';
    }
    if (error.type === 'Разные разделители номера договора') {
        return 'Приведите номер договора к единому формату в исходном файле.';
    }
    if (error.type === 'Нет договора') {
        return 'Добавьте номер договора хотя бы в один источник.';
    }
    if (error.type === 'Дубликат договора' || error.type === 'Договор без объекта') {
        return 'Проверьте номер договора и его привязку к объекту.';
    }
    if (error.type?.startsWith('Объект отсутствует')) {
        return 'Проверьте, нужно ли добавить объект в указанный источник.';
    }
    return 'Проверьте исходные данные и повторите проверку.';
}

function objectColumns(object, errorCounts) {
    return {
        '№ объекта': valueOrDash(object.objectNumber),
        'ID группы': valueOrDash(object.id),
        Объект: valueOrDash(object.title),
        Тип: valueOrDash(object.type),
        'Тип сделки': valueOrDash(object.dealType),
        Город: valueOrDash(object.city),
        Адрес: valueOrDash(object.address),
        'Цена, BYN': object.price ?? '—',
        'Цена, USD': object.priceUsd ?? '—',
        'Общая площадь, м²': object.totalArea ?? '—',
        'Жилая площадь, м²': object.livingArea ?? '—',
        'Площадь кухни, м²': object.kitchenArea ?? '—',
        Комнат: object.rooms ?? '—',
        Этаж: object.floor ?? '—',
        Этажность: object.floors ?? '—',
        'Номер договора': valueOrDash(object.contractNumber),
        'Статус размещения': listingStatusLabel(object.listingStatus),
        'Дата снятия / деактивации': formatDate(object.listingStatusDate),
        'Есть на сайте': presenceLabel(object.presence?.site),
        'Есть в ILVO': presenceLabel(object.presence?.ilvo),
        'Есть в Kufar': presenceLabel(object.presence?.kufar),
        Источники: objectSourceSummary(object),
        'Метод сопоставления': matchingLabel(object.matchedBy),
        'Уверенность сопоставления': confidenceLabel(object.matchConfidence),
        'Статус данных': statusForObject(object),
        'Количество расхождений': object.fieldDiffs?.length || 0,
        'Количество ошибок': errorCounts.get(String(object.objectNumber)) || 0
    };
}

function buildRows(reportType, report) {
    const objects = report?.objects || [];
    const errors = report?.errors || [];
    const contracts = report?.contracts || [];
    const objectsByNumber = new Map(objects.map((object) => [String(object.objectNumber), object]));
    const objectsById = new Map(objects.map((object) => [String(object.id), object]));
    const contractsByNumber = new Map(contracts.map((contract) => [String(contract.number ?? contract.key), contract]));
    const errorCounts = new Map();
    errors.forEach((error) => {
        if (error.targetType !== 'contract') {
            const key = String(error.target);
            errorCounts.set(key, (errorCounts.get(key) || 0) + 1);
        }
    });

    switch (reportType) {
        case 'missing':
            return objects
                .filter((object) => object.status === 'missing')
                .map((object) => ({
                    ...objectColumns(object, errorCounts),
                    'Отсутствует в источниках': missingSourceSummary(object),
                    'Причина включения': object.listingStatus === 'sold'
                        ? 'Снят с продажи'
                        : 'Карточка есть не во всех источниках'
                }));

        case 'contracts':
            return contracts.map((contract) => {
                const object = contract.objectId ? objectsById.get(String(contract.objectId)) : null;
                const issue = contractIssue(contract, object, contractsByNumber);
                return {
                    'Номер договора': valueOrDash(contract.number || contract.key),
                    'Дата договора': formatDate(contract.date),
                    '№ объекта': object ? valueOrDash(object.objectNumber) : '—',
                    Объект: object ? valueOrDash(object.title) : 'Не привязан',
                    Город: object ? valueOrDash(object.city) : '—',
                    Адрес: object ? valueOrDash(object.address) : '—',
                    Тип: object ? valueOrDash(object.type) : '—',
                    'Тип сделки': object ? valueOrDash(object.dealType) : '—',
                    'Цена, BYN': object?.price ?? '—',
                    'Статус размещения': object ? listingStatusLabel(object.listingStatus) : '—',
                    'Форма на сайте': valueOrDash(object?.contractForms?.site),
                    'Форма в ILVO': valueOrDash(object?.contractForms?.ilvo),
                    'Форма в Kufar': valueOrDash(object?.contractForms?.kufar),
                    'Статус договора': issue || 'ОК',
                    Проблема: issue || '—'
                };
            });

        case 'errors':
            return errors.map((error) => {
                const object = findErrorObject(error, objectsByNumber);
                const contract = findErrorContract(error, contractsByNumber);
                const diff = object?.fieldDiffs?.find((item) => (
                    error.type.toLocaleLowerCase('ru-RU').includes(String(item.label).toLocaleLowerCase('ru-RU'))
                    || error.type === 'Другие несоответствия'
                ));
                return {
                    'ID ошибки': valueOrDash(error.id),
                    Тип: valueOrDash(error.type),
                    Важность: errorSeverityLabel(error.severity),
                    Статус: STATUS_LABELS[error.status] || valueOrDash(error.status),
                    '№ объекта': object ? valueOrDash(object.objectNumber) : '—',
                    Объект: object ? valueOrDash(object.title) : '—',
                    Город: object ? valueOrDash(object.city) : '—',
                    Адрес: object ? valueOrDash(object.address) : '—',
                    'Номер договора': object
                        ? valueOrDash(object.contractNumber)
                        : (contract ? valueOrDash(contract.number) : '—'),
                    'Объект / договор': error.targetType === 'contract'
                        ? `Договор ${error.target || '—'}`
                        : `Объект №${error.target || '—'}`,
                    Источник: valueOrDash(error.source),
                    'Дата проверки': formatDate(error.date),
                    Описание: valueOrDash(error.description),
                    'Значение — Сайт': valueOrDash(diff?.values?.site),
                    'Значение — ILVO': valueOrDash(diff?.values?.ilvo),
                    'Значение — Kufar': valueOrDash(diff?.values?.kufar),
                    'Что проверить': errorAction(error)
                };
            });

        case 'diffs':
            return objects
                .filter((object) => object.fieldDiffs?.length)
                .flatMap((object) => object.fieldDiffs.map((diff) => ({
                    '№ объекта': valueOrDash(object.objectNumber),
                    Объект: valueOrDash(object.title),
                    Город: valueOrDash(object.city),
                    Адрес: valueOrDash(object.address),
                    'Номер договора': valueOrDash(object.contractNumber),
                    Поле: valueOrDash(diff.label),
                    Единица: valueOrDash(diff.unit),
                    'Значение — Сайт': valueOrDash(diff.values?.site),
                    'Значение — ILVO': valueOrDash(diff.values?.ilvo),
                    'Значение — Kufar': valueOrDash(diff.values?.kufar),
                    'Эталон для цены': ['price', 'priceUsd'].includes(diff.field) ? 'ILVO' : '—',
                    'Статус проверки': 'Требует проверки'
                })));

        case 'full':
        default:
            return objects.map((object) => objectColumns(object, errorCounts));
    }
}

function reportSpecificSummary(reportType, rows, report) {
    const objects = report?.objects || [];
    const errors = report?.errors || [];
    const contracts = report?.contracts || [];
    if (reportType === 'missing') {
        return [
            ['Проверяемый показатель', 'Количество'],
            ['Отсутствуют на сайте', rows.filter((row) => String(row['Отсутствует в источниках']).includes('Сайт')).length],
            ['Отсутствуют в ILVO', rows.filter((row) => String(row['Отсутствует в источниках']).includes('ILVO')).length],
            ['Отсутствуют в Kufar', rows.filter((row) => String(row['Отсутствует в источниках']).includes('Kufar')).length]
        ];
    }
    if (reportType === 'contracts') {
        return [
            ['Проверяемый показатель', 'Количество'],
            ['Всего договоров', contracts.length],
            ['Привязаны к объектам', rows.filter((row) => row['№ объекта'] !== '—').length],
            ['Без объекта', rows.filter((row) => row['Статус договора'] === 'Договор без объекта').length],
            ['Дубликаты номеров', rows.filter((row) => row['Статус договора'] === 'Дубликат номера').length]
        ];
    }
    if (reportType === 'errors') {
        return [
            ['Проверяемый показатель', 'Количество'],
            ['Критические', errors.filter((error) => error.severity === 'critical').length],
            ['Предупреждения', errors.filter((error) => error.severity === 'warning').length],
            ['Информационные', errors.filter((error) => error.severity === 'info').length],
            ['Открытые', errors.filter((error) => error.status === 'open').length]
        ];
    }
    if (reportType === 'diffs') {
        const byField = new Map();
        rows.forEach((row) => {
            const field = String(row.Поле);
            byField.set(field, (byField.get(field) || 0) + 1);
        });
        return [
            ['Поле с расхождением', 'Количество'],
            ...[...byField.entries()].sort((a, b) => b[1] - a[1])
        ];
    }
    return [
        ['Статус объекта', 'Количество'],
        ['ОК', objects.filter((object) => object.status === 'ok').length],
        ['Неполное покрытие', objects.filter((object) => object.status === 'missing').length],
        ['Расхождение', objects.filter((object) => object.status === 'mismatch').length],
        ['Сняты с продажи', objects.filter((object) => object.listingStatus === 'sold').length],
        ['Неактивны в ILVO', objects.filter((object) => object.listingStatus === 'inactive').length]
    ];
}

function bar(value, max) {
    const size = max > 0 ? Math.round((Number(value) / max) * 18) : 0;
    return `${'█'.repeat(Math.max(0, size))}${'░'.repeat(Math.max(0, 18 - size))}`;
}

function setCellStyle(ws, address, style) {
    if (!ws[address]) ws[address] = { t: 's', v: '' };
    ws[address].s = style;
}

function styleTable(ws, headerRow, columnCount, rows, columns) {
    for (let column = 0; column < columnCount; column += 1) {
        setCellStyle(ws, XLSX.utils.encode_cell({ r: headerRow, c: column }), STYLES.header);
    }
    for (let row = headerRow + 1; row <= headerRow + rows; row += 1) {
        for (let column = 0; column < columnCount; column += 1) {
            const address = XLSX.utils.encode_cell({ r: row, c: column });
            const value = ws[address]?.v;
            if (typeof value === 'string' && ['Неполное покрытие', 'Расхождение', 'Критическая', 'Предупреждение'].includes(value)) {
                setCellStyle(ws, address, value === 'Критическая' || value === 'Расхождение' ? STYLES.danger : STYLES.warning);
            }
        }
    }
    ws['!cols'] = columns.map((column) => ({
        wch: COLUMN_WIDTHS[column] || Math.min(42, Math.max(12, String(column).length + 3))
    }));
    ws['!autofilter'] = {
        ref: `A${headerRow + 1}:${XLSX.utils.encode_col(columnCount - 1)}${headerRow + rows + 1}`
    };
    ws['!freeze'] = { xSplit: 0, ySplit: headerRow + 1 };
}

function createDataSheet(title, rows, columns) {
    const ws = XLSX.utils.aoa_to_sheet([[title], ['Данные последней проверки. Фильтруйте строки по заголовкам столбцов.'], []]);
    if (columns.length) {
        XLSX.utils.sheet_add_aoa(ws, [columns], { origin: 'A4' });
        if (rows.length) {
            XLSX.utils.sheet_add_json(ws, rows, { origin: 'A5', header: columns, skipHeader: true });
        }
        styleTable(ws, 3, columns.length, rows.length, columns);
    } else {
        ws['A4'] = { t: 's', v: 'Нет данных для отображения.' };
        ws['!cols'] = [{ wch: 34 }];
    }
    const lastColumn = Math.max(columns.length - 1, 0);
    ws['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: lastColumn } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: lastColumn } }
    ];
    setCellStyle(ws, 'A1', STYLES.title);
    setCellStyle(ws, 'A2', STYLES.subtitle);
    ws['!rows'] = [{ hpt: 26 }, { hpt: 28 }, { hpt: 8 }, { hpt: 32 }];
    return ws;
}

function createSummarySheet(reportType, report, rows, specificRows = reportSpecificSummary(reportType, rows, report)) {
    const stats = report.stats || {};
    const title = REPORT_LABELS[reportType] || 'Отчёт';
    const sourceRows = [
        ['Источник', 'Записей загружено', 'Визуально'],
        ['Сайт', stats.siteCount || 0, bar(stats.siteCount || 0, Math.max(stats.siteCount || 0, stats.ilvoCount || 0, stats.kufarCount || 0))],
        ['ILVO', stats.ilvoCount || 0, bar(stats.ilvoCount || 0, Math.max(stats.siteCount || 0, stats.ilvoCount || 0, stats.kufarCount || 0))],
        ['Kufar', stats.kufarCount || 0, bar(stats.kufarCount || 0, Math.max(stats.siteCount || 0, stats.ilvoCount || 0, stats.kufarCount || 0))]
    ];
    const metricRows = [
        ['Показатель', 'Значение'],
        ['Дата проверки', formatDateTime(report.checkedAt)],
        ['Уникальных объектов', stats.totalUnique || 0],
        ['Активных объектов', stats.activeCount || 0],
        ['Сняты с продажи', stats.soldCount || 0],
        ['Неактивны в ILVO', stats.inactiveCount || 0],
        ['Покрытие всех площадок', `${formatNumber(stats.matchPercent, 1)}%`],
        ['Объекты требуют внимания', stats.problemsCount || 0],
        ['Всего записей ошибок', stats.errorsCount || 0],
        ['Критические ошибки', stats.criticalCount || 0],
        ['С договором', stats.withContract || 0],
        ['Без договора', stats.withoutContract || 0]
    ];
    const maxSpecific = Math.max(...specificRows.slice(1).map((row) => Number(row[1]) || 0), 0);
    const specificWithBars = [
        [specificRows[0][0], specificRows[0][1], 'Визуально'],
        ...specificRows.slice(1).map((row) => [row[0], row[1], bar(row[1], maxSpecific)])
    ];
    const ws = XLSX.utils.aoa_to_sheet([
        [title],
        ['Сводка сформирована автоматически по результатам последней проверки. В листе «Данные» находится полный реестр выбранного отчёта.'],
        [],
        ['Ключевые показатели'],
        ...metricRows,
        [],
        ['Источники данных'],
        ...sourceRows,
        [],
        ['Показатели этого отчёта'],
        ...specificWithBars
    ]);
    const sourceSectionRow = 17;
    const sourceHeaderRow = 18;
    const specificSectionRow = sourceHeaderRow + sourceRows.length + 1;
    const specificHeaderRow = specificSectionRow + 1;
    const lastRow = specificHeaderRow + specificWithBars.length - 1;
    ws['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 2 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: 2 } },
        { s: { r: 3, c: 0 }, e: { r: 3, c: 2 } },
        { s: { r: specificSectionRow, c: 0 }, e: { r: specificSectionRow, c: 2 } }
    ];
    setCellStyle(ws, 'A1', STYLES.title);
    setCellStyle(ws, 'A2', STYLES.subtitle);
    setCellStyle(ws, 'A4', STYLES.section);
    setCellStyle(ws, XLSX.utils.encode_cell({ r: sourceSectionRow, c: 0 }), STYLES.section);
    setCellStyle(ws, XLSX.utils.encode_cell({ r: specificSectionRow, c: 0 }), STYLES.section);
    for (let column = 0; column < 2; column += 1) setCellStyle(ws, XLSX.utils.encode_cell({ r: 4, c: column }), STYLES.header);
    for (let column = 0; column < 3; column += 1) setCellStyle(ws, XLSX.utils.encode_cell({ r: sourceHeaderRow, c: column }), STYLES.header);
    for (let column = 0; column < 3; column += 1) setCellStyle(ws, XLSX.utils.encode_cell({ r: specificHeaderRow, c: column }), STYLES.header);
    for (let row = 5; row <= 15; row += 1) setCellStyle(ws, `A${row}`, STYLES.label);
    for (let row = sourceHeaderRow + 1; row < specificSectionRow; row += 1) setCellStyle(ws, `A${row}`, STYLES.label);
    for (let row = specificHeaderRow + 1; row <= lastRow; row += 1) setCellStyle(ws, `A${row}`, STYLES.label);
    ws['!cols'] = [{ wch: 34 }, { wch: 24 }, { wch: 24 }];
    ws['!rows'] = [{ hpt: 28 }, { hpt: 32 }, { hpt: 8 }];
    return ws;
}

function chartDefinition(title, entries, chart = 'column') {
    const safeEntries = entries.length ? entries : [['Нет данных', 0]];
    return {
        chart,
        titles: [title],
        fields: safeEntries.map(([label]) => String(label)),
        data: {
            [title]: Object.fromEntries(safeEntries.map(([label, value]) => [String(label), Number(value) || 0]))
        },
        chartTitle: title
    };
}

function buildChartDefinitions(reportType, report, rows) {
    const stats = report.stats || {};
    const specificRows = reportSpecificSummary(reportType, rows, report);
    return [
        {
            definition: chartDefinition('Количество записей по источникам', [
                ['Сайт', stats.siteCount || 0],
                ['ILVO', stats.ilvoCount || 0],
                ['Kufar', stats.kufarCount || 0]
            ]),
            formulas: [
                "'Сводка'!$B$19",
                "'Сводка'!$A$20:$A$22",
                "'Сводка'!$B$20:$B$22"
            ],
            colors: ['155945', 'D97706', '6A7FDB']
        },
        {
            definition: chartDefinition(
                REPORT_LABELS[reportType] || 'Показатели отчёта',
                specificRows.slice(1),
                'bar'
            ),
            formulas: [
                "'Сводка'!$B$25",
                `'Сводка'!$A$26:$A$${25 + specificRows.length - 1}`,
                `'Сводка'!$B$26:$B$${25 + specificRows.length - 1}`
            ],
            colors: ['287A61', 'D97706', '6A7FDB', 'DC2626', '8B1E3F', '155945']
        }
    ];
}

function replaceChartReferences(xml, formulas) {
    let formulaIndex = 0;
    return xml.replace(/<c:f>[^<]*<\/c:f>/g, (formula) => {
        const nextFormula = formulas[formulaIndex++];
        return nextFormula ? `<c:f>${nextFormula}</c:f>` : formula;
    });
}

function addChartPointColors(xml, colors) {
    const points = colors.map((color, index) => (
        `<c:dPt><c:idx val="${index}"/><c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr></c:dPt>`
    )).join('');
    return xml.replace('<c:cat>', `${points}<c:cat>`);
}

function positionCharts(xml) {
    let index = 0;
    return xml.replace(/<xdr:twoCellAnchor>[\s\S]*?<\/xdr:twoCellAnchor>/g, (anchor) => {
        const fromRow = 3 + index * 16;
        const toRow = 18 + index * 16;
        index += 1;
        return anchor
            .replace(/(<xdr:from>[\s\S]*?<xdr:col>)[^<]+/, '$14')
            .replace(/(<xdr:from>[\s\S]*?<xdr:row>)[^<]+/, `$1${fromRow}`)
            .replace(/(<xdr:to>[\s\S]*?<xdr:col>)[^<]+/, '$115')
            .replace(/(<xdr:to>[\s\S]*?<xdr:row>)[^<]+/, `$1${toRow}`);
    });
}

function addChartRelationship(sheetRelationships) {
    const relationship = '<Relationship Id="rIdChart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>';
    if (!sheetRelationships) {
        return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationship}</Relationships>`;
    }
    if (sheetRelationships.includes('drawing1.xml')) return sheetRelationships;
    return sheetRelationships.replace('</Relationships>', `${relationship}</Relationships>`);
}

function addDrawingToSheet(sheetXml) {
    let xml = sheetXml;
    if (!xml.includes('xmlns:r=')) {
        xml = xml.replace('<worksheet ', '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ');
    }
    if (!xml.includes('<drawing ')) {
        xml = xml.replace('</worksheet>', '<drawing r:id="rIdChart"/></worksheet>');
    }
    return xml;
}

function addChartContentTypes(contentTypesXml, chartCount) {
    const overrides = [];
    if (!contentTypesXml.includes('/xl/drawings/drawing1.xml')) {
        overrides.push(
            '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>'
        );
    }
    for (let index = 0; index < chartCount; index += 1) {
        if (!contentTypesXml.includes(`/xl/charts/chart${index + 1}.xml`)) {
            overrides.push(
                `<Override PartName="/xl/charts/chart${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`
            );
        }
    }
    return overrides.length > 0
        ? contentTypesXml.replace('</Types>', `${overrides.join('')}</Types>`)
        : contentTypesXml;
}

function generateChartPackage(chartDefinitions) {
    return new Promise((resolve, reject) => {
        const xlsxChart = new XLSXChart();
        xlsxChart.generate({ charts: chartDefinitions.map((chart) => chart.definition), type: 'nodebuffer' }, (error, buffer) => {
            if (error) reject(error);
            else resolve(buffer);
        });
    });
}

async function addChartsToWorkbook(workbookBuffer, chartDefinitions) {
    const chartBuffer = await generateChartPackage(chartDefinitions);
    const workbookZip = new JSZip();
    const chartZip = new JSZip();
    workbookZip.load(workbookBuffer);
    chartZip.load(chartBuffer);

    chartDefinitions.forEach((chart, index) => {
        const chartXml = chartZip.file(`xl/charts/chart${index + 1}.xml`).asText();
        workbookZip.file(
            `xl/charts/chart${index + 1}.xml`,
            addChartPointColors(replaceChartReferences(chartXml, chart.formulas), chart.colors)
        );
    });
    workbookZip.file('xl/drawings/drawing1.xml', positionCharts(chartZip.file('xl/drawings/drawing1.xml').asText()));
    workbookZip.file('xl/drawings/_rels/drawing1.xml.rels', chartZip.file('xl/drawings/_rels/drawing1.xml.rels').asText());
    workbookZip.file(
        'xl/worksheets/_rels/sheet1.xml.rels',
        addChartRelationship(workbookZip.file('xl/worksheets/_rels/sheet1.xml.rels')?.asText())
    );
    workbookZip.file('xl/worksheets/sheet1.xml', addDrawingToSheet(workbookZip.file('xl/worksheets/sheet1.xml').asText()));
    workbookZip.file(
        '[Content_Types].xml',
        addChartContentTypes(workbookZip.file('[Content_Types].xml').asText(), chartDefinitions.length)
    );
    return workbookZip.generate({ type: 'nodebuffer' });
}

function buildWorkbook(reportType, report) {
    const rows = buildRows(reportType, report);
    const columns = REPORT_COLUMNS[reportType] || REPORT_COLUMNS.full;
    const specificRows = reportSpecificSummary(reportType, rows, report);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, createSummarySheet(reportType, report, rows, specificRows), 'Сводка');
    XLSX.utils.book_append_sheet(workbook, createDataSheet(REPORT_LABELS[reportType] || 'Данные', rows, columns), 'Данные');
    workbook.Props = {
        Title: REPORT_LABELS[reportType] || 'Отчёт',
        Subject: 'Контроль объектов недвижимости и источников данных',
        Author: 'GermesControl',
        CreatedDate: new Date()
    };
    return { workbook, rows };
}

async function generateReport({ reportType, format, report, destPath }) {
    if (format !== 'xlsx') {
        throw new Error('Доступен только экспорт в XLSX.');
    }
    const { workbook, rows } = buildWorkbook(reportType, report);
    const chartDefinitions = buildChartDefinitions(reportType, report, rows);
    const workbookBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', cellStyles: true });
    const finalBuffer = await addChartsToWorkbook(workbookBuffer, chartDefinitions);
    await fs.promises.writeFile(destPath, finalBuffer);
    return { rows: rows.length, destPath };
}

module.exports = {
    buildRows,
    buildWorkbook,
    generateReport,
    REPORT_LABELS,
    REPORT_COLUMNS
};