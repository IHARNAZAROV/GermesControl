'use strict';

/**
 * Единая схема объекта недвижимости, используемая при импорте
 * из всех трёх источников (Сайт / ILVO / Kufar).
 */
const OBJECT_FIELDS = [
    { key: 'id', label: 'ID', compare: false },
    { key: 'title', label: 'Название', compare: true },
    { key: 'type', label: 'Тип объекта', compare: true },
    { key: 'dealType', label: 'Тип сделки', compare: true },
    { key: 'city', label: 'Город', compare: true },
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

module.exports = { OBJECT_FIELDS, SOURCES, ERROR_TYPES, SEVERITY, ERROR_SEVERITY };
