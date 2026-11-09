'use strict';

const cheerio = require('cheerio');
const { parseBizlidaListing } = require('./parsers');

const CATEGORY_URL = 'https://bizlida.by/baraholka/cat/37';
const ORIGIN = new URL(CATEGORY_URL).origin;
const SELLER_PATH = '/profile/77645';
const MAX_PAGES = 100;
const MAX_LISTINGS = 2000;
const MAX_HTML_BYTES = 5 * 1024 * 1024;
const normalizeSeller = (text) => text.toLowerCase().replace(/[^а-яёa-z0-9]/gu, '');
const isAgency = (text) => normalizeSeller(text) === 'ангермесгарант';

function fail(message) {
    throw new Error(`Bizlida: ${message}`);
}

function listingUrl(href) {
    const url = new URL(href || '', ORIGIN);
    if (url.origin !== ORIGIN || !/^\/baraholka\/\d+\/?$/u.test(url.pathname)) {
        fail('изменилась ссылка объявления. Обновление остановлено.');
    }
    return `${ORIGIN}${url.pathname.replace(/\/$/u, '')}`;
}

function parseCategory(html, page) {
    const $ = cheerio.load(html);
    // Do not collect sidebar recommendations or promoted mini-cards.
    const articles = $('article.advert-item');
    if (!articles.length) fail(`на странице ${page} не распознан список объявлений.`);
    const ids = [];
    const urls = [];
    articles.each((_, node) => {
        const item = $(node);
        const url = listingUrl(item.find('a.headline').first().attr('href'));
        const seller = item.find('.seller').text().trim();
        if (!seller) fail(`на странице ${page} не распознан продавец.`);
        ids.push(url);
        if (isAgency(seller)) urls.push(url);
    });
    const pages = [page];
    let nextPage = null;
    const pagination = $('nav.pagination');
    if (pagination.length !== 1) fail('не распознана пагинация. Полнота загрузки не подтверждена.');
    const current = pagination.find('[aria-current="page"]');
    if (current.length && Number(current.text().trim()) !== page) fail('сайт вернул другую страницу раздела.');
    pagination.find('a').each((_, node) => {
        const url = new URL($(node).attr('href') || '', CATEGORY_URL);
        const number = Number(url.searchParams.get('page'));
        if (url.origin !== ORIGIN || url.pathname !== '/baraholka/cat/37'
            || !Number.isInteger(number) || number < 1 || number > MAX_PAGES) {
            fail('не удалось безопасно определить страницы раздела.');
        }
        pages.push(number);
        if ($(node).attr('rel')?.split(/\s+/u).includes('next')) nextPage = number;
    });
    if (nextPage !== null && nextPage !== page + 1) fail('нарушен порядок страниц.');
    return { urls, ids, nextPage, lastPage: Math.max(...pages) };
}

function textWithBreaks($, selector) {
    const node = $(selector).first().clone();
    node.find('br').replaceWith('\n');
    return node.text().replace(/\u00a0/gu, ' ').trim();
}

function parseListing(html, url) {
    const $ = cheerio.load(html);
    const author = $('.record-author__name');
    const authorUrl = new URL(author.attr('href') || '', ORIGIN);
    if (!isAgency(author.text()) || authorUrl.origin !== ORIGIN || authorUrl.pathname !== SELLER_PATH) {
        fail(`не подтверждён аккаунт агентства: ${url}`);
    }
    const titleNode = $('h1').first().clone();
    const type = titleNode.find('.record-type').text().trim().replace(/:$/u, '');
    titleNode.find('.record-type').remove();
    const title = titleNode.text().trim();
    const description = textWithBreaks($, '.record-text');
    if (!title || !description || !$('.advert-record').length) fail(`не распознана карточка ${url}`);
    const currency = $('meta[itemprop="priceCurrency"]').attr('content');
    const rawPrice = $('meta[itemprop="price"]').attr('content');
    let price = null;
    if (rawPrice !== undefined) {
        if (currency !== 'BYN') fail(`неподдерживаемая валюта в ${url}`);
        const cleaned = rawPrice.replace(/[\s\u00a0\u202f]/gu, '').replace(',', '.');
        if (!/^\d+(?:\.\d+)?$/u.test(cleaned) || !Number.isFinite(Number(cleaned))) {
            fail(`не распознана цена в ${url}`);
        }
        price = Number(cleaned);
    } else if (!$('.record-card__price').length || $('.record-card__amount').length) {
        fail(`не распознан блок цены в ${url}`);
    }
    const stats = {};
    $('.record-stats > div').each((_, node) => {
        stats[$(node).find('dt').text().trim()] = $(node).find('dd').text().trim();
    });
    const photos = [...new Set($('.record-gallery a[itemprop="image"]').map((_, node) => (
        new URL($(node).attr('href'), ORIGIN).href
    )).get())];
    return parseBizlidaListing({
        id: url.match(/\/(\d+)$/u)[1],
        listingUrl: url,
        title,
        lead: textWithBreaks($, '.record__lead'),
        description,
        dealType: ({ Продам: 'Продажа', Аренда: 'Аренда' })[type] || null,
        price,
        photos,
        seller: author.text().trim(),
        publishedText: stats['Размещено'] || null,
        updatedText: stats['Обновлено'] || null,
        fetchedAt: new Date().toISOString()
    });
}

async function fetchHtml(url, fetchImpl) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
        const response = await fetchImpl(url, {
            signal: controller.signal,
            redirect: 'error',
            headers: { Accept: 'text/html', 'User-Agent': 'GermesControl/1.0 (agency listing verification)' }
        });
        if (!response.ok) fail(`HTTP ${response.status}. Обновление остановлено.`);
        if (!response.headers.get('content-type')?.includes('text/html')) fail('сервер вернул не HTML.');
        const chunks = [];
        let bytes = 0;
        for await (const chunk of response.body) {
            bytes += chunk.length;
            if (bytes > MAX_HTML_BYTES) {
                controller.abort();
                fail('превышен допустимый размер страницы.');
            }
            chunks.push(Buffer.from(chunk));
        }
        const html = Buffer.concat(chunks).toString('utf8');
        if (/g-recaptcha|h-captcha|cf-chl-|<title>[^<]*(?:captcha|just a moment)/iu.test(html)) {
            fail('сайт запросил проверку доступа. Повторите позже.');
        }
        return html;
    } catch (error) {
        if (error.name === 'AbortError') fail('страница не ответила за 30 секунд.');
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

async function scrapeBizlida({
    fetchImpl = fetch,
    delay = () => new Promise((resolve) => setTimeout(resolve, 700)),
    onProgress = () => {}
} = {}) {
    const startedAt = new Date().toISOString();
    const urls = new Set();
    const seenPages = new Set();
    let page = 1;
    let lastPage = 1;
    let requests = 0;
    async function get(url) {
        if (requests++) await delay();
        return fetchHtml(url, fetchImpl);
    }
    while (true) {
        onProgress({ phase: 'pages', page, total: lastPage, count: urls.size });
        const result = parseCategory(await get(`${CATEGORY_URL}?page=${page}`), page);
        const signature = [...result.ids].sort().join('|');
        if (seenPages.has(signature)) fail('сайт повторяет страницы. Полнота загрузки не подтверждена.');
        seenPages.add(signature);
        result.urls.forEach((url) => urls.add(url));
        if (urls.size > MAX_LISTINGS) fail('превышен лимит объявлений.');
        lastPage = Math.max(lastPage, result.lastPage);
        if (!result.nextPage) {
            if (page < lastPage) fail('пропала ссылка на следующую страницу.');
            break;
        }
        if (page >= MAX_PAGES) fail('превышен лимит страниц.');
        page = result.nextPage;
    }
    // Empty snapshots require human review; never erase a previous successful import.
    if (!urls.size) fail('объявления агентства не найдены. Предыдущие данные сохранены.');
    const records = [];
    for (const url of urls) {
        onProgress({ phase: 'listings', completed: records.length, total: urls.size, pages: page });
        records.push(parseListing(await get(url), url));
    }
    onProgress({ phase: 'complete', completed: records.length, total: urls.size, pages: page });
    return { records, pages: page, sourceUrl: CATEGORY_URL, startedAt, completedAt: new Date().toISOString() };
}

module.exports = { scrapeBizlida, parseCategory, parseListing, CATEGORY_URL };
