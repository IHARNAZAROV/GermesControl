'use strict';

const fs = require('fs-extra');
const XLSX = require('xlsx');
const { XMLParser } = require('fast-xml-parser');
const {
    OBJECT_FIELDS,
    extractContractKey,
    extractContractDate,
    normalizeAddressKey,
    normalizeDealType
} = require('./schema');

const NUMERIC_KEYS = new Set(OBJECT_FIELDS.filter((f) => f.numeric).map((f) => f.key));
const SITE_BASE_URL = 'https://germesgarant.by';
const { propertyDescription, extractBizlidaLocation, extractBizlidaTotalArea } = require('./bizlida');

function toNumberOrNull(v) {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(String(v).replace(/[^\d.,\-]/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
}

function cleanString(v) {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s === '' || s === '-' ? null : s;
}

function collectPhotoUrls(value, urls = [], photoContext = false) {
    if (value === undefined || value === null) return urls;
    if (Array.isArray(value)) {
        value.forEach((item) => collectPhotoUrls(item, urls, photoContext));
        return urls;
    }
    if (typeof value === 'string') {
        const candidate = value.trim();
        if (photoContext && (/^(?:https?:)?\/\//i.test(candidate) || candidate.startsWith('/'))) {
            urls.push(candidate.startsWith('//') ? `https:${candidate}` : candidate);
        }
        return urls;
    }
    if (typeof value !== 'object') return urls;

    for (const [key, child] of Object.entries(value)) {
        const normalizedKey = key.toLowerCase();
        const isPhotoKey = /photo|image|picture|gallery|media/.test(normalizedKey);
        const isUrlKey = /^(?:@_)?(?:url|href|src|link)$/.test(normalizedKey);
        if (isPhotoKey || (photoContext && isUrlKey)) {
            collectPhotoUrls(child, urls, true);
        } else if (photoContext && normalizedKey === '#text') {
            collectPhotoUrls(child, urls, true);
        }
    }
    return urls;
}

function extractPhotoUrls(value, baseUrl = null) {
    const urls = [...new Set(collectPhotoUrls({ photos: value }))];
    return baseUrl ? urls.map((url) => new URL(url, baseUrl).href) : urls;
}

/**
 * Достраивает произвольную запись до единой внутренней схемы и
 * вычисляет ключи сопоставления (contractKey / addressKey), по
 * которым один и тот же реальный объект связывается между
 * источниками в src/main/compare.js.
 */
function finalizeRecord(rec, source, syntheticId) {
    const out = {};
    for (const field of OBJECT_FIELDS) {
        let v = rec[field.key];
        if (v === undefined) v = null;
        if (NUMERIC_KEYS.has(field.key)) v = toNumberOrNull(v);
        if (typeof v === 'string') v = v.trim();
        out[field.key] = v === '' ? null : v;
    }
    out.id = out.id || syntheticId;
    out.source = source;
    out.statusDate = cleanString(rec.statusDate);
    out.contractKey = extractContractKey(out.contractNumber);
    out.contractDate = extractContractDate(rec.contractDate) || extractContractDate(out.contractNumber);
    out.addressKey = normalizeAddressKey(out.city, out.address);
    out.photos = extractPhotoUrls(rec.photos);
    return out;
}

/**
 * Сайт ГермесГарант — выгрузка в формате JSON.
 * Полный архив приходит массивом в objects-source.json (либо { objects: [...] })
 * с полями вида
 * priceBYN/priceUSD, areaTotal/areaLiving/areaKitchen, floorsTotal,
 * description/cardDescription, status.type, contractNumber в формате
 * "Договор №N/M от ДД.ММ.ГГГГ".
 */
function parseSiteJsonData(raw) {
    const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.objects) ? raw.objects : []);
    return list
        .map((o, idx) => {
            const contractNumber = o.contractNumber || null;
            return finalizeRecord({
            id: o.id || o.slug || null,
            title: o.title || null,
            type: o.type || null,
            dealType: normalizeDealType(
                o.dealType ?? o.deal_type ?? o['Тип сделки'] ?? o['Тип операции']
            ),
            city: o.city || null,
            address: o.address || null,
            price: o.priceBYN ?? o.price ?? null,
            priceUsd: o.priceUSD ?? o.priceUsd ?? null,
            rooms: o.rooms ?? null,
            totalArea: o.areaTotal ?? o.totalArea ?? null,
            livingArea: o.areaLiving ?? o.livingArea ?? null,
            kitchenArea: o.areaKitchen ?? o.kitchenArea ?? null,
            floor: o.floor ?? null,
            floors: o.floorsTotal ?? o.floors ?? null,
            description: o.description || o.cardDescription || null,
            contractNumber,
            contractDate: extractContractDate(contractNumber),
            status: (o.status && typeof o.status === 'object')
                ? String(o.status.type || 'active').toLowerCase()
                : String(o.status || 'active').toLowerCase(),
            statusDate: (o.status && typeof o.status === 'object') ? o.status.date || null : null,
            photos: extractPhotoUrls(o, SITE_BASE_URL)
            }, 'site', `site-${idx + 1}`);
        })
        .filter((r) => r.title || r.address);
}

async function parseSiteJson(filePath) {
    const raw = await fs.readJson(filePath);
    return parseSiteJsonData(raw);
}

function parseSiteJsonContent(content) {
    return parseSiteJsonData(JSON.parse(content));
}

const FLOORS_WORD_MAP = {
    'одноэтажн': 1, 'двухэтажн': 2, 'трёхэтажн': 3, 'трехэтажн': 3,
    'четырёхэтажн': 4, 'четырехэтажн': 4, 'пятиэтажн': 5, 'шестиэтажн': 6
};

function extractNumberNear(text, regex) {
    if (!text) return null;
    const m = String(text).match(regex);
    if (!m) return null;
    const n = Number(m[1].replace(',', '.'));
    return Number.isFinite(n) ? n : null;
}

function extractTotalAreaFromText(text) {
    if (!text) return null;
    // Нельзя заменять букву «м» без границ: она встречается внутри
    // обычных слов («дом», «магазин») и ломает последующий поиск чисел.
    const source = String(text).replace(
        /(?<![0-9A-Za-zА-Яа-яЁё])(?:м²|м2|м|кв\.?\s*м)(?![0-9A-Za-zА-Яа-яЁё])/giu,
        'м2'
    );
    // Сначала ищем только явно обозначенную общую площадь. Это важно:
    // в описании рядом могут встречаться площади отдельных комнат, кухни
    // или участка, которые нельзя принять за площадь объекта.
    const explicit = source.match(
        /(?:общ[а-я]*\s*(?:площад[а-я]*\s*)?|площад[а-я]*\s*[:\-—]?\s*общ[а-я]*\s*)[^0-9]{0,50}([\d.,]+)\s*м2/iu
    );
    if (explicit) {
        const value = Number(explicit[1].replace(',', '.'));
        if (Number.isFinite(value)) return value;
    }

    // Для домов в ILVO встречается короткая форма «дом площадью 72,5 м2».
    // Не используем её для «комнаты площадью ...» и других частичных площадей.
    const propertyArea = source.match(
        /((?:дом|квартир[а-я]*|объект[а-я]*)[^.!?\n]{0,50}площад[а-я]*[^0-9]{0,20})([\d.,]+)\s*м2/iu
    );
    if (propertyArea && !/(комнат|жил|кух|участ)/iu.test(propertyArea[1])) {
        const value = Number(propertyArea[2].replace(',', '.'));
        if (Number.isFinite(value)) return value;
    }

    // И последняя безопасная эвристика для лаконичных описаний:
    // «дом 132 м2» или «5/5 этаж, 43 м2».
    const short = source.match(/(?:^|[,;])\s*([\d.,]+)\s*м2/iu)
        || source.match(/(?:дом|квартир[а-я]*)\s*[:\-—]?\s*([\d.,]+)\s*м2/iu);
    if (short) {
        const value = Number(short[1].replace(',', '.'));
        if (Number.isFinite(value)) return value;
    }
    return null;
}

function extractRoomsFromText(text, sheetName) {
    if (sheetName === 'Комната') return 1;
    return extractNumberNear(text, /(\d+)\s*-?\s*(?:к\b|К\b|комнатн)/i);
}

function extractFloorsFromText(text) {
    if (!text) return null;
    const m = String(text).match(/(\d+)[-\s]?(?:х)?[-\s]?этажн/i);
    if (m) return Number(m[1]);
    const lower = String(text).toLowerCase();
    for (const [word, n] of Object.entries(FLOORS_WORD_MAP)) {
        if (lower.includes(word)) return n;
    }
    return null;
}

function extractFloorFromText(text) {
    return extractNumberNear(text, /(\d+)[-\s]?(?:м|-м|-ом)?\s*этаже/i);
}

function readRowValue(row, aliases) {
    const values = new Map(Object.entries(row || {}).map(([key, value]) => [
        String(key).normalize('NFKC').toLowerCase().replace(/ё/g, 'е').replace(/[^0-9a-zа-я]+/giu, ''),
        value
    ]));
    for (const alias of aliases) {
        const normalizedAlias = String(alias).normalize('NFKC').toLowerCase()
            .replace(/ё/g, 'е')
            .replace(/[^0-9a-zа-я]+/giu, '');
        const value = values.get(normalizedAlias);
        if (value !== undefined && value !== null && String(value).trim() !== '') return value;
    }
    return null;
}

function parseIlvoFirstNumber(value) {
    if (value === undefined || value === null || value === '') return null;
    const match = String(value).replace(/\u00a0/g, ' ').match(/[-+]?\d+(?:[.,]\d+)?/u);
    return match ? toNumberOrNull(match[0]) : null;
}

function parseIlvoPair(value) {
    if (value === undefined || value === null || value === '') {
        return { current: null, total: null };
    }
    const parts = String(value).split(/\s*(?:\/|из)\s*/iu);
    return {
        current: parseIlvoFirstNumber(parts[0]),
        total: parseIlvoFirstNumber(parts[1])
    };
}

function parseIlvoAreaTriplet(value) {
    const parts = value === undefined || value === null || value === ''
        ? []
        : String(value).split('/');
    return {
        totalArea: parseIlvoFirstNumber(parts[0]),
        livingArea: parseIlvoFirstNumber(parts[1]),
        kitchenArea: parseIlvoFirstNumber(parts[2])
    };
}

function extractIlvoDealType(row) {
    // Берём только явные колонки сделки. Описание намеренно не проверяем:
    // упоминание аренды в свободном тексте не означает тип текущей сделки.
    return normalizeDealType(readRowValue(row, [
        'dealType',
        'deal_type',
        'Тип сделки',
        'Тип операции',
        'Вид сделки',
        'Вид операции',
        'Операция',
        'Продажа/аренда',
        'Продажа / аренда'
    ]));
}

function addressContainsHousing(address, housing) {
    if (!address || !housing) return false;
    const escapedHousing = String(housing).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:к|корп(?:ус)?)\\.?\\s*${escapedHousing}(?![0-9A-Za-zА-Яа-яЁё])`, 'iu')
        .test(String(address));
}

function buildIlvoAddress(row) {
    const parts = [];
    const street = cleanString(readRowValue(row, ['Улица', 'street']));
    const house = cleanString(readRowValue(row, ['Дом', 'building']));
    const details = cleanString(readRowValue(row, ['Детали адреса', 'addressDetails']));
    const housing = cleanString(readRowValue(row, ['Корпус', 'Корп.', 'housing', 'buildingSection']));
    if (street) parts.push(street);
    // «Детали адреса» часто уже включает номер дома (например, дом="16",
    // детали="16к 2") — в этом случае не дублируем номер дома отдельно.
    const detailsStartsWithHouse = house && details && details.replace(/\s+/g, '').startsWith(house.replace(/\s+/g, ''));
    if (detailsStartsWithHouse) {
        // Если детали совпадают только с номером дома, сохраняем и этот
        // номер. Если в деталях уже есть корпус/другая часть адреса,
        // используем их как более полную запись вместо отдельного дома.
        parts.push(details);
    } else {
        if (house) parts.push(house);
        if (details) parts.push(details);
    }
    // В новых выгрузках корпус вынесен в отдельную колонку. Не добавляем
    // его повторно, если старое поле «Детали адреса» уже содержит корпус.
    const addressParts = [house, details].filter(Boolean).join(' ');
    if (housing && !addressContainsHousing(addressParts, housing)) parts.push(`корпус ${housing}`);
    return parts.length ? parts.join(', ') : null;
}

/**
 * ILVO CRM — ручная выгрузка в формате XLSX. Реальный экспорт — это
 * книга с листом на каждый тип объекта (Квартира/Дом/Участок/...),
 * без явного ID. Площади, корпус и комнаты берутся из отдельных колонок
 * выгрузки, а не извлекаются из свободного текста «Описание».
 */
async function parseIlvoXlsx(filePath) {
    const wb = XLSX.readFile(filePath);
    const records = [];
    let rowSeq = 1;
    for (const sheetName of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: null });
        for (const row of rows) {
            const desc = cleanString(readRowValue(row, ['Описание', 'description']));
            const contractNumber = readRowValue(row, ['Договор', 'contractNumber']);
            const areaParts = parseIlvoAreaTriplet(readRowValue(row, [
                'Площадь(о/ж/к)',
                'Площадь (О/Ж/К)',
                'Площадь О/Ж/К',
                'Площадь О Ж К'
            ]));
            const floorParts = parseIlvoPair(readRowValue(row, ['Этаж/Всего', 'Этаж / Всего']));
            const rooms = parseIlvoFirstNumber(readRowValue(row, ['Комнат/Всего', 'Комнат / Всего', 'Комнаты/Всего']));
            const rec = finalizeRecord({
                id: null,
                title: null,
                type: sheetName,
                dealType: extractIlvoDealType(row),
                city: readRowValue(row, ['Город', 'city']),
                address: buildIlvoAddress(row),
                price: readRowValue(row, ['Цена', 'price']),
                priceUsd: null,
                rooms,
                totalArea: areaParts.totalArea,
                livingArea: areaParts.livingArea,
                kitchenArea: areaParts.kitchenArea,
                floor: floorParts.current,
                floors: floorParts.total,
                description: desc,
                contractNumber,
                contractDate: extractContractDate(contractNumber) || extractContractDate(desc),
                status: 'active'
            }, 'ilvo', `ilvo-${rowSeq}`);
            if (!rec.title) {
                rec.title = [rec.type, rec.totalArea ? `${rec.totalArea} м²` : null, rec.city].filter(Boolean).join(', ');
            }
            records.push(rec);
            rowSeq += 1;
        }
    }
    return records;
}

function unwrapArray(v) {
    if (v === undefined || v === null) return [];
    return Array.isArray(v) ? v : [v];
}

const KUFAR_CATEGORY_TYPE = { 1010: 'Квартира', 1020: 'Дом', 1050: 'Коммерческая', 1080: 'Дача' };

function kufarTypeFromCategory(category, subject) {
    const cat = Number(category);
    // «Дом с участком» — дом, а не земельный участок. Общая категория
    // Kufar включает оба типа, поэтому уточняем только явный заголовок.
    if (cat === 1020 && /^(?:прода[её]тся\s+|продажа\s+)?(?:земельн[а-яё]*\s+)?участ/iu.test(subject || '')) return 'Участок';
    return KUFAR_CATEGORY_TYPE[cat] || 'Другое';
}

function refreshKufarRecord(record) {
    if (record?.type === 'Участок' && /^(?:прода[её]тся\s+|продажа\s+)?дом\s+с\s+участ/iu.test(record.title || '')) {
        return { ...record, type: 'Дом' };
    }
    return record;
}

/**
 * Лучшее приближение адреса из заголовка объявления (тег <subject>).
 * Тело <body> сознательно не используется — оно почти всегда содержит
 * стандартную «подпись» агентства со своим собственным адресом офиса
 * (г. Лида, б-р. Князя Гедимина...), который не имеет отношения к
 * самому объекту и исказил бы результат.
 */
function extractKufarLocationFromSubject(subject) {
    if (!subject) return { city: null, address: null };
    const cityPatterns = [
        /(?:в|у)\s*д\.\s*([А-ЯЁ][\wа-яёA-Za-z\-]*)/,
        /дерев(?:н[еи]|ня)\s+([А-ЯЁ][\wа-яёA-Za-z\-]*)/,
        /аг\.\s*([А-ЯЁ][\wа-яёA-Za-z\-]*)/,
        /(?:городском\s+)?пос[её]лк[а-я]*\s+([А-ЯЁ][\wа-яёA-Za-z\-]*)/,
        /городе\s+([А-ЯЁ][\wа-яёA-Za-z\-]*)/
    ];
    let city = null;
    for (const re of cityPatterns) {
        const m = subject.match(re);
        if (m) { city = m[1]; break; }
    }
    // Точка после инициала не является концом адреса:
    // «ул. Л. Чайкиной» нельзя обрезать до «ул. Л». Также сохраняем
    // номер дома и корпус после улицы («Машерова,23 корп.1»).
    const streetMatch = subject.match(
        /(?:^|[\s,])(?:(?:по|на)\s+)?(?:ул\.?|улиц[а-яё]*)\s+(.+)$/iu
    );
    const address = streetMatch
        ? `ул. ${streetMatch[1].trim().replace(/\s*\([^)]*\)\s*$/u, '').replace(/[.;]+\s*$/u, '').trim()}`
        : null;
    return { city, address };
}

/**
 * Разбирает адрес из тега <address>, когда он присутствует (в реальном
 * фиде это редкость — обычно только у части объявлений). Формат:
 * "Область, Район, Населённый пункт, Улица".
 */
function parseKufarAddressTag(raw) {
    if (!raw) return { city: null, address: null };
    const parts = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) return { city: null, address: null };
    const city = parts[2] || parts[parts.length - 1] || null;
    const address = parts[3] || null;
    return { city, address };
}

/**
 * Kufar — автоматическая XML-выгрузка (реальный статический фид ILVO),
 * структура <uedb><records><record>...</record></records></uedb>.
 * Номер договора приходит напрямую в теге <re_contract>, что делает
 * его надёжным ключом сопоставления с Сайтом/ILVO. Адрес в явном виде
 * почти никогда не указан — используется эвристика по заголовку
 * (см. extractKufarLocationFromSubject), поэтому городская/уличная
 * привязка для Kufar может быть неполной (это ожидаемо и не является
 * ошибкой парсинга).
 */
async function parseKufarXml(filePathOrContent, isRawContent) {
    const xml = isRawContent ? filePathOrContent : await fs.readFile(filePathOrContent, 'utf-8');
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
    const parsed = parser.parse(xml);

    // Реальная схема фида.
    if (parsed.uedb && parsed.uedb.records) {
        const items = unwrapArray(parsed.uedb.records.record);
        return items
            .map((item, idx) => {
                const subject = cleanString(item.subject);
                const fromTag = parseKufarAddressTag(item.address);
                const fromSubject = extractKufarLocationFromSubject(subject);
                const currency = cleanString(item.currency);
                const price = toNumberOrNull(item.price);
                const type = kufarTypeFromCategory(item.category, subject);
                return finalizeRecord({
                    id: cleanString(item.unid),
                    title: subject,
                    type,
                    dealType: normalizeDealType(item.type),
                    city: fromTag.city || fromSubject.city || null,
                    address: fromTag.address || fromSubject.address || null,
                    price: currency === 'USD' ? null : price,
                    priceUsd: currency === 'USD' ? price : null,
                    rooms: item.rooms ?? null,
                    totalArea: item.size ?? null,
                    livingArea: item.size_living_space ?? null,
                    kitchenArea: item.size_kitchen ?? null,
                    floor: item.floor ?? null,
                    floors: item.re_number_floors ?? item.house_number_floors ?? null,
                    description: cleanString(item.body),
                    contractNumber: cleanString(item.re_contract),
                     status: 'active',
                     photos: extractPhotoUrls(item)
                }, 'kufar', `kufar-${idx + 1}`);
            })
            .filter((r) => r.title || r.contractNumber);
    }

    // Резервная поддержка обобщённой структуры <feed><offer>/<ads><ad>,
    // на случай изменения формата фида в будущем.
    const root = parsed.feed || parsed.ads || parsed;
    let items = unwrapArray(root && (root.offer || root.ad));

    return items
        .map((item, idx) => {
            const rec = {};
            for (const field of OBJECT_FIELDS) {
                const v = item[field.key] !== undefined ? item[field.key] : item['@_' + field.key];
                rec[field.key] = v && typeof v === 'object' ? (v['#text'] ?? null) : v;
            }
            rec.photos = extractPhotoUrls(item);
            const rawId = rec.id || item['@_id'] || null;
            return finalizeRecord(rec, 'kufar', rawId || `kufar-${idx + 1}`);
        })
        .filter((r) => r.title || r.address || r.contractNumber);
}

// Экспорт Bizlida — семь колонок БЕЗ заголовка. Не используем
// sheet_to_json с заголовком по умолчанию: иначе теряется первое объявление.
function bizlidaProperties(title, description) {
    const safeDescription = propertyDescription(description);
    const text = `${title || ''} ${safeDescription}`;
    const type = /участок\s+под|земельн[а-яё]*\s+участ/iu.test(title) ? 'Участок'
        : /квартир|евродвуш|комнатная\s+Чешка/iu.test(title) ? 'Квартира'
        : /дача|дачн/iu.test(title) ? 'Дача'
        : /дом|коттедж|незаверш[а-яё]*\s+строен/iu.test(title) ? 'Дом' : null;
    return {
        type,
        ...extractBizlidaLocation(title, description),
        rooms: extractNumberNear(text, /(\d+)\s*[-]?\s*(?:х\s*)?(?:комн[а-яё.]*|к)(?=$|[^а-яё])/iu)
            || (/однокомнат/iu.test(text) ? 1 : /двухкомнат/iu.test(text) ? 2
                : /тр[её]хкомнат/iu.test(text) ? 3 : /четыр[её]хкомнат/iu.test(text) ? 4 : null),
        // Единицы могли не попасть в обрезанное «Общая площадь 62,1 …».
        // СНБ в эту величину не включаем.
        totalArea: extractBizlidaTotalArea(description),
        floor: extractFloorFromText(safeDescription),
        floors: extractFloorsFromText(text)
    };
}

function cleanBizlidaTitle(value) {
    return cleanString(value)?.replace(/^\s*продам\s*:?\s*/iu, '').trim() || null;
}

function extractBizlidaMatchingContractKey(description) {
    const matches = [...String(description || '').replace(/\u00a0/g, ' ').matchAll(
        /(?:^|[^0-9A-Za-zА-Яа-яЁё])договор(?:а|у|ом|е)?(?:\s+(?:оказания|на\s+оказание)\s+(?:(?:риелтерских|риэлтерских)\s+)?услуг)?\s*(?:(?:№|#|n[oо]?\.?)\s*)?(\d+\s*[/-]\s*[0-9A-Za-zА-Яа-яЁё]+|\d+[A-Za-zА-Яа-яЁё]*)(?=$|[^0-9A-Za-zА-Яа-яЁё])/giu
    )].map((match) => extractContractKey(match[0])).filter(Boolean);
    const uniqueKeys = [...new Set(matches)];
    // Если в тексте явно указаны разные договоры, не выбираем один наугад.
    return uniqueKeys.length === 1 ? uniqueKeys[0] : null;
}

function refreshBizlidaRecord(record) {
    // У старых импортов сохранены оригинальные тексты: повторно выбирать
    // XLSX не нужно. Не переинтерпретируем сторонние структурированные записи.
    if (!record?.listingUrl?.includes('bizlida.by/baraholka/')) return record;
    const refreshed = {
        ...record,
        ...bizlidaProperties(record.title, record.description),
        matchingContractKey: extractBizlidaMatchingContractKey(record.description)
    };
    refreshed.addressKey = normalizeAddressKey(refreshed.city, refreshed.address);
    return refreshed;
}

function parseBizlidaListing(listing) {
    const title = cleanBizlidaTitle(listing.title);
    const description = [listing.lead, listing.description].filter(Boolean).join('\n\n');
    const rec = finalizeRecord({
        id: listing.id,
        title,
        description,
        ...bizlidaProperties(title, description),
        livingArea: extractNumberNear(propertyDescription(description),
            /(?:жил[а-яё]*\s+площад[а-яё]*|площад[а-яё]*\s+жил[а-яё]*(?:\s+помещен[а-яё]*)?)[^0-9]{0,15}(\d+(?:[.,]\d+)?)/iu),
        kitchenArea: extractNumberNear(propertyDescription(description),
            /(?:площад[а-яё]*\s+кухни|кухня|кухни)[^0-9]{0,15}(\d+(?:[.,]\d+)?)/iu),
        dealType: listing.dealType,
        price: listing.price,
        priceUsd: null,
        contractNumber: null,
        status: 'active',
        photos: listing.photos
    }, 'bizlida', listing.id);
    return {
        ...rec,
        listingUrl: listing.listingUrl,
        matchingContractKey: extractBizlidaMatchingContractKey(listing.description),
        publishedText: listing.publishedText,
        updatedText: listing.updatedText,
        seller: listing.seller,
        fetchedAt: listing.fetchedAt
    };
}

async function parseBizlidaXlsx(filePath) {
    const wb = XLSX.readFile(filePath);
    const records = [];
    const recordIndexesByUrl = new Map();

    function headerSchema(row) {
        const cells = row.map((value) => String(value || '').trim().toLowerCase());
        const isNewFormat = cells[0] === 'headline href'
            || (cells[0] === 'headline href' && cells[1] === 'page-title')
            || (cells.includes('page-title') && cells.includes('record-text'));
        if (isNewFormat) {
            return {
                url: 0, title: 1, price: 2, lead: 3, description: 5,
                photos: null, published: null, format: 'new'
            };
        }

        const legacyUrlIndex = cells.findIndex((value) => (
            /^(?:headline href|ссылка|url|ссылка на объявление)$/iu.test(value)
        ));
        if (legacyUrlIndex >= 0 || cells.some((value) => /^(?:item__image src|фото)$/iu.test(value))) {
            return {
                url: 2, title: 3, price: 5, lead: null, description: 4,
                photos: 0, published: 6, format: 'legacy'
            };
        }
        return null;
    }

    function inferredSchema(row) {
        const isUrl = (value) => /^https?:\/\/(?:www\.)?bizlida\.by\/baraholka\/\d+\/?(?:[?#].*)?$/iu
            .test(String(value || '').trim());
        if (isUrl(row[0])) {
            return { url: 0, title: 1, price: 2, lead: 3, description: 5, photos: null, published: null, format: 'new' };
        }
        if (isUrl(row[2])) {
            return { url: 2, title: 3, price: 5, lead: null, description: 4, photos: 0, published: 6, format: 'legacy' };
        }
        return null;
    }

    for (const name of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null });
        let schema = null;
        for (const [rowIndex, row] of rows.entries()) {
            if (row.every((value) => value === null || String(value).trim() === '')) continue;
            const detectedHeader = headerSchema(row);
            if (detectedHeader) {
                schema = detectedHeader;
                continue;
            }

            const columns = schema || inferredSchema(row);
            const listingUrl = cleanString(row[columns?.url]);
            const rawTitle = cleanString(row[columns?.title]);
            if (!columns
                || !/^https?:\/\/(?:www\.)?bizlida\.by\/baraholka\/\d+\/?(?:[?#].*)?$/iu.test(listingUrl || '')
                || !rawTitle) {
                throw new Error(`Bizlida: неверный формат строки ${rowIndex + 1} листа «${name}». Поддерживаются новая выгрузка с URL/заголовком/ценой/описаниями и прежняя выгрузка с фото/агентством/URL/заголовком/описанием/ценой.`);
            }

            const title = cleanBizlidaTitle(rawTitle);
            const lead = columns.lead === null ? null : cleanString(row[columns.lead]);
            const fullDescription = cleanString(row[columns.description]);
            const description = [lead, fullDescription].filter(Boolean).join('\n\n') || null;
            const matchingContractKey = extractBizlidaMatchingContractKey(fullDescription || description);
            const rec = finalizeRecord({
                id: listingUrl.match(/baraholka\/(\d+)/u)[1],
                title, description,
                ...bizlidaProperties(title, description),
                price: row[columns.price], priceUsd: null,
                contractNumber: null, status: 'active',
                photos: columns.photos === null ? null : row[columns.photos]
            }, 'bizlida', `bizlida-${records.length + 1}`);
            rec.listingUrl = listingUrl;
            rec.publishedText = columns.published === null ? null : cleanString(row[columns.published]);
            rec.matchingContractKey = matchingContractKey;

            const previousIndex = recordIndexesByUrl.get(rec.listingUrl);
            if (previousIndex !== undefined) {
                const previous = records[previousIndex];
                // Некоторые выгрузки содержат один и тот же набор на нескольких листах.
                // Сохраняем более полный вариант записи, но не импортируем его повторно.
                const previousScore = Number(!!previous.matchingContractKey) * 1000
                    + Number(!!previous.address) * 100
                    + String(previous.description || '').length;
                const currentScore = Number(!!rec.matchingContractKey) * 1000
                    + Number(!!rec.address) * 100
                    + String(rec.description || '').length;
                if (currentScore > previousScore) records[previousIndex] = rec;
                continue;
            }

            recordIndexesByUrl.set(rec.listingUrl, records.length);
            records.push(rec);
        }
    }
    if (!records.length) throw new Error('Bizlida: в файле нет объявлений.');
    return records;
}

module.exports = {
    parseBizlidaListing,
    parseSiteJson,
    parseSiteJsonContent,
    parseIlvoXlsx,
    parseBizlidaXlsx,
    refreshBizlidaRecord,
    refreshKufarRecord,
    parseKufarXml,
    finalizeRecord
};
