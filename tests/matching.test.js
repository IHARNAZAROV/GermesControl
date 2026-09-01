'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const XLSX = require('xlsx');

const { parseIlvoXlsx, parseIlvoApiEvents, parseKufarXml } = require('../src/main/parsers');
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

test('ILVO reads areas, rooms, floor, and corpus from dedicated columns', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'germescontrol-'));
    const filePath = path.join(dir, 'ilvo-columns.xlsx');
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet([{
        Договор: '38/1',
        Город: 'Лида',
        Улица: 'Октябрьская',
        Дом: '16',
        'Детали адреса': '16',
        Корпус: '2',
        'Этаж/Всего': '3 из 9',
        'Площадь(о/ж/к)': '101.2 / 61,5 / 12 м²',
        'Комнат/Всего': '4 из 4',
        Описание: 'В описании ошибочно указано: 999 / 888 / 777 м² и 1-комнатная квартира.',
        Цена: '100 000'
    }]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Квартира');
    XLSX.writeFile(workbook, filePath);

    const [parsed] = await parseIlvoXlsx(filePath);
    assert.equal(parsed.totalArea, 101.2);
    assert.equal(parsed.livingArea, 61.5);
    assert.equal(parsed.kitchenArea, 12);
    assert.equal(parsed.rooms, 4);
    assert.equal(parsed.floor, 3);
    assert.equal(parsed.floors, 9);
    assert.equal(parsed.address, 'Октябрьская, 16, корпус 2');
    fs.rmSync(dir, { recursive: true, force: true });
});

test('ILVO does not infer areas or rooms from description when dedicated columns are empty', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'germescontrol-'));
    const filePath = path.join(dir, 'ilvo-empty-columns.xlsx');
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet([{
        Описание: 'Дом площадью 120 м2, 3-комнатный, жилая 70 м2, кухня 15 м2.',
        'Площадь(о/ж/к)': '-',
        'Комнат/Всего': '-'
    }]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Дом');
    XLSX.writeFile(workbook, filePath);

    const [parsed] = await parseIlvoXlsx(filePath);
    assert.equal(parsed.totalArea, null);
    assert.equal(parsed.livingArea, null);
    assert.equal(parsed.kitchenArea, null);
    assert.equal(parsed.rooms, null);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('address matching treats compact and explicit corpus notation as equal', () => {
    const report = runComparison({
        site: [record('site', {
            contractNumber: null,
            address: 'Октябрьская, 16к2'
        })],
        ilvo: [record('ilvo', {
            contractNumber: null,
            address: 'Октябрьская, 16, корпус 2'
        })],
        kufar: [],
        contracts: [],
        includeContractRegistry: false
    });

    assert.equal(report.objects.length, 1);
    assert.equal(report.objects[0].matchedBy, 'address_price');
});

test('Kufar keeps initials, house number, and corpus in the subject address', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
        <uedb><records><record>
            <unid>27e37ed3-1d58-4d43-9f6b-81d715a4f226</unid>
            <subject><![CDATA[Продажа квартиры в доме по ул. Л. Чайкиной]]></subject>
            <type>sell</type><price>103950</price><currency>BYN</currency>
            <category>1010</category><rooms>4</rooms><size>63.6</size>
            <re_contract>№59/1 от 10.08.2026</re_contract>
        </record><record>
            <unid>second</unid>
            <subject><![CDATA[3-к квартир по ул. Машерова,23 корп.1]]></subject>
            <type>sell</type><price>1</price><currency>BYN</currency><category>1010</category>
        </record></records></uedb>`;

    const records = await parseKufarXml(xml, true);
    assert.equal(records[0].address, 'ул. Л. Чайкиной');
    assert.equal(records[1].address, 'ул. Машерова,23 корп.1');
});

test('Kufar abbreviated street names do not create an address mismatch', async () => {
    const [kufar] = await parseKufarXml(`<uedb><records><record>
        <unid>27e37ed3-1d58-4d43-9f6b-81d715a4f226</unid>
        <subject><![CDATA[Продажа квартиры в доме по ул. Л. Чайкиной]]></subject>
        <type>sell</type><price>103950</price><currency>BYN</currency><category>1010</category>
        <rooms>4</rooms><size>63.6</size><re_contract>№59/1 от 10.08.2026</re_contract>
    </record></records></uedb>`, true);
    const report = runComparison({
        site: [record('site', {
            address: 'ул. Лизы Чайкиной, 4',
            contractNumber: '59/1',
            type: 'Квартира',
            rooms: 4,
            totalArea: 63.6,
            livingArea: 28.5,
            kitchenArea: 12.2,
            price: 103950
        })],
        ilvo: [],
        kufar: [kufar],
        contracts: [],
        includeContractRegistry: false
    });

    assert.equal(report.objects.length, 1);
    assert.equal(report.objects[0].fieldDiffs.some((diff) => diff.field === 'address'), false);
});

test('missing deal type is not reported as a mismatch', () => {
    const report = comparison({
        ilvo: { dealType: null, description: 'Аренда упомянута в примечании' }
    });
    assert.equal(report.objects.length, 1);
    assert.equal(report.objects[0].fieldDiffs.some((diff) => diff.field === 'dealType'), false);
    assert.equal(report.errors.some((error) => error.type === ERROR_TYPES.DEAL_TYPE_MISMATCH), false);
});

test('object titles start with an uppercase letter', () => {
    const report = comparison();
    assert.match(report.objects[0].title, /^Дом(?:\s|$)/);
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

test('inactive ILVO records do not create missing active listing errors', () => {
    const report = runComparison({
        site: [record('site', { contractNumber: '38/1' })],
        ilvo: [record('ilvo', { contractNumber: '38/1', status: 'inactive' })],
        kufar: [],
        contracts: [],
        includeContractRegistry: false
    });

    assert.equal(report.objects.length, 1);
    assert.equal(report.objects[0].listingStatus, 'inactive');
    assert.equal(report.objects[0].status, 'ok');
    assert.equal(report.stats.activeCount, 0);
    assert.equal(report.stats.inactiveCount, 1);
    assert.equal(report.categories.missingKufar, 0);
    assert.equal(report.errors.some((error) => error.type === ERROR_TYPES.MISSING_KUFAR), false);
});

test('sold website objects do not create comparison or contract errors', () => {
    const report = runComparison({
        site: [record('site', {
            status: 'sold',
            livingArea: 72,
            contractNumber: '38/1'
        })],
        ilvo: [record('ilvo', {
            livingArea: 70,
            contractNumber: '38-1'
        })],
        kufar: [],
        contracts: [],
        includeContractRegistry: false
    });

    assert.equal(report.objects.length, 1);
    assert.equal(report.objects[0].listingStatus, 'sold');
    assert.equal(report.objects[0].status, 'ok');
    assert.equal(report.objects[0].fieldDiffs.length, 0);
    assert.equal(report.errors.some((error) => error.target === report.objects[0].objectNumber), false);
    assert.equal(report.stats.problemsCount, 0);
});
