'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    finalizeRecord, parseBizlidaListing, refreshBizlidaRecord
} = require('../src/main/parsers');
const { extractBizlidaLocation, extractBizlidaTotalArea, propertyFeatures } = require('../src/main/bizlida');
const { runComparison } = require('../src/main/compare');
const { ERROR_TYPES } = require('../src/main/schema');
const { buildWorkbook } = require('../src/main/reports');

const zorkaText = `Продается дача, 10 соток. Имеется домик 2023 гп.
Участок общей площадью в 10 соток полностью огорожен.
На участке имеется садовый домик, построенный в 2023 году. Общая площадь 12.7 кв.м.`;
function biz(extra = {}) {
    return parseBizlidaListing({
        id: '136084', listingUrl: 'https://bizlida.by/baraholka/136084',
        title: 'ДАЧА СТ Зорька, 15 мин от г.Лида', price: 18000,
        description: zorkaText, dealType: 'Продажа', ...extra
    });
}
function site(extra = {}) {
    return finalizeRecord({
        id: 'site-zorka', title: 'Дача в СТ «Зорька» в Лидском районе',
        address: 'СТ «Зорька», участок 56, Дитвянский сельсовет, Лидский район',
        city: 'Лида', type: 'Дом', dealType: 'Продажа', price: 17000,
        totalArea: 12.7, rooms: 1, floors: 1, status: 'active',
        description: 'Участок площадью 10 соток. Садовый домик построен в 2023 году.',
        contractNumber: 'Договор №122/1 от 12.10.2026', ...extra
    }, 'site', 'site');
}
function compare(sites, ads, extra = {}) {
    return runComparison({
        site: sites, ilvo: [], kufar: [], bizlida: ads, contracts: [],
        includeContractRegistry: false, ...extra
    });
}

test('Zorka separates the 10-sotka plot from the 12.7-square-metre house', () => {
    const record = biz();
    assert.equal(record.totalArea, 12.7);
    assert.equal(propertyFeatures(record).plot, 10);
    assert.equal(propertyFeatures(record).year, 2023);
    assert.equal(record.address, 'СТ Зорька');
    assert.equal(record.city, null);
});

test('land units and land clauses never become total house area; truncated house areas still work', () => {
    for (const text of [
        'Общая площадь участка 10 соток.',
        'Участок общей площадью 0,1 га.',
        'Участок общей площадью 1000 м2.'
    ]) assert.equal(extractBizlidaTotalArea(text), null, text);
    assert.equal(extractBizlidaTotalArea('Участок 10 соток, общая площадь дома 12,7 м2.'), 12.7);
    assert.equal(extractBizlidaTotalArea('Общая площадь 62,1 …'), 62.1);
    assert.equal(extractBizlidaTotalArea('Общая площадь по СНБ 65 м2.'), null);
});

test('Zorka matches despite a stale price; comparison against ILVO still flags the price', () => {
    const ilvo = { ...site(), id: 'ilvo', source: 'ilvo' };
    const report = compare([site()], [biz()], { ilvo: [ilvo] });
    assert.equal(report.objects.length, 1);
    assert.equal(report.objects[0].presence.bizlida, true);
    assert.equal(report.objects[0].contractNumber, '122/1');
    assert.ok(report.objects[0].fieldDiffs.some((diff) => diff.field === 'price'));
    assert.ok(report.errors.some((error) => error.type === ERROR_TYPES.PRICE_MISMATCH));
    assert.ok(!report.errors.some((error) => error.type === ERROR_TYPES.MISSING_SITE));
    assert.equal(report.objects[0].fieldDiffs.find((diff) => diff.field === 'price').values.bizlida, 18000);
});

test('same garden/town and price difference are not enough without independent property details', () => {
    const report = compare([site()], [biz({ description: 'Дача в тихом месте.' })]);
    assert.equal(report.objects.length, 2);
    const record = report.objects.find((obj) => obj.presence.bizlida);
    assert.equal(record.status, 'unconfirmed');
    assert.equal(report.categories.missingSite, 0);
    assert.equal(report.categories.unconfirmed, 1);
    assert.ok(report.errors.some((error) => error.type === ERROR_TYPES.MATCH_UNCONFIRMED && error.severity === 'warning'));
    assert.ok(!report.errors.some((error) => error.type === ERROR_TYPES.MISSING_SITE));
});

test('conflicting construction year or plot blocks the price-independent fallback', () => {
    for (const description of [
        zorkaText.replaceAll('2023', '2022'),
        zorkaText.replaceAll('10 соток', '20 соток')
    ]) assert.equal(compare([site()], [biz({ description })]).objects.length, 2);
});

test('two equally supported garden candidates remain unconfirmed, not merged by list order', () => {
    const report = compare([
        site(), site({ id: 'other', address: 'СТ «Зорька», участок 57', contractNumber: '123/1' })
    ], [biz()]);
    assert.equal(report.objects.length, 3);
    assert.equal(report.objects.find((obj) => obj.presence.bizlida).status, 'unconfirmed');
});

test('a different village cannot match by identical dimensions, year and plot', () => {
    const record = biz({ title: 'Дача в д. Другая', description: zorkaText });
    assert.equal(compare([site()], [record]).objects.length, 2);
});

test('Vorobyi does not extract street Dom from a following paragraph', () => {
    const location = extractBizlidaLocation('Дом в д.Воробьи Щучинского района',
        'Удобства: Находятся на улице\n\nДом находится в состоянии для ремонта.');
    assert.deepEqual(location, { city: 'Воробьи', address: null });
    assert.equal(extractBizlidaLocation('Квартира на ул. Л. Чайкиной, 9', '').address, 'Л. Чайкиной, 9');
});

test('Vorobyi extracts service-contract marker and links to the base, without checking Bizlida contracts', () => {
    const record = biz({
        id: '135572', listingUrl: 'https://bizlida.by/baraholka/135572',
        title: 'Дом в д.Воробьи Щучинского района', price: 10000,
        description: `Общая площадь: 42,43 м2. Жилая площадь: 21 м2. Площадь кухни: 21 м2.
Удобства: Находятся на улице

Дом находится в состоянии, пригодном для ремонта.
ООО "ГермесГарант". Договор оказания услуг 15/1 от 07.07.2026`
    });
    assert.equal(record.matchingContractKey, '15/1');
    assert.equal(record.contractNumber, null);
    assert.equal(record.address, null);
    const counterpart = site({
        id: 'vorobyi', title: 'Дом в деревне Воробьи Щучинского района',
        city: 'Щучинский район', address: 'д. Воробьи, 16, Первомайский сельсовет',
        price: 10000, totalArea: 42.6, livingArea: 20.8, kitchenArea: 21.8,
        description: 'Дом в деревне Воробьи.', contractNumber: 'Договор №15/1 от 07.07.2026'
    });
    const report = compare([counterpart], [record]);
    assert.equal(report.objects.length, 1);
    assert.equal(report.objects[0].presence.bizlida, true);
    assert.equal(report.objects[0].contractNumber, '15/1');
    assert.ok(!report.errors.some((error) => error.type === ERROR_TYPES.NO_CONTRACT));
});

test('saved Bizlida imports are reparsed for both wrong areas and service-contract keys', () => {
    assert.equal(refreshBizlidaRecord({ ...biz(), totalArea: 10 }).totalArea, 12.7);
    const old = {
        ...biz({ title: 'Дом в д.Воробьи', description: 'Договор оказания услуг 15/1 от 07.07.2026' }),
        matchingContractKey: null
    };
    assert.equal(refreshBizlidaRecord(old).matchingContractKey, '15/1');
});

test('two explicit service contracts remain ambiguous, never picking the first', () => {
    const record = biz({ description: 'Договор оказания услуг 15/1 и Договор №16/1.' });
    assert.equal(record.matchingContractKey, null);
});

test('the cache version is synchronized so saved reports will be recalculated', () => {
    const report = compare([site()], [biz()]);
    const stateCode = fs.readFileSync(path.join(__dirname, '../render/js/state.js'), 'utf8');
    const [, version] = stateCode.match(/REPORT_MATCHING_VERSION = (\d+)/u);
    assert.equal(report.matchingVersion, Number(version));
    assert.ok(report.matchingVersion > 14);
});

test('unconfirmed matches are explicitly labeled in XLSX and not exported as proven missing', () => {
    const report = compare([], [biz()]);
    const { rows } = buildWorkbook('full', report);
    assert.equal(rows[0]['Статус данных'], 'Сопоставление не подтверждено');
    assert.equal(buildWorkbook('missing', report).rows.length, 0);
});
