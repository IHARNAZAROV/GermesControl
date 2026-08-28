'use strict';

/**
 * Единая схема объекта недвижимости, используемая при импорте
 * из всех трёх источников (Сайт / ILVO / Kufar).
 */
const OBJECT_FIELDS = [
    { key: 'id', label: 'ID', compare: false },
    { key: 'title', label: 'Название', compare: false },
    { key: 'type', label: 'Тип объекта', compare: true },
    { key: 'dealType', label: 'Тип сделки', compare: true },
    { key: 'city', label: 'Город', compare: false },
    { key: 'address', label: 'Адрес', compare: true },
    { key: 'price', label: 'Цена', compare: true, numeric: true, unit: 'BYN' },
    { key: 'priceUsd', label: 'Цена USD', compare: true, numeric: true, unit: 'USD' },
    { key: 'rooms', label: 'Количество комнат', compare: true, numeric: true },
    { key: 'totalArea', label: 'Общая площадь', compare: true, numeric: true, unit: 'м²' },
    { key: 'livingArea', label: 'Жилая площадь', compare: true, numeric: true, unit: 'м²' },
    { key: 'kitchenArea', label: 'Площадь кухни', compare: true, numeric: true, unit: 'м²' },
    { key: 'floor', label: 'Этаж', compare: true, numeric: true },
    { key: 'floors', label: 'Количество этажей', compare: true, numeric: true },
    { key: 'description', label: 'Описание', compare: false },
    { key: 'contractNumber', label: 'Договор', compare: true },
    { key: 'status', label: 'Статус', compare: false }
];

const SOURCES = {
    site: { key: 'site', label: 'Сайт ГермесГарант', short: 'Сайт', format: 'JSON' },
    ilvo: { key: 'ilvo', label: 'ILVO CRM', short: 'ILVO', format: 'XLSX' },
    kufar: { key: 'kufar', label: 'Kufar (XML)', short: 'Kufar', format: 'XML' }
};

const ERROR_TYPES = {
    NO_CONTRACT: 'Нет договора',
    CONTRACT_NO_OBJECT: 'Договор без объекта',
    DUPLICATE_CONTRACT: 'Дубликат договора',
    MISSING_SITE: 'Объект отсутствует на сайте',
    MISSING_ILVO: 'Объект отсутствует в ILVO',
    MISSING_KUFAR: 'Объект отсутствует в XML Kufar',
    PRICE_MISMATCH: 'Разная цена',
    AREA_MISMATCH: 'Разная площадь',
    ADDRESS_MISMATCH: 'Разный адрес',
    ROOMS_MISMATCH: 'Разное количество комнат',
    CONTRACT_MISMATCH: 'Разные данные договора',
    OTHER: 'Другие несоответствия'
};

const SEVERITY = {
    CRITICAL: 'critical',
    WARNING: 'warning',
    INFO: 'info'
};

const ERROR_SEVERITY = {
    [ERROR_TYPES.NO_CONTRACT]: SEVERITY.WARNING,
    [ERROR_TYPES.CONTRACT_NO_OBJECT]: SEVERITY.WARNING,
    [ERROR_TYPES.DUPLICATE_CONTRACT]: SEVERITY.CRITICAL,
    [ERROR_TYPES.MISSING_SITE]: SEVERITY.CRITICAL,
    [ERROR_TYPES.MISSING_ILVO]: SEVERITY.CRITICAL,
    [ERROR_TYPES.MISSING_KUFAR]: SEVERITY.WARNING,
    [ERROR_TYPES.PRICE_MISMATCH]: SEVERITY.WARNING,
    [ERROR_TYPES.AREA_MISMATCH]: SEVERITY.WARNING,
    [ERROR_TYPES.ADDRESS_MISMATCH]: SEVERITY.INFO,
    [ERROR_TYPES.ROOMS_MISMATCH]: SEVERITY.INFO,
    [ERROR_TYPES.CONTRACT_MISMATCH]: SEVERITY.CRITICAL,
    [ERROR_TYPES.OTHER]: SEVERITY.INFO
};

/**
 * Извлекает нормализованный «ключ договора» из произвольного текста
 * (например, "Договор №1/1 от 01.07.2026" -> "1/1", "2/1" -> "2/1",
 * "№4561" -> "4561"). Используется как основной ключ сопоставления
 * одного и того же объекта между Сайтом и ILVO.
 */
function extractContractKey(raw) {
    if (raw === undefined || raw === null) return null;
    let s = String(raw).replace(/\u00a0/g, ' ').trim();
    if (!s || s === '-') return null;

    // Убираем служебную часть, дату и разные варианты префикса номера.
    // Пробелы вокруг "/" и "-" не влияют на результат.
    s = s
        .replace(/(^|[\s,;:])договор(?:а|у|ом|е)?(?=$|[\s,;:])/giu, '$1')
        .replace(/\b(?:от\s*)?\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\s*(?:г(?:ода)?)?\b/giu, ' ')
        .replace(/[№#]/g, ' ')
        .replace(/(^|[\s,;:])(?:no|n)(?=$|[\s,;:])/giu, '$1')
        .replace(/\s+/g, ' ')
        .trim();

    const compoundMatch = s.match(/(?:^|[^\d])(\d+)\s*[\/-]\s*([0-9A-Za-zА-Яа-яЁё]+)(?=$|[^\dA-Za-zА-Яа-яЁё])/u);
    if (compoundMatch) return `${compoundMatch[1]}/${compoundMatch[2]}`.toUpperCase();

    // Для простых номеров принимаем только оставшийся токен с номером,
    // чтобы строка «от 21.07.2026» не превратилась в договор «21».
    const simpleMatch = s.match(/^\d+[A-Za-zА-Яа-яЁё]*$/u);
    return simpleMatch ? simpleMatch[0].toUpperCase() : null;
}

const ADDRESS_STOPWORDS = /(?<![0-9A-Za-zА-Яа-яЁё])(ул|улица|пр|проспект|пер|переулок|б-р|бульвар|бр|д|дом|г|город|пос|посёлок|поселок|ст|аг|агрогородок)(?![0-9A-Za-zА-Яа-яЁё])\.?/giu;

/**
 * Очищает произвольный адресный текст: убирает пунктуацию и типовые
 * сокращения (ул., д., г., пос. ...), приводит к нижнему регистру.
 * Используется и для ключа сопоставления объектов, и для нестрогого
 * сравнения адреса между источниками (см. compare.js).
 */
function cleanLocationText(s) {
    return String(s || '')
        .toLowerCase()
        .replace(/[«»"'.,№]/g, ' ')
        .replace(ADDRESS_STOPWORDS, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Строит нормализованный ключ адреса. Город намеренно не включается:
 * сайт может передавать район, а ILVO — населённый пункт, хотя улица
 * и номер дома у объекта одинаковые.
 */
function normalizeAddressKey(city, address) {
    const a = cleanLocationText(address);
    return a || null;
}

module.exports = { OBJECT_FIELDS, SOURCES, ERROR_TYPES, SEVERITY, ERROR_SEVERITY, extractContractKey, normalizeAddressKey, cleanLocationText };
