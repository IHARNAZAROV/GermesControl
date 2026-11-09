'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCategory, parseListing, scrapeBizlida, CATEGORY_URL } = require('../src/main/bizlidaScraper');
const { runComparison } = require('../src/main/compare');
const { finalizeRecord } = require('../src/main/parsers');

const url = (id) => `https://bizlida.by/baraholka/${id}`;
function category(ids = [1], { next = null, last = null, seller = 'АН ГермесГарант' } = {}) {
    return `<h1>Недвижимость</h1>${ids.map((id) => `<article class="item advert-item">
        <span class="seller">${seller}</span><a class="headline" href="/baraholka/${id}">Объект</a>
        </article>`).join('')}
        <nav class="pagination">${last ? `<a href="?page=${last}">${last}</a>` : ''}
        ${next ? `<a href="?page=${next}" rel="next">Следующая</a>` : ''}</nav>
        <aside><a class="headline" href="/baraholka/9999">Рекомендация</a></aside>`;
}

function card(id = 1, {
    seller = 'АН ГермесГарант', account = '77645', currency = 'BYN',
    price = '138 600,25', body = 'Общая площадь 62,5 м2. Жилая площадь 40,1 м2. Кухня 8 м2.'
} = {}) {
    return `<h1><span class="record-type">Продам<span>:</span></span>3-к квартира ул. Фурманова 60-2</h1>
    <div class="record advert-record">
    <div class="record-card__price"><div class="record-card__amount">
    <meta itemprop="price" content="${price}"><meta itemprop="priceCurrency" content="${currency}">
    </div></div>
    <a class="record-author__name" href="/profile/${account}">${seller}</a>
    <p class="record__lead">Квартира на 4-м этаже 5-этажного дома.</p>
    <div class="record-text">${body}<br>Договор 56/1 от 8.08.2026<br>
    Консультации по покупке, продаже, обмену недвижимости: г. Лида, б-р. Князя Гедимина.12, пом.9</div>
    <div class="record-gallery"><a itemprop="image" href="/photo-${id}.jpg">Фото</a></div>
    <dl class="record-stats"><div><dt>Размещено</dt><dd>8 ноября 2026</dd></div>
    <div><dt>Обновлено</dt><dd>9 ноября 2026, 07:24</dd></div></dl></div>`;
}

function server(pages) {
    const requests = [];
    return {
        requests,
        fetchImpl: async (target) => {
            requests.push(target);
            if (!(target in pages)) throw new Error(`Unexpected request: ${target}`);
            const value = pages[target];
            if (value instanceof Error) throw value;
            return value instanceof Response ? value
                : new Response(value, { headers: { 'content-type': 'text/html; charset=UTF-8' } });
        }
    };
}

const noDelay = async () => {};

test('category selects agency only and ignores sidebar recommendations', () => {
    const html = category([1, 2], { next: 2, last: 3 })
        + '<article class="advert-item"><span class="seller">Другой продавец</span><a class="headline" href="/baraholka/3">Объект</a></article>';
    assert.deepEqual(parseCategory(html, 1), { urls: [url(1), url(2)], ids: [url(1), url(2), url(3)], nextPage: 2, lastPage: 3 });
});

test('detail parses full descriptions, explicit currency, contract fallback and property parameters', () => {
    const rec = parseListing(card(), url(1));
    assert.equal(rec.id, '1');
    assert.equal(rec.source, 'bizlida');
    assert.equal(rec.price, 138600.25);
    assert.equal(rec.priceUsd, null);
    assert.equal(rec.totalArea, 62.5);
    assert.equal(rec.livingArea, 40.1);
    assert.equal(rec.kitchenArea, 8);
    assert.equal(rec.floor, 4);
    assert.equal(rec.floors, 5);
    assert.equal(rec.rooms, 3);
    assert.equal(rec.dealType, 'Продажа');
    assert.equal(rec.matchingContractKey, '56/1');
    assert.equal(rec.contractNumber, null);
    assert.match(rec.address, /Фурманова/u);
    assert.doesNotMatch(rec.address, /Гедимина/u);
    assert.match(rec.description, /\nДоговор/u);
    assert.deepEqual(rec.photos, ['https://bizlida.by/photo-1.jpg']);
    assert.equal(rec.publishedText, '8 ноября 2026');
});

test('missing dimensions remain unknown and SNB does not become total area', () => {
    const rec = parseListing(card(1, { body: 'Площадь по СНБ 65 м2.' }), url(1));
    assert.equal(rec.totalArea, null);
    assert.equal(rec.livingArea, null);
    assert.equal(rec.kitchenArea, null);
});

test('refuses wrong account, foreign currency, malformed price and missing description', () => {
    for (const html of [
        card(1, { account: '42' }), card(1, { seller: 'Другой продавец' }),
        card(1, { currency: 'USD' }), card(1, { price: '1.2.3' }),
        card().replace('class="record-text"', 'class="changed-markup"')
    ]) assert.throws(() => parseListing(html, url(1)), /Bizlida/u);
});

test('allows explicit no-price block, but refuses unrecognized price markup', () => {
    const noPrice = card().replace(/<div class="record-card__amount">[\s\S]*?<\/div>/u, 'Договорная');
    assert.equal(parseListing(noPrice, url(1)).price, null);
    assert.throws(() => parseListing(noPrice.replace('record-card__price', 'changed-price'), url(1)));
});

test('walks every page, deduplicates URLs, fetches all cards and emits progress', async () => {
    const fake = server({
        [`${CATEGORY_URL}?page=1`]: category([1, 2], { next: 2 }),
        [`${CATEGORY_URL}?page=2`]: category([2, 3]),
        [url(1)]: card(1), [url(2)]: card(2), [url(3)]: card(3)
    });
    const progress = [];
    let delays = 0;
    const result = await scrapeBizlida({
        fetchImpl: fake.fetchImpl,
        delay: async () => { delays++; },
        onProgress: (p) => progress.push(p)
    });
    assert.equal(result.pages, 2);
    assert.deepEqual(result.records.map((r) => r.id), ['1', '2', '3']);
    assert.equal(fake.requests.length, 5);
    assert.equal(delays, 4);
    assert.equal(progress.at(-1).phase, 'complete');
});

test('rejects repeated pages, missing next link, invalid next link and empty agency result', async () => {
    for (const pages of [
        { [`${CATEGORY_URL}?page=1`]: category([1], { next: 2 }), [`${CATEGORY_URL}?page=2`]: category([1]) },
        { [`${CATEGORY_URL}?page=1`]: category([1], { last: 2 }) },
        { [`${CATEGORY_URL}?page=1`]: category([1], { next: 3 }) },
        { [`${CATEGORY_URL}?page=1`]: category([1], { seller: 'Другой продавец' }) }
    ]) {
        await assert.rejects(scrapeBizlida({ fetchImpl: server(pages).fetchImpl, delay: noDelay }), /Bizlida/u);
    }
});

test('refuses missing pagination and a server returning a different page number', () => {
    assert.throws(() => parseCategory(category().replace(/<nav[\s\S]*?<\/nav>/u, ''), 1), /пагинация/u);
    assert.throws(() => parseCategory(category().replace('<nav class="pagination">', '<nav class="pagination"><span aria-current="page">1</span>'), 2), /другую страницу/u);
});

test('fails closed on a partial card download, HTTP errors, CAPTCHA and non-HTML', async () => {
    for (const failedResponse of [
        new Error('Connection reset'),
        new Response('Forbidden', { status: 403 }),
        '<div class="g-recaptcha">Проверка</div>',
        new Response('{"blocked":true}', { headers: { 'content-type': 'application/json' } })
    ]) {
        const fake = server({
            [`${CATEGORY_URL}?page=1`]: category([1, 2]),
            [url(1)]: card(1), [url(2)]: failedResponse
        });
        await assert.rejects(scrapeBizlida({ fetchImpl: fake.fetchImpl, delay: noDelay }));
    }
});

test('direct record participates in field comparison but not missing-contract checks', () => {
    const record = parseListing(card(), url(1));
    const ilvo = finalizeRecord({
        id: 'ilvo', title: record.title, type: 'Квартира', address: record.address,
        rooms: 3, totalArea: 62.5, livingArea: 40.1, kitchenArea: 11, floor: 4, floors: 5,
        price: 130000, contractNumber: '56/1', status: 'active'
    }, 'ilvo', 'ilvo');
    const report = runComparison({ site: [], ilvo: [ilvo], kufar: [], bizlida: [record], contracts: [], includeContractRegistry: false });
    const grouped = report.objects.find((obj) => obj.presence?.ilvo && obj.presence?.bizlida);
    assert.ok(grouped, 'Bizlida is matched to the existing ILVO object');
    assert.ok(grouped.fieldDiffs.some((diff) => diff.field === 'price'));
    assert.ok(grouped.fieldDiffs.some((diff) => diff.field === 'kitchenArea'));
});
