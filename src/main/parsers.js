'use strict';

const fs = require('fs-extra');
const XLSX = require('xlsx');
const { XMLParser } = require('fast-xml-parser');
const { OBJECT_FIELDS, extractContractKey, normalizeAddressKey } = require('./schema');

const NUMERIC_KEYS = new Set(OBJECT_FIELDS.filter((f) => f.numeric).map((f) => f.key));

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
    out.contractKey = extractContractKey(out.contractNumber);
    out.addressKey = normalizeAddressKey(out.city, out.address);
    return out;
}

/**
 * Сайт ГермесГарант — ручная выгрузка в формате JSON.
 * Ожидается массив объектов (либо { objects: [...] }) с полями вида
 * priceBYN/priceUSD, areaTotal/areaLiving/areaKitchen, floorsTotal,
 * description/cardDescription, status.type, contractNumber в формате
 * "Договор №N/M от ДД.ММ.ГГГГ".
 */
async function parseSiteJson(filePath) {
    const raw = await fs.readJson(filePath);
    const list = Array.isArray(raw) ? raw : (Array.isArray(raw.objects) ? raw.objects : []);
    return list
        .map((o, idx) => finalizeRecord({
            id: o.id || o.slug || null,
            title: o.title || null,
            type: o.type || null,
            dealType: o.dealType || null,
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
            contractNumber: o.contractNumber || null,
            status: (o.status && typeof o.status === 'object') ? (o.status.type || 'active') : (o.status || 'active')
        }, 'site', `site-${idx + 1}`))
        .filter((r) => r.title || r.address);
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

function extractDealType(text) {
    return text && /аренд/i.test(text) ? 'Аренда' : 'Продажа';
}

function buildIlvoAddress(row) {
    const parts = [];
    const street = cleanString(row['Улица']);
    const house = cleanString(row['Дом']);
    const details = cleanString(row['Детали адреса']);
    if (street) parts.push(street);
    // «Детали адреса» часто уже включает номер дома (например, дом="16",
    // детали="16к 2") — в этом случае не дублируем номер дома отдельно.
    const detailsStartsWithHouse = house && details && details.replace(/\s+/g, '').startsWith(house.replace(/\s+/g, ''));
    if (house && !detailsStartsWithHouse) parts.push(house);
    if (details && details !== house) parts.push(details);
    return parts.length ? parts.join(', ') : null;
}

/**
 * ILVO CRM — ручная выгрузка в формате XLSX. Реальный экспорт — это
 * книга с листом на каждый тип объекта (Квартира/Дом/Участок/...),
 * без явного ID и без отдельных полей площади/комнат — эти значения
 * извлекаются эвристически (регулярными выражениями) из свободного
 * текста колонки «Описание». Такое извлечение приблизительное:
 * если в тексте нет чётко сформулированной фразы, поле останется
 * пустым, а не будет угадано наугад.
 */
async function parseIlvoXlsx(filePath) {
    const wb = XLSX.readFile(filePath);
    const records = [];
    let rowSeq = 1;
    for (const sheetName of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: null });
        for (const row of rows) {
            const desc = cleanString(row['Описание']);
            const rec = finalizeRecord({
                id: null,
                title: null,
                type: sheetName,
                dealType: extractDealType(desc),
                city: row['Город'] || null,
                address: buildIlvoAddress(row),
                price: row['Цена'] ?? null,
                priceUsd: null,
                rooms: extractRoomsFromText(desc, sheetName),
                totalArea: extractNumberNear(desc, /общ[а-я]*\s*площад[а-я]*[^0-9]{0,15}([\d.,]+)/i),
                livingArea: extractNumberNear(desc, /жил[а-я]*\s*(?:площад[а-я]*)?[^0-9]{0,15}([\d.,]+)/i),
                kitchenArea: extractNumberNear(desc, /кухн[а-я]*[^0-9]{0,15}([\d.,]+)/i),
                floor: extractFloorFromText(desc),
                floors: extractFloorsFromText(desc),
                description: desc,
                contractNumber: row['Договор'] || null,
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
    if (cat === 1020 && /участ/i.test(subject || '')) return 'Участок';
    return KUFAR_CATEGORY_TYPE[cat] || 'Другое';
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
    const streetMatch = subject.match(/по\s+улиц[аеы]\s+([А-ЯЁа-яё0-9\-\s]+?)(?:[,.]|$)/i)
        || subject.match(/по\s+ул\.\s*([А-ЯЁа-яё0-9\-\s]+?)(?:[,.]|$)/i);
    const address = streetMatch ? `ул. ${streetMatch[1].trim()}` : null;
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
                    dealType: item.type === 'rent' ? 'Аренда' : 'Продажа',
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
                    status: 'active'
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
            const rawId = rec.id || item['@_id'] || null;
            return finalizeRecord(rec, 'kufar', rawId || `kufar-${idx + 1}`);
        })
        .filter((r) => r.title || r.address || r.contractNumber);
}

module.exports = { parseSiteJson, parseIlvoXlsx, parseKufarXml, finalizeRecord };
