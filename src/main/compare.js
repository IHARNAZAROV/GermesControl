'use strict';

const dayjs = require('dayjs');
const {
    OBJECT_FIELDS,
    ERROR_TYPES,
    ERROR_SEVERITY,
    extractContractKey,
    normalizeAddressKey,
    cleanLocationText
} = require('./schema');

const COMPARABLE_FIELDS = OBJECT_FIELDS.filter((f) => f.compare && f.key !== 'contractNumber');
const REPORT_MATCHING_VERSION = 3;

function tokenSet(s) {
    return new Set(String(s || '').split(/\s+/).filter(Boolean));
}

// Один набор токенов полностью «покрывается» другим — считаем, что это
// просто более короткая/более полная запись одного и того же адреса,
// а не расхождение (это типичная ситуация: сайт хранит адрес целиком,
// а ILVO — только улицу и номер дома).
function isSubsetMatch(a, b) {
    if (a.size === 0 || b.size === 0) return false;
    const [small, big] = a.size <= b.size ? [a, b] : [b, a];
    for (const t of small) {
        if (!big.has(t)) return false;
    }
    return true;
}

function fieldsDiffer(a, b, field) {
    if (a === null || b === null || a === undefined || b === undefined) return false;
    if (a === null || b === null) return false;
    if (field.numeric) {
        const na = Number(a), nb = Number(b);
        if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
        // допускаем небольшую погрешность округления (0.5%)
        const tolerance = Math.max(1, Math.abs(na) * 0.005);
        return Math.abs(na - nb) > tolerance;
    }
    if (field.key === 'address') {
        const ca = cleanLocationText(a);
        const cb = cleanLocationText(b);
        const ta = tokenSet(ca);
        const tb = tokenSet(cb);
        if (isSubsetMatch(ta, tb)) return false;
        // Тот же адрес, но с иным пробелом внутри номера дома/корпуса
        // (например, "16к2" против "16к 2") — сравниваем без пробелов вовсе.
        const da = ca.replace(/\s+/g, '');
        const db = cb.replace(/\s+/g, '');
        if (da && db && (da.includes(db) || db.includes(da))) return false;
        return true;
    }
    return String(a).trim().toLowerCase() !== String(b).trim().toLowerCase();
}

const SRC_ORDER = ['site', 'ilvo', 'kufar'];

function recordContractKey(record) {
    return extractContractKey(record && (
        record.contractNumber
        ?? record.number
        ?? record.contractKey
        ?? record.key
    ));
}

function normalizedComparableText(value) {
    return String(value || '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/[^0-9a-zа-я]+/giu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function recordAddressKey(record) {
    if (!record) return null;
    return normalizeAddressKey(record.city, record.address) || record.addressKey || null;
}

function recordPrice(record) {
    if (!record) return null;
    const price = Number(record.price);
    if (Number.isFinite(price) && price > 0) return { value: price, currency: 'BYN' };
    const priceUsd = Number(record.priceUsd);
    if (Number.isFinite(priceUsd) && priceUsd > 0) return { value: priceUsd, currency: 'USD' };
    return null;
}

function hasRecordValue(value) {
    return value !== null
        && value !== undefined
        && value !== ''
        && !(typeof value === 'string' && ['-', '—'].includes(value.trim()));
}

/**
 * Свернуть повторные строки внутри одного источника до сопоставления
 * источников между собой. В выгрузках ILVO один объект может встречаться
 * несколько раз с тем же договором (например, одна строка с датой, другая
 * без даты). Такие строки не должны превращаться в разные объекты.
 */
function collapseSourceDuplicates(records) {
    const result = [];
    const byIdentity = new Map();

    for (const record of records || []) {
        const contractKey = recordContractKey(record);
        const addressKey = recordAddressKey(record);
        // Адрес — запасной ключ только для записей без договора. Адреса
        // с улицей без номера не объединяем: на одной улице могут быть
        // разные объекты.
        const addressHasNumber = addressKey && /\d/.test(addressKey);
        const identity = contractKey
            ? `contract:${contractKey}`
            : (addressHasNumber ? `address:${addressKey}` : null);
        const existingIndex = identity ? byIdentity.get(identity) : undefined;

        if (existingIndex === undefined) {
            const copy = { ...record, _sourceIds: record.id ? [record.id] : [] };
            result.push(copy);
            if (identity) byIdentity.set(identity, result.length - 1);
            continue;
        }

        const existing = result[existingIndex];
        for (const key of OBJECT_FIELDS.map((field) => field.key)) {
            const current = existing[key];
            const incoming = record[key];
            if (!hasRecordValue(current) && hasRecordValue(incoming)) {
                existing[key] = incoming;
            } else if (key === 'title' && String(incoming || '').length > String(current || '').length) {
                existing[key] = incoming;
            } else if (key === 'description' && String(incoming || '').length > String(current || '').length) {
                existing[key] = incoming;
            } else if (key === 'status' && incoming === 'sold') {
                existing[key] = incoming;
            }
        }
        if (record.id && !existing._sourceIds.includes(record.id)) {
            existing._sourceIds.push(record.id);
        }
    }

    return result;
}

function formatObjectTitle(record) {
    const rawType = String(record.type || '').trim();
    const type = rawType.toLowerCase();
    const rooms = Number(record.rooms);
    let propertyName = rawType || 'Объект недвижимости';

    if (type.includes('квартир')) {
        propertyName = Number.isFinite(rooms) && rooms > 0
            ? `${rooms}-комнатная квартира`
            : 'квартира';
    } else if (type.includes('коммер')) {
        propertyName = 'коммерческая недвижимость';
    } else if (type.includes('участ')) {
        propertyName = 'земельный участок';
    } else if (type.includes('дом') || type.includes('дач')) {
        propertyName = type.includes('дач') ? 'дача' : 'дом';
    } else if (type) {
        propertyName = rawType.charAt(0).toLowerCase() + rawType.slice(1);
    }

    const city = String(record.city || '').trim();
    let cityPhrase = '';
    if (city) {
        cityPhrase = /^(г\.?|город)\s/i.test(city) || /(район|область)$/i.test(city)
            ? `в ${city}`
            : `в г. ${city}`;
    }

    const rawAddress = String(record.address || '').trim().replace(/\s+/g, ' ');
    let addressPhrase = '';
    if (rawAddress) {
        const streetMatch = rawAddress.match(/^(?:ул\.?|улица)\s*(.+)$/i);
        const avenueMatch = rawAddress.match(/^(?:пр\.?|проспект)\s*(.+)$/i);
        if (streetMatch) addressPhrase = `на улице ${streetMatch[1]}`;
        else if (avenueMatch) addressPhrase = `на проспекте ${avenueMatch[1]}`;
        else addressPhrase = `по адресу ${rawAddress}`;
    }

    return [propertyName, cityPhrase, addressPhrase].filter(Boolean).join(' ') || record.title || 'Объект недвижимости';
}

function pricesMatch(a, b) {
    const priceA = recordPrice(a);
    const priceB = recordPrice(b);
    if (!priceA || !priceB || priceA.currency !== priceB.currency) return false;
    const tolerance = Math.max(1, Math.max(priceA.value, priceB.value) * 0.01);
    return Math.abs(priceA.value - priceB.value) <= tolerance;
}

function numericValuesMatch(a, b, tolerance = 0.01) {
    if (a === null || a === undefined || b === null || b === undefined) return false;
    const na = Number(a);
    const nb = Number(b);
    if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
    return Math.abs(na - nb) <= Math.max(0.5, Math.max(Math.abs(na), Math.abs(nb)) * tolerance);
}

/**
 * В некоторых выгрузках нет договора и отдельного адреса, но остаются
 * цена и базовые характеристики из колонки «Объект»/«Описание». Это
 * достаточно только как консервативный третий вариант: цена должна
 * совпасть вместе минимум с двумя характеристиками, а не сама по себе.
 */
function descriptorMatches(a, b) {
    if (!pricesMatch(a, b)) return false;
    const propertyChecks = [
        normalizedComparableText(a.type) && normalizedComparableText(a.type) === normalizedComparableText(b.type),
        numericValuesMatch(a.rooms, b.rooms, 0),
        numericValuesMatch(a.totalArea, b.totalArea, 0.01)
    ].filter(Boolean);
    // Город может быть районом в одном источнике и населённым пунктом в
    // другом, а тип сделки не идентифицирует саму недвижимость. Поэтому
    // они не считаются сильными признаками для объединения.
    return propertyChecks.length >= 2;
}

function addressMatches(a, b) {
    const addressA = recordAddressKey(a);
    const addressB = recordAddressKey(b);
    if (!addressA || !addressB) return false;
    if (addressA === addressB) return true;

    const tokensA = tokenSet(addressA);
    const tokensB = tokenSet(addressB);
    if (isSubsetMatch(tokensA, tokensB)) return true;

    // Учитываем варианты вроде «16к2» и «16к 2», а также короткую
    // запись улицы относительно полного адреса.
    const compactA = addressA.replace(/\s+/g, '');
    const compactB = addressB.replace(/\s+/g, '');
    return compactA.length > 0 && compactB.length > 0
        && (compactA.includes(compactB) || compactB.includes(compactA));
}

/**
 * Сопоставляет записи трёх источников между собой, чтобы понять,
 * что это один и тот же реальный объект. Реальные источники не
 * имеют общего технического ID. Нормализованный номер договора —
 * приоритетный ключ; нормализованный адрес — второй ключ, который
 * объединяет даже записи с разными номерами договора. Это позволяет
 * показать расхождение договора как проблему внутри одного объекта,
 * а не создать два разных объекта.
 */
function buildMatchGroups(bySource) {
    const groups = [];
    let groupSeq = 0;

    function findMatch(group, rec) {
        const recContractKey = recordContractKey(rec);
        let best = null;

        for (const existing of Object.values(group.records)) {
            if (!existing) continue;
            const existingContractKey = recordContractKey(existing);
            const contractMatch = !!(recContractKey && existingContractKey && recContractKey === existingContractKey);
            const addressMatch = addressMatches(rec, existing);
            const priceMatch = pricesMatch(rec, existing);
            const descriptorMatch = !contractMatch && !addressMatch && descriptorMatches(rec, existing);

            // Одинаковый договор объединяет записи даже при расхождении
            // адреса/цены: эти расхождения должны попасть внутрь одной
            // карточки и быть показаны пользователю как проблема.
            if (!contractMatch && !addressMatch && !descriptorMatch) continue;

            const candidate = {
                contractMatch,
                addressMatch,
                priceMatch,
                descriptorMatch,
                score: (contractMatch ? 1000 : 0)
                    + (addressMatch ? 300 : 0)
                    + (descriptorMatch ? 180 : 0)
                    + (priceMatch ? 80 : 0)
            };
            if (!best || candidate.score > best.score) best = candidate;
        }

        return best;
    }

    function addMatchEvidence(group, match) {
        if (match.contractMatch) group.evidence.add('contract');
        if (match.addressMatch) group.evidence.add('address');
        if (match.priceMatch) group.evidence.add('price');
        if (match.descriptorMatch) group.evidence.add('descriptor');
    }

    function groupBasis(group) {
        if (group.evidence.has('contract')) return 'contract';
        if (group.evidence.has('address') && group.evidence.has('price')) return 'address_price';
        if (group.evidence.has('address')) return 'address';
        if (group.evidence.has('descriptor')) return 'descriptor';
        return 'none';
    }

    for (const src of SRC_ORDER) {
        for (const rec of bySource[src] || []) {
            const candidates = groups
                .filter((group) => !group.records[src])
                .map((group) => ({ group, match: findMatch(group, rec) }))
                .filter((candidate) => candidate.match)
                .sort((a, b) => b.match.score - a.match.score);

            if (candidates[0]) {
                const { group, match } = candidates[0];
                group.records[src] = rec;
                addMatchEvidence(group, match);
                group.matchedBy = groupBasis(group);
                continue;
            }

            const group = {
                key: `group-${groupSeq++}`,
                // У одиночной записи ещё нет основания объединения. Оно
                // появится только после присоединения записи другого источника.
                matchedBy: 'none',
                evidence: new Set(),
                records: { [src]: rec }
            };
            groups.push(group);
        }
    }

    return groups;
}

const MISMATCH_TYPE_BY_FIELD = {
    price: ERROR_TYPES.PRICE_MISMATCH,
    priceUsd: ERROR_TYPES.PRICE_MISMATCH,
    totalArea: ERROR_TYPES.AREA_MISMATCH,
    livingArea: ERROR_TYPES.AREA_MISMATCH,
    kitchenArea: ERROR_TYPES.AREA_MISMATCH,
    address: ERROR_TYPES.ADDRESS_MISMATCH,
    rooms: ERROR_TYPES.ROOMS_MISMATCH
};

/**
 * Основной механизм сравнения. Принимает данные трёх источников и
 * реестр договоров, возвращает единый отчёт: presence-матрицу,
 * расхождения полей, список ошибок и агрегированную статистику.
 */
function runComparison({ site, ilvo, kufar, contracts }, previousSnapshot) {
    const sources = {
        site: collapseSourceDuplicates(site),
        ilvo: collapseSourceDuplicates(ilvo),
        kufar: collapseSourceDuplicates(kufar)
    };
    const groups = buildMatchGroups(sources);

    const objects = [];
    const errors = [];
    const objectIdAliases = new Map();
    const now = dayjs().format('DD.MM.YYYY');
    let errorSeq = 1;
    let objSeq = 1;

    function pushError(type, description, target, source, targetType = 'object') {
        errors.push({
            id: `ERR-${String(errorSeq++).padStart(4, '0')}`,
            type,
            description,
            target,
            targetType,
            source,
            date: now,
            severity: ERROR_SEVERITY[type] || 'info',
            status: 'open'
        });
    }

    for (const group of groups) {
        const s = group.records.site || null;
        const i = group.records.ilvo || null;
        const k = group.records.kufar || null;
        const presence = { site: !!s, ilvo: !!i, kufar: !!k };
        const primary = s || i || k;
        const objectNumber = objSeq;
        const id = `MATCH-${String(objSeq++).padStart(4, '0')}`;
        const target = objectNumber;
        for (const record of [s, i, k]) {
            if (!record) continue;
            for (const sourceId of [record.id, ...(record._sourceIds || [])]) {
                if (sourceId) objectIdAliases.set(sourceId, id);
            }
        }

        const fieldDiffs = [];
        const pairs = [
            ['site', 'ilvo', s, i],
            ['site', 'kufar', s, k],
            ['ilvo', 'kufar', i, k]
        ];

        for (const field of COMPARABLE_FIELDS) {
            const values = { site: s ? s[field.key] : undefined, ilvo: i ? i[field.key] : undefined, kufar: k ? k[field.key] : undefined };
            let mismatch = false;
            for (const [srcA, srcB, recA, recB] of pairs) {
                if (recA && recB && fieldsDiffer(recA[field.key], recB[field.key], field)) mismatch = true;
            }
            if (mismatch) {
                fieldDiffs.push({ field: field.key, label: field.label, values, unit: field.unit || null });
                const errType = MISMATCH_TYPE_BY_FIELD[field.key] || ERROR_TYPES.OTHER;
                if (!errors.some((e) => e.type === errType && e.target === target)) {
                    pushError(errType, `${field.label}: значения расходятся между источниками`, target, 'Сайт / ILVO / Kufar');
                }
            }
        }

        // Договор объекта отсутствует.
        const contractNumber = [s, i, k]
            .map(recordContractKey)
            .find(Boolean) || null;
        const presentSourcesCount = [presence.site, presence.ilvo, presence.kufar].filter(Boolean).length;
        if (!contractNumber && presentSourcesCount > 0) {
            pushError(ERROR_TYPES.NO_CONTRACT, 'У объекта не указан номер договора', target, presence.site ? 'Сайт' : (presence.ilvo ? 'ILVO' : 'Kufar'));
        }
        // Расхождение номера договора между источниками (сопоставлено по адресу,
        // но номера договоров не совпадают или указаны не везде).
        const contractValues = [s, i, k].filter(Boolean).map(recordContractKey).filter(Boolean);
        const uniqueContracts = new Set(contractValues);
        if (uniqueContracts.size > 1) {
            pushError(ERROR_TYPES.CONTRACT_MISMATCH, 'Номер договора отличается между источниками', target, 'Сайт / ILVO');
        }

        if (presentSourcesCount > 1) {
            if (!presence.site) pushError(ERROR_TYPES.MISSING_SITE, 'Объект есть в других источниках, но отсутствует на сайте', target, presence.ilvo ? 'ILVO' : 'Kufar');
            if (!presence.ilvo) pushError(ERROR_TYPES.MISSING_ILVO, 'Объект есть в других источниках, но отсутствует в ILVO', target, presence.site ? 'Сайт' : 'Kufar');
            if (!presence.kufar) pushError(ERROR_TYPES.MISSING_KUFAR, 'Объект есть в других источниках, но отсутствует в Kufar', target, presence.site ? 'Сайт' : 'ILVO');
        }

        let status = 'ok';
        if (presentSourcesCount < 3) status = 'missing';
        if (fieldDiffs.length > 0) status = 'mismatch';

        const merged = {};
        for (const field of OBJECT_FIELDS) {
            // A source can contain the object while omitting individual
            // fields. Keep the source priority for conflicting values, but
            // fill gaps from the other records in the same matched group.
            merged[field.key] = [s, i, k]
                .map((record) => record && record[field.key])
                .find(hasRecordValue) ?? null;
        }
        // В отчёте показываем единый нормализованный номер, а не
        // случайную исходную форму из одного из источников.
        merged.contractNumber = contractNumber;

        objects.push({
            ...merged,
            id,
            objectNumber,
            title: formatObjectTitle(merged),
            presence,
            matchedBy: group.matchedBy,
            matchConfidence: group.matchedBy === 'contract' || group.matchedBy === 'address_price' ? 'strong' : (group.matchedBy === 'none' ? 'none' : 'review'),
            fieldDiffs,
            contractNumber,
            status
        });
    }

    const objectIds = new Set(objects.map((o) => o.id));

    // Реестр договоров: автоматически собирается из распознанных
    // номеров у объектов + (для демо-набора) дополнительные вручную
    // заданные записи, включая «сиротские» договоры без объекта.
    const derivedContracts = objects
        .filter((o) => o.contractNumber)
        .map((o) => ({ number: o.contractNumber, key: o.contractNumber, date: null, objectId: o.id }));

    const derivedObjectsByContract = new Map();
    for (const contract of derivedContracts) {
        if (!derivedObjectsByContract.has(contract.key)) derivedObjectsByContract.set(contract.key, []);
        derivedObjectsByContract.get(contract.key).push(contract.objectId);
    }

    const normalizedContracts = (contracts || []).map((contract) => {
        const key = recordContractKey(contract) || contract.key || null;
        let objectId = contract.objectId
            ? (objectIdAliases.get(contract.objectId) || (objectIds.has(contract.objectId) ? contract.objectId : null))
            : null;
        // Если импортированный реестр не содержит ID объекта, но договор
        // однозначно найден среди объединённых объектов, связываем запись
        // с ним и не создаём вторую строку в таблице. Это также покрывает
        // случай, когда договор ссылается на отсутствующую карточку сайта,
        // но его номер есть в ILVO или Kufar.
        const derivedObjectIds = key ? derivedObjectsByContract.get(key) || [] : [];
        if ((!objectId || !objectIds.has(objectId)) && derivedObjectIds.length === 1) {
            objectId = derivedObjectIds[0];
        }
        return { ...contract, number: key || contract.number, key, objectId };
    });

    const allContracts = [];
    const contractsByKey = new Map();
    function addContract(contract) {
        const key = contract.key || recordContractKey(contract) || contract.number;
        if (!key) return;
        const existing = contractsByKey.get(key);
        if (!existing) {
            contractsByKey.set(key, contract);
            allContracts.push(contract);
            return;
        }
        // Номер договора — единый ключ объекта. Сохраняем более полную
        // запись (дату и привязку), но не создаём вторую строку из-за
        // другого формата номера или отсутствующей ссылки на объект.
        if (!existing.date && contract.date) existing.date = contract.date;
        if (!existing.objectId && contract.objectId) existing.objectId = contract.objectId;
    }

    [...derivedContracts, ...normalizedContracts].forEach(addContract);

    // Проверки договоров.
    const contractByKey = new Map();
    for (const c of allContracts) {
        const key = recordContractKey(c) || c.key || c.number;
        if (!key) continue;
        if (!contractByKey.has(key)) contractByKey.set(key, []);
        contractByKey.get(key).push(c);
    }
    for (const [, list] of contractByKey.entries()) {
        const number = list[0].number;
        if (list.length > 1) {
            pushError(ERROR_TYPES.DUPLICATE_CONTRACT, `Номер договора ${number} используется у ${list.length} записей`, number, 'Договоры', 'contract');
        }
        for (const c of list) {
            if (!c.objectId || !objectIds.has(c.objectId)) {
                pushError(ERROR_TYPES.CONTRACT_NO_OBJECT, `Договор ${number} не привязан ни к одному объекту`, number, 'Договоры', 'contract');
            }
        }
    }

    const total = objects.length;
    const everywhere = objects.filter((o) => o.presence.site && o.presence.ilvo && o.presence.kufar).length;
    const categories = {
        everywhere,
        onlySite: objects.filter((o) => o.presence.site && !o.presence.ilvo && !o.presence.kufar).length,
        onlyIlvo: objects.filter((o) => !o.presence.site && o.presence.ilvo && !o.presence.kufar).length,
        onlyKufar: objects.filter((o) => !o.presence.site && !o.presence.ilvo && o.presence.kufar).length,
        missingSite: objects.filter((o) => !o.presence.site && (o.presence.ilvo || o.presence.kufar)).length,
        missingIlvo: objects.filter((o) => !o.presence.ilvo && (o.presence.site || o.presence.kufar)).length,
        missingKufar: objects.filter((o) => !o.presence.kufar && (o.presence.site || o.presence.ilvo)).length
    };

    const stats = {
        siteCount: sources.site.length,
        ilvoCount: sources.ilvo.length,
        kufarCount: sources.kufar.length,
        totalUnique: total,
        matchPercent: total ? Math.round((everywhere / total) * 1000) / 10 : 0,
        problemsCount: objects.filter((o) => o.status !== 'ok').length,
        errorsCount: errors.length,
        criticalCount: errors.filter((e) => e.severity === 'critical').length,
        warningCount: errors.filter((e) => e.severity === 'warning').length,
        infoCount: errors.filter((e) => e.severity === 'info').length,
        activeCount: objects.filter((o) => o.status !== undefined && o.status !== 'sold').length,
        soldCount: objects.filter((o) => o.status === 'sold').length,
        withContract: objects.filter((o) => !!o.contractNumber).length,
        withoutContract: objects.filter((o) => !o.contractNumber).length
    };

    let deltas = { site: 0, ilvo: 0, kufar: 0, problems: 0 };
    if (previousSnapshot && previousSnapshot.stats) {
        deltas = {
            site: stats.siteCount - previousSnapshot.stats.siteCount,
            ilvo: stats.ilvoCount - previousSnapshot.stats.ilvoCount,
            kufar: stats.kufarCount - previousSnapshot.stats.kufarCount,
            problems: stats.problemsCount - previousSnapshot.stats.problemsCount
        };
    }

    return {
        matchingVersion: REPORT_MATCHING_VERSION,
        checkedAt: new Date().toISOString(),
        objects,
        errors,
        contracts: allContracts,
        categories,
        stats,
        deltas
    };
}

module.exports = { runComparison };
