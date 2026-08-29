'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const XLSX = require('xlsx');

const { parseIlvoXlsx } = require('../src/main/parsers');
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