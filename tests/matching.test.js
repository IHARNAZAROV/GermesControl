'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const XLSX = require('xlsx');

const { parseIlvoXlsx, parseIlvoApiEvents } = require('../src/main/parsers');
const { runComparison } = require('../src/main/compare');
const { ERROR_TYPES, normalizeDealType } = require('../src/main/schema');

function record(source, overrides = {}) {
    return {
        id: `${source}-1`,
        type: 'Дом',
        dealType: 'Продажа',
        city: 'Лида',
        address: 'ул. Октябрьская, 9',
        price: 100000,
        rooms: 3,
        totalArea: 120,
        livingArea: 70,
        kitchenArea: 15,
        floor: 1,
        floors: 2,
        contractNumber: '38/1',
        status: 'active',
        ...overrides
    };
}

function comparison(sourceOverrides = {}) {
    return runComparison({
        site: [record('site', sourceOverrides.site)],
        ilvo: [record('ilvo', sourceOverrides.ilvo)],
        kufar: [record('kufar', sourceOverrides.kufar)],
        contracts: [],
        includeContractRegistry: false
    });
}

test('normalizes only an explicit deal type and preserves missing data', () => {
    assert.equal(normalizeDealType('rent'), 'Аренда');
    assert.equal(normalizeDealType('Продажа'), 'Продажа');
    assert.equal(normalizeDealType('Аренда объекта'), 'Аренда');
    assert.equal(normalizeDealType('Продажа / объект'), 'Продажа');
    assert.equal(normalizeDealType(null), null);
    assert.equal(normalizeDealType(''), null);
});

test('maps ILVO API events and keeps the latest object state', () => {
    const object = {
        id: 42,
        uuid: '11111111-1111-4111-8111-111111111111',
        type: 'apartment',
        category: 'sell',
        city: 'Лида',
        street: 'Октябрьская',
        building: '9',
        housing: null,
        rooms: 3,
        area: 120,
        area_living: 70,
        area_kitchen: 15,
        floor: 1,
        floors_total: 2,
        currency: 'BYN',
        price: '100 000',
        prices: { BYN: '100 000', USD: '31 000' },
        description: 'Тестовый объект',
        contract: { number: '38/1', date: '2026-07-01T10:00:00Z' },
        created: '2026-07-01T09:00:00Z',
        modified: '2026-07-02T09:00:00Z'
    };
    const records = parseIlvoApiEvents([
        { data: { action: 'create', data: object }, date: '2026-07-01T09:00:00Z', attempt: 0 },
        { data: { action: 'update', data: { ...object, price: '101 000', prices: { BYN: '101 000', USD: '31 300' } } }, date: '2026-07-02T09:00:00Z', attempt: 0 }
    ]);

    assert.equal(records.length, 1);
    assert.equal(records[0].id, '42');
    assert.equal(records[0].type, 'Квартира');
    assert.equal(records[0].dealType, 'Продажа');
    assert.equal(records[0].price, 101000);
    assert.equal(records[0].priceUsd, 31300);
    assert.equal(records[0].status, 'active');
    assert.equal(records[0].contractNumber, '38/1');
});

test('maps the latest ILVO API delete event to an inactive object', () => {
    const base = {
        id: 7,
        uuid: '77777777-7777-4777-8777-777777777777',
        type: 'house',
        category: 'rent',
        city: 'Лида',
        street: 'Мицкевича',
        building: '1',
        prices: { BYN: '2 000' },
        currency: 'BYN',
        price: '2 000',
        created: '2026-07-01T09:00:00Z',
        modified: '2026-07-01T09:00:00Z'
    };
    const [record] = parseIlvoApiEvents([
        { data: { action: 'create', data: base }, date: '2026-07-01T09:00:00Z', attempt: 0 },
        { data: { action: 'delete', data: base }, date: '2026-07-03T09:00:00Z', attempt: 0 }
    ]);

    assert.equal(record.status, 'inactive');
    assert.equal(record.ilvoApiAction, 'delete');
    assert.equal(record.statusDate, '2026-07-03T09:00:00Z');
});

test('ILVO does not infer deal type from description', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'germescontrol-'));
    const filePath = path.join(dir, 'ilvo.xlsx');
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet([
        {
            Описание: 'Продажа дома. Аренда соседнего помещения не рассматривается.',
            Город: 'Лида',
            Улица: 'Октябрьская',
            Дом: '9',
            Договор: '38/1',
            Цена: 100000
        }
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Дом');
    XLSX.writeFile(workbook, filePath);

    const [withoutExplicitValue] = await parseIlvoXlsx(filePath);
    assert.equal(withoutExplicitValue.dealType, null);

    const explicitSheet = XLSX.utils.json_to_sheet([{
        'Тип сделки': 'Продажа',
        Описание: 'В описании может встречаться слово аренда, это не поле сделки.',
        Город: 'Лида',
        Улица: 'Октябрьская',
        Дом: '9',
        Договор: '38/1',
        Цена: 100000
    }]);
    const explicitWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(explicitWorkbook, explicitSheet, 'Дом');
    const explicitPath = path.join(dir, 'ilvo-explicit.xlsx');
    XLSX.writeFile(explicitWorkbook, explicitPath);

    const [withExplicitValue] = await parseIlvoXlsx(explicitPath);
    assert.equal(withExplicitValue.dealType, 'Продажа');
    fs.rmSync(dir, { recursive: true, force: true });
});

test('missing deal type is not reported as a mismatch', () => {
    const report = comparison({
        ilvo: { dealType: null, description: 'Аренда упомянута в примечании' }
    });
    assert.equal(report.objects.length, 1);
    assert.equal(report.objects[0].fieldDiffs.some((diff) => diff.field === 'dealType'), false);
    assert.equal(report.errors.some((error) => error.type === ERROR_TYPES.DEAL_TYPE_MISMATCH), false);
});

test('explicitly different deal types produce a dedicated mismatch', () => {
    const report = comparison({ ilvo: { dealType: 'Аренда' } });
    assert.equal(report.objects.length, 1);
    assert.equal(report.errors.some((error) => error.type === ERROR_TYPES.DEAL_TYPE_MISMATCH), true);
    assert.deepEqual(
        report.objects[0].fieldDiffs.find((diff) => diff.field === 'dealType').values,
        { site: 'Продажа', ilvo: 'Аренда', kufar: 'Продажа' }
    );
});

test('conflicting strong attributes prevent descriptor false positives', () => {
    const report = runComparison({
        site: [record('site', {
            contractNumber: null,
            address: 'ул. Немига, 44',
            rooms: 2,
            totalArea: 144.1,
            price: 438285
        })],
        ilvo: [record('ilvo', {
            contractNumber: null,
            address: 'ул. Кальварийская, 3',
            rooms: 3,
            totalArea: 143.2,
            price: 440616
        })],
        kufar: [],
        contracts: [],
        includeContractRegistry: false
    });
    assert.equal(report.objects.length, 2);
});

test('a contract missing from one matched source is reported', () => {
    const report = comparison({ ilvo: { contractNumber: null } });
    assert.equal(report.objects.length, 1);
    assert.equal(report.errors.some((error) => error.type === ERROR_TYPES.CONTRACT_MISMATCH), true);
});

test('different house numbers are not merged through compact substring matching', () => {
    const report = runComparison({
        site: [record('site', { contractNumber: null, address: 'ул. Октябрьская, 1', totalArea: 80 })],
        ilvo: [record('ilvo', { contractNumber: null, address: 'ул. Октябрьская, 10', price: 105000 })],
        kufar: [],
        contracts: [],
        includeContractRegistry: false
    });
    assert.equal(report.objects.length, 2);
});