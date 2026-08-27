'use strict';

const dayjs = require('dayjs');
const { OBJECT_FIELDS, ERROR_TYPES, ERROR_SEVERITY, extractContractKey, cleanLocationText } = require('./schema');

const COMPARABLE_FIELDS = OBJECT_FIELDS.filter((f) => f.compare && f.key !== 'contractNumber');

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
    if (a === null || a === null || a === undefined || b === undefined) return false;
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

/**
 * Сопоставляет записи трёх источников между собой, чтобы понять,
 * что это один и тот же реальный объект. Реальные источники не
 * имеют общего технического ID, поэтому сопоставление идёт в два
 * прохода:
 *   1. по нормализованному номеру договора (contractKey) — основной,
 *      надёжный признак;
 *   2. по нормализованному адресу (addressKey) — запасной признак
 *      для записей, у которых номер договора отсутствует или не
 *      совпал (в том числе это как раз и есть случай реального
 *      расхождения номера договора между системами).
 * Всё, что не нашло пары ни по одному признаку, остаётся отдельной,
 * непарной записью (объект есть только в одном источнике).
 */
function buildMatchGroups(bySource) {
    const groups = new Map();
    const order = [];
    const consumed = new Set();

    function ensureGroup(key, matchedBy) {
        if (!groups.has(key)) {
            groups.set(key, { key, matchedBy, records: {} });
            order.push(key);
        }
        return groups.get(key);
    }

    // Проход 1: по номеру договора.
    for (const src of SRC_ORDER) {
        for (const rec of bySource[src] || []) {
            if (!rec.contractKey) continue;
            const g = ensureGroup(`c:${rec.contractKey}`, 'contract');
            if (!g.records[src]) {
                g.records[src] = rec;
                consumed.add(rec);
            }
        }
    }

    // Проход 2: по адресу — только для записей, ещё не вошедших в группу.
    for (const src of SRC_ORDER) {
        for (const rec of bySource[src] || []) {
            if (consumed.has(rec) || !rec.addressKey) continue;
            const g = ensureGroup(`a:${rec.addressKey}`, 'address');
            if (!g.records[src]) {
                g.records[src] = rec;
                consumed.add(rec);
            }
        }
    }

    // Проход 3: всё оставшееся — непарные записи.
    let seq = 0;
    for (const src of SRC_ORDER) {
        for (const rec of bySource[src] || []) {
            if (consumed.has(rec)) continue;
            ensureGroup(`u:${seq++}`, 'none').records[src] = rec;
            consumed.add(rec);
        }
    }

    return order.map((k) => groups.get(k));
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
    const groups = buildMatchGroups({ site, ilvo, kufar });

    const objects = [];
    const errors = [];
    const now = dayjs().format('DD.MM.YYYY');
    let errorSeq = 1;
    let objSeq = 1;

    function pushError(type, description, target, source) {
        errors.push({
            id: `ERR-${String(errorSeq++).padStart(4, '0')}`,
            type,
            description,
            target,
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
        const id = `MATCH-${String(objSeq++).padStart(4, '0')}`;
        const target = (s && s.id) || (i && i.id) || (k && k.id) || id;

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
        const contractNumber = (s && s.contractNumber) || (i && i.contractNumber) || (k && k.contractNumber) || null;
        const presentSourcesCount = [presence.site, presence.ilvo, presence.kufar].filter(Boolean).length;
        if (!contractNumber && presentSourcesCount > 0) {
            pushError(ERROR_TYPES.NO_CONTRACT, 'У объекта не указан номер договора', target, presence.site ? 'Сайт' : (presence.ilvo ? 'ILVO' : 'Kufar'));
        }
        // Расхождение номера договора между источниками (сопоставлено по адресу,
        // но номера договоров не совпадают или указаны не везде).
        const contractValues = [s, i, k].filter(Boolean).map((r) => r.contractKey).filter(Boolean);
        const uniqueContracts = new Set(contractValues);
        if (uniqueContracts.size > 1) {
            pushError(ERROR_TYPES.CONTRACT_MISMATCH, 'Номер договора отличается между источниками', target, 'Сайт / ILVO');
        }

        if (presentSourcesCount > 1) {
            if (!presence.site) pushError(ERROR_TYPES.MISSING_SITE, 'Объект есть в других источниках, но отсутствует на сайте', target, presence.ilvo ? 'ILVO' : 'Kufar');
            if (!presence.ilvo) pushError(ERROR_TYPES.MISSING_ILVO, 'Объект есть в других источниках, но отсутствует в ILVO', target, presence.site ? 'Сайт' : 'Kufar');
            if (!presence.kufar) pushError(ERROR_TYPES.MISSING_KUFAR, 'Объект есть в других источниках, но отсутствует в XML Kufar', target, presence.site ? 'Сайт' : 'ILVO');
        }

        let status = 'ok';
        if (presentSourcesCount < 3) status = 'missing';
        if (fieldDiffs.length > 0) status = 'mismatch';

        const merged = {};
        for (const field of OBJECT_FIELDS) {
            merged[field.key] = primary[field.key] !== undefined ? primary[field.key] : null;
        }

        objects.push({
            ...merged,
            id: target,
            title: merged.title || [primary.type, primary.address].filter(Boolean).join(', '),
            presence,
            matchedBy: group.matchedBy,
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
        .map((o) => ({ number: o.contractNumber, key: extractContractKey(o.contractNumber), date: null, objectId: o.id }));
    const allContracts = [...derivedContracts, ...(contracts || [])];

    // Проверки договоров.
    const contractByKey = new Map();
    for (const c of allContracts) {
        const key = c.key || c.number;
        if (!key) continue;
        if (!contractByKey.has(key)) contractByKey.set(key, []);
        contractByKey.get(key).push(c);
    }
    for (const [, list] of contractByKey.entries()) {
        const number = list[0].number;
        if (list.length > 1) {
            pushError(ERROR_TYPES.DUPLICATE_CONTRACT, `Номер договора ${number} используется у ${list.length} записей`, number, 'Договоры');
        }
        for (const c of list) {
            if (!c.objectId || !objectIds.has(c.objectId)) {
                pushError(ERROR_TYPES.CONTRACT_NO_OBJECT, `Договор ${number} не привязан ни к одному объекту`, number, 'Договоры');
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
        siteCount: site.length,
        ilvoCount: ilvo.length,
        kufarCount: kufar.length,
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
