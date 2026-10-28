'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const XLSX = require('xlsx');
const { parseBizlidaXlsx, finalizeRecord } = require('../src/main/parsers');
const { runComparison } = require('../src/main/compare');
const { buildWorkbook } = require('../src/main/reports');

function row(id, title, description = '', price = '120 000') {
    return ['https://bizlida.by/photo.jpeg', 'АН ГермесГарант',
        `https://bizlida.by/baraholka/${id}`, title, description, price, '28 октября, 18:09'];
}

async function parseRows(rows, context) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bizlida-'));
    context.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'export.xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Объявления');
    XLSX.writeFile(wb, file);
    return parseBizlidaXlsx(file);
}

function rec(source, extra = {}) {
    return finalizeRecord({
        id: `${source}-1`, title: '3-к квартира по ул. Машерова,23 корп.1',
        type: 'Квартира', city: 'Лида', address: 'ул. Машерова, 23к1',
        rooms: 3, price: 120000, totalArea: 62.1,
        contractNumber: source === 'bizlida' ? null : '11/1', status: 'active', ...extra
    }, source, `${source}-1`);
}

function compare(extra = {}) {
    return runComparison({
        site: [rec('site')], ilvo: [rec('ilvo')], kufar: [rec('kufar')],
        bizlida: [rec('bizlida')], contracts: [], includeContractRegistry: false, ...extra
    });
}

test('Bizlida keeps the first headerless row, BYN prices, URL, photo, and all seven columns', async (t) => {
    const records = await parseRows([
        row(135590, 'Продаётся 3-к квартир по ул. Машерова,23 корп.1'),
        row(136028, '1-к квартира пр-т Победы,19', '', 87800)
    ], t);
    assert.equal(records.length, 2);
    assert.equal(records[0].id, '135590');
    assert.equal(records[0].price, 120000);
    assert.equal(records[0].priceUsd, null);
    assert.equal(records[0].contractNumber, null);
    assert.equal(records[0].address, 'Машерова, 23, корпус 1');
    assert.equal(records[0].rooms, 3);
    assert.equal(records[0].listingUrl, 'https://bizlida.by/baraholka/135590');
    assert.deepEqual(records[0].photos, ['https://bizlida.by/photo.jpeg']);
    assert.equal(records[1].address, 'Победы, 19');
    assert.equal(records[1].rooms, 1);
});

test('Bizlida splits villages, house/corpus formats, initials, and ignores the office signature', async (t) => {
    const records = await parseRows([
        row(1, 'Дом в д.Дайнова-1,Лидский р-н', 'Дом общей площадью 60,6 м2.'),
        row(2, '3-к квартира по ул. Пролыгина д.6/2'),
        row(3, '3-к квартира по ул. Фурманова 60-2, в микрорайоне Слобода.'),
        row(4, '2-х комн. квартира ул. М.Горького'),
        row(5, 'Дом с баней', 'Консультации по покупке: обращайтесь по адресу: г. Лида, б-р. Князя Гедимина,12'),
        row(6, 'Дом в посёлке Первомайский'),
        row(7, 'ДАЧА СТ Зорька, 15 мин от г.Лида'),
        row(8, 'Квартира', 'Расположена на 2-м этаже 5-этажного дома. Общая площадь 85,9 кв.м.')
    ], t);
    assert.equal(records[0].city, 'Дайнова-1');
    assert.equal(records[0].totalArea, 60.6);
    assert.equal(records[1].address, 'Пролыгина, 6/2');
    assert.equal(records[2].address, 'Фурманова, 60, корпус 2');
    assert.equal(records[3].address, 'М.Горького');
    assert.equal(records[3].rooms, 2);
    assert.equal(records[4].city, null);
    assert.equal(records[4].address, null);
    assert.equal(records[5].city, 'Первомайский');
    assert.equal(records[6].city, null);
    assert.equal(records[6].address, 'СТ Зорька');
    assert.equal(records[7].totalArea, 85.9);
    assert.equal(records[7].floor, 2);
    assert.equal(records[7].floors, 5);
});

test('Bizlida rejects malformed and empty exports instead of silently importing nothing', async (t) => {
    await assert.rejects(parseRows([['not', 'a', 'Bizlida link']], t), /неверный формат строки/u);
    await assert.rejects(parseRows([], t), /нет объявлений/u);
});

test('all four platforms match without reporting a missing Bizlida contract', () => {
    const report = compare();
    assert.equal(report.objects.length, 1);
    assert.equal(report.categories.everywhere, 1);
    assert.equal(report.stats.matchPercent, 100);
    assert.equal(report.stats.bizlidaCount, 1);
    assert.equal(report.stats.withoutContract, 0);
    assert.equal(report.errors.length, 0);
    assert.deepEqual(report.objects[0].presence, { site: true, ilvo: true, kufar: true, bizlida: true });
});

test('missing Bizlida affects coverage, errors, and object status; previous history has no NaN delta', () => {
    const report = compare({ bizlida: [] });
    assert.equal(report.categories.missingBizlida, 1);
    assert.equal(report.categories.everywhere, 0);
    assert.equal(report.objects[0].status, 'missing');
    assert.ok(report.errors.some((e) => e.type === 'Объект отсутствует в Bizlida'));
    const next = runComparison({ site: [], ilvo: [], kufar: [], bizlida: [], contracts: [] }, { stats: {} });
    assert.equal(next.deltas.bizlida, 0);
});

test('Bizlida-only listings are included everywhere except contract validation and counters', () => {
    const report = compare({ site: [], ilvo: [], kufar: [] });
    assert.equal(report.categories.onlyBizlida, 1);
    assert.equal(report.stats.totalUnique, 1);
    assert.equal(report.stats.withoutContract, 0);
    assert.equal(report.contracts.length, 0);
    assert.ok(!report.errors.some((e) => /договор/u.test(e.type)));
    assert.equal(report.categories.missingSite, 1);
    assert.equal(report.categories.missingIlvo, 1);
    assert.equal(report.categories.missingKufar, 1);
});

test('Bizlida prices use ILVO as reference, not the website or Kufar', () => {
    let report = compare({ bizlida: [rec('bizlida', { price: 135000 })] });
    assert.equal(report.objects.length, 1);
    assert.equal(report.objects[0].fieldDiffs.find((d) => d.field === 'price').values.bizlida, 135000);
    report = compare({ ilvo: [], bizlida: [rec('bizlida', { price: 135000 })] });
    assert.ok(!report.errors.some((e) => e.type === 'Разная цена'));
});

test('partial addresses cannot merge ambiguous listings or different villages', () => {
    const site = [rec('site', { id: 'a', address: 'ул. Машерова, 1', contractNumber: '1/1' }),
        rec('site', { id: 'b', address: 'ул. Машерова, 2', contractNumber: '2/1' })];
    const report = compare({ site, ilvo: [], kufar: [],
        bizlida: [rec('bizlida', { title: '3-к квартира', address: 'ул. Машерова' })] });
    assert.equal(report.objects.length, 3);
    assert.equal(report.categories.onlyBizlida, 1);
    const differentVillage = compare({ bizlida: [rec('bizlida', { city: 'Кривичи' })] });
    assert.equal(differentVillage.objects.length, 2);
});

test('Bizlida village matches a district export by locality, price, and type', () => {
    const report = compare({
        site: [rec('site', { city: 'Лидский район', address: 'ул. Центральная, 11, аг. Лайковщина' })],
        ilvo: [], kufar: [],
        bizlida: [rec('bizlida', { city: 'Лайковщина', address: null, title: '3 комнатная квартира аг.Лайковщина' })]
    });
    assert.equal(report.objects.length, 1);
    assert.equal(report.objects[0].presence.bizlida, true);
});

test('same town, price, and type never override conflicting Bizlida rooms or area', () => {
    for (const changed of [{ rooms: 4 }, { totalArea: 99 }]) {
        const report = compare({ site: [], kufar: [],
            bizlida: [rec('bizlida', { address: null, title: 'Квартира в центре', ...changed })] });
        assert.equal(report.objects.length, 2);
        assert.equal(report.categories.onlyBizlida, 1);
        assert.equal(report.categories.missingBizlida, 1);
    }
});

test('same locality, price, and generic type alone do not establish a listing identity', () => {
    const report = compare({ site: [], kufar: [],
        bizlida: [rec('bizlida', { address: null, rooms: null, totalArea: null, title: 'Продаётся квартира' })] });
    assert.equal(report.objects.length, 2);
    assert.equal(report.categories.everywhere, 0);
});

test('a street-only match cannot hide conflicting properties at a particular house', () => {
    for (const changed of [{ rooms: 4 }, { totalArea: 100 }, { floor: 4 }]) {
        const report = compare({
            site: [], kufar: [],
            ilvo: [rec('ilvo', { address: 'Машерова, 1', floor: 2 })],
            bizlida: [rec('bizlida', { address: 'Машерова', title: 'Квартира по ул. Машерова', ...changed })]
        });
        assert.equal(report.objects.length, 2);
        assert.equal(report.categories.missingBizlida, 1);
    }
});

test('a street, price, and generic type without property dimensions remain unconfirmed', () => {
    const report = compare({ site: [], kufar: [],
        ilvo: [rec('ilvo', { address: 'Машерова, 1' })],
        bizlida: [rec('bizlida', { address: 'Машерова', rooms: null, totalArea: null, title: 'Продажа квартиры' })] });
    assert.equal(report.objects.length, 2);
    assert.equal(report.categories.onlyBizlida, 1);
});

test('a partial Bizlida match cannot ignore conflicting data in another source in the group', () => {
    const report = compare({
        ilvo: [rec('ilvo', { rooms: 4 })],
        bizlida: [rec('bizlida', { address: 'Машерова' })]
    });
    assert.equal(report.objects.length, 2);
    assert.equal(report.categories.onlyBizlida, 1);
    assert.equal(report.categories.missingBizlida, 1);
});

test('different houses are not matched through otherwise identical Bizlida descriptors', () => {
    const report = compare({ site: [], kufar: [],
        ilvo: [rec('ilvo', { address: 'Машерова, 1' })],
        bizlida: [rec('bizlida', { address: 'Машерова, 2' })] });
    assert.equal(report.objects.length, 2);
    assert.equal(report.categories.onlyBizlida, 1);
});

test('a number in a street name is not treated as a precise house address', () => {
    const report = compare({ site: [], kufar: [],
        ilvo: [rec('ilvo', { address: 'ул. 7 Ноября, 8' })],
        bizlida: [rec('bizlida', { address: 'ул. 7 Ноября', rooms: 4 })] });
    assert.equal(report.objects.length, 2);
    assert.equal(report.categories.onlyBizlida, 1);
});

test('Bizlida slash corpus and inflected street names match without an address warning', () => {
    for (const [siteAddress, bizAddress] of [
        ['ул. Пролыгина, 6 корпус 2', 'Пролыгина, 6/2'],
        ['ул. Аэродромная, 19', 'Аэродромной']
    ]) {
        const report = compare({ site: [rec('site', { address: siteAddress })], ilvo: [], kufar: [],
            bizlida: [rec('bizlida', { address: bizAddress, title: 'Объявление без повторного заголовка' })] });
        assert.equal(report.objects.length, 1);
        assert.ok(!report.errors.some((e) => e.type === 'Разный адрес'));
    }
});

test('duplicate Bizlida URLs collapse, but distinct ads in the same house do not', () => {
    const report = compare({ site: [], ilvo: [], kufar: [],
        bizlida: [rec('bizlida'), rec('bizlida'), rec('bizlida', { id: 'different-ad' })] });
    assert.equal(report.stats.bizlidaCount, 2);
    assert.equal(report.objects.length, 2);
});

test('sold and inactive listings do not produce missing Bizlida errors', () => {
    for (const extra of [
        { site: [rec('site', { status: 'sold' })], bizlida: [] },
        { site: [], ilvo: [rec('ilvo', { status: 'inactive' })], bizlida: [] }
    ]) {
        const report = compare(extra);
        assert.equal(report.categories.missingBizlida, 0);
        assert.ok(!report.errors.some((e) => e.type === 'Объект отсутствует в Bizlida'));
    }
});

test('Excel reports expose Bizlida presence and compared values', () => {
    const report = compare({ bizlida: [rec('bizlida', { price: 135000 })] });
    const { workbook: full } = buildWorkbook('full', report);
    const rows = XLSX.utils.sheet_to_json(full.Sheets['Данные'], { range: 3 });
    assert.equal(rows[0]['Есть в Bizlida'], 'Есть');
    const { workbook: diffs } = buildWorkbook('diffs', report);
    const values = XLSX.utils.sheet_to_json(diffs.Sheets['Данные'], { range: 3 });
    assert.equal(values[0]['Значение — Bizlida'], 135000);
});
