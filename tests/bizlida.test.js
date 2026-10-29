'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const XLSX = require('xlsx');
const { parseBizlidaXlsx, parseKufarXml, finalizeRecord } = require('../src/main/parsers');
const { runComparison } = require('../src/main/compare');
const { buildWorkbook } = require('../src/main/reports');
const { propertyFeatures, extractBizlidaLocation } = require('../src/main/bizlida');

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

test('Bizlida refines the title street from the description without taking a nearby street', async (t) => {
    const records = await parseRows([
        row(1, 'Квартира ул. Машерова', 'Адрес: ул. Машерова, 23 корп.1. Рядом ул. Победы, 100.'),
        row(2, 'Квартира ул. Машерова', 'Рядом ул. Победы, 100.'),
        row(3, 'Дом под реконструкцию д.Горни', 'Просторное помещение к перепланировке.'),
        row(4, 'Квартира', 'Адрес офиса: г. Лида, ул. Победы, 100.')
    ], t);
    assert.equal(records[0].address, 'Машерова, 23, корпус 1');
    assert.equal(records[1].address, 'Машерова');
    assert.equal(records[2].address, null);
    assert.equal(records[3].address, null);
});

test('Bizlida parses numeric street names, full street words, house letters, and dotted corps', async (t) => {
    const records = await parseRows([
        row(1, 'Квартира на улице 7 ноября, д.8 к.2'),
        row(2, 'Дом на улице Аэродромной, 19В'),
        row(3, 'Дом ул. 40 лет Победы, 12'),
        row(4, 'Дом г.п.Вороново', 'Дом в г.п.Вороново Этот дом продаётся.'),
        row(5, 'Дом д. Красная Слобода'),
        row(6, 'Дом в деревне Кривичи Ивьевского района')
    ], t);
    assert.equal(records[0].address, '7 ноября, 8, корпус 2');
    assert.equal(records[1].address, 'Аэродромной, 19В');
    assert.equal(records[2].address, '40 лет Победы, 12');
    assert.equal(records[3].city, 'Вороново');
    assert.equal(records[4].city, 'Красная Слобода');
    assert.equal(records[5].city, 'Кривичи');
});

test('Bizlida finds the property village after a distance reference and never defaults to Lida', () => {
    assert.equal(extractBizlidaLocation('Дом в 7 км от города Лида (д. Нетечь).', '').city, 'Нетечь');
    assert.equal(extractBizlidaLocation('Строение в 12 км от центра города Лида', '').city, null);
    assert.equal(extractBizlidaLocation('ДАЧА СТ Зорька, 15 мин от г.Лида', '').city, null);
});

test('Bizlida keeps total area separate from SNB and reads truncated areas and title floors', async (t) => {
    const records = await parseRows([
        row(1, 'Двухэтажный дом', 'Общая площадь 62,1 …'),
        row(2, '3-комнатная квартира', 'Общая площадь по СНБ -82.3 кв.м.'),
        row(3, '4к квартира', 'Общая площадь по СНБ 85м3, жилая площадь -53.6м3'),
        row(4, '2к квартира', 'Общая площадь 57.2 м3.'),
        row(5, 'Квартира', 'Общая площадь 79,6 м2, площадь по СНБ 82,9 м2.')
    ], t);
    assert.equal(records[0].totalArea, 62.1);
    assert.equal(records[0].floors, 2);
    assert.equal(records[1].totalArea, null);
    assert.equal(propertyFeatures(records[1]).snb, 82.3);
    assert.equal(records[2].totalArea, null);
    assert.equal(records[3].totalArea, 57.2);
    assert.equal(records[4].totalArea, 79.6);
});

test('locationless price, type, and rooms alone never match even a sole candidate', () => {
    const report = compare({ site: [], kufar: [],
        bizlida: [rec('bizlida', { city: null, address: null, totalArea: null, title: 'Квартира в центре' })] });
    assert.equal(report.objects.length, 2);
    assert.equal(report.categories.missingBizlida, 1);
});

test('same town, price, type, and rooms without dimensions are not sufficient either', () => {
    const report = compare({ site: [], kufar: [],
        bizlida: [rec('bizlida', { address: null, totalArea: null, title: 'Квартира в центре' })] });
    assert.equal(report.objects.length, 2);
});

test('village and street-only listings match using plot area, floors, or construction year', async (t) => {
    for (const [title, description, counterpart] of [
        ['Жилой дом д.Татарцы', 'На участке в 25 соток.', { city: 'д. Татарцы', address: 'д. Татарцы, 6', description: 'Участок площадью 25 соток.' }],
        ['Полдома на улице Тургенева', 'На участке площадью 6 соток.', { address: 'ул. Тургенева', description: 'Участок площадью 6 соток.' }],
        ['Двухэтажный дом на ул. Зелёная (Новосёлки)', '', { city: 'Лидский район', address: 'ул. Зеленая, 6, д. Новосёлки', floors: 2 }],
        ['Евродвушка в новом доме, 2026гп', 'Новостройка в районе ул.Тухачевского', { address: 'ул. Тухачевского, 49А', description: 'Дом построен в 2026 году.', type: 'Квартира', rooms: 1 }]
    ]) {
        const [biz] = await parseRows([row(1, title, description)], t);
        const report = compare({ site: [rec('site', { type: 'Дом', ...counterpart })], ilvo: [], kufar: [], bizlida: [biz] });
        assert.equal(report.objects.length, 1, title);
    }
});

test('a garden house classified as House on the site matches Dacha with garden and plot evidence', async (t) => {
    const [biz] = await parseRows([row(1, 'ДАЧА СТ Зорька', 'Участок 10 соток, домик 2023 гп')], t);
    const report = compare({ site: [rec('site', {
        type: 'Дом', address: 'СТ «Зорька», участок 56', title: 'Дача в СТ «Зорька»',
        description: 'Участок площадью 10 соток, дом построен в 2023 году.'
    })], ilvo: [], kufar: [], bizlida: [biz] });
    assert.equal(report.objects.length, 1);
});

test('locationless listings require multiple specific details and reject their contradictions', async (t) => {
    const [biz] = await parseRows([row(1, 'Незавершенное строение 2024 года постройки в 12 км от центра города Лида')], t);
    for (const [year, distance, expected] of [[2024, 12, 1], [2023, 12, 2], [2024, 20, 2]]) {
        const report = compare({ site: [rec('site', { type: 'Дом',
            description: `Дом построен в ${year} году, в ${distance} км от Лиды.` })],
        ilvo: [], kufar: [], bizlida: [biz] });
        assert.equal(report.objects.length, expected);
    }
});

test('matching SNB uses SNB on the other side, not its smaller total area', async (t) => {
    const [biz] = await parseRows([row(1, '3-комнатная квартира', 'Общая площадь по СНБ -82.3 кв.м.')], t);
    const report = compare({ site: [rec('site', { totalArea: 79.6, description: 'Общая площадь 79,6 м2, по СНБ 82,9 м2.' })],
        ilvo: [], kufar: [], bizlida: [biz] });
    assert.equal(report.objects.length, 1);
    assert.ok(!report.objects[0].fieldDiffs.some((diff) => diff.field === 'totalArea'));
});

test('contradictory plot/year evidence and equal-strength candidates stay separate', async (t) => {
    const [biz] = await parseRows([row(1, 'Дом д.Татарцы', 'Участок 25 соток.')], t);
    const base = { type: 'Дом', city: 'д. Татарцы', address: 'д. Татарцы, 6', description: 'Участок 15 соток.' };
    let report = compare({ site: [rec('site', base)], ilvo: [], kufar: [], bizlida: [biz] });
    assert.equal(report.objects.length, 2);
    report = compare({ site: [
        rec('site', { ...base, id: 'a', description: 'Участок 25 соток.', contractNumber: '1/1' }),
        rec('site', { ...base, id: 'b', address: 'д. Татарцы, 7', description: 'Участок 25 соток.', contractNumber: '2/1' })
    ], ilvo: [], kufar: [], bizlida: [biz] });
    assert.equal(report.objects.length, 3);
    assert.equal(report.categories.onlyBizlida, 1);
});

test('saved Bizlida imports are reparsed from original texts before comparison without editing them', async (t) => {
    const [biz] = await parseRows([row(1, '3-к квартира ул. Машерова', 'ул. Машерова, 23 корп.1. Общая площадь 62,1 …')], t);
    const old = { ...biz, address: 'Машерова', totalArea: null };
    const report = compare({ site: [], kufar: [], bizlida: [old] });
    assert.equal(report.objects.length, 1);
    assert.equal(old.address, 'Машерова');
    assert.equal(old.totalArea, null);
});

test('rounded plot sizes do not hide a village listing with corroborating total area', async (t) => {
    const [biz] = await parseRows([row(1, 'Дом д.Горни', 'Общая площадь 71 м2. Участок 10 соток.')], t);
    const report = compare({ site: [rec('site', {
        type: 'Дом', city: 'Лидский район', address: 'ул. Полевая, 1А, д. Горни',
        totalArea: 71.2, description: 'Участок площадью 10,7 сотки.'
    })], ilvo: [], kufar: [], bizlida: [biz] });
    assert.equal(report.objects.length, 1);
});

test('a Kufar house with land is not misclassified as land and does not block the Bizlida group', async (t) => {
    const records = await parseKufarXml(`<uedb><records>
        <record><unid>house</unid><category>1020</category><subject>Дом с участком в СТ Лесное</subject><price>120000</price><size>120</size></record>
        <record><unid>plot</unid><category>1020</category><subject>Земельный участок под строительство жилого дома</subject></record>
        </records></uedb>`, true);
    assert.equal(records[0].type, 'Дом');
    assert.equal(records[1].type, 'Участок');
    const [biz] = await parseRows([row(1, 'Дом с участком в СТ Лесное', 'Общая площадь 120 м2.')], t);
    const report = compare({
        site: [rec('site', { contractNumber: null, type: 'Дом', address: 'ул. Лесная, СТ «Лесное»', totalArea: 120 })],
        ilvo: [], kufar: [{ ...records[0], type: 'Участок' }], bizlida: [biz]
    });
    assert.equal(report.objects.length, 1);
    assert.equal(report.objects[0].presence.bizlida, true);
    assert.equal(report.objects[0].presence.kufar, true);
});
