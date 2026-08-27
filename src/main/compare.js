'use strict';

const dayjs = require('dayjs');
const { OBJECT_FIELDS, ERROR_TYPES, ERROR_SEVERITY } = require('./schema');

const COMPARABLE_FIELDS = OBJECT_FIELDS.filter((f) => f.compare && f.key !== 'contractNumber');

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
    return String(a).trim().toLowerCase() !== String(b).trim().toLowerCase();
}

function indexBy(list) {
    const map = new Map();
    for (const rec of list) map.set(rec.id, rec);
    return map;
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
    const siteMap = indexBy(site);
    const ilvoMap = indexBy(ilvo);
    const kufarMap = indexBy(kufar);

    const allIds = new Set([...siteMap.keys(), ...ilvoMap.keys(), ...kufarMap.keys()]);

    const objects = [];
    const errors = [];
    const now = dayjs().format('DD.MM.YYYY');
    let errorSeq = 1;

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

    for (const id of allIds) {
        const s = siteMap.get(id) || null;
        const i = ilvoMap.get(id) || null;
        const k = kufarMap.get(id) || null;
        const presence = { site: !!s, ilvo: !!i, kufar: !!k };
        const primary = s || i || k;

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
                if (!errors.some((e) => e.type === errType && e.target === id)) {
                    pushError(errType, `${field.label}: значения расходятся между источниками`, id, 'Сайт / ILVO / Kufar');
                }
            }
        }

        // Договор объекта отсутствует.
        const contractNumber = primary ? primary.contractNumber : null;
        if (!contractNumber && (presence.site || presence.ilvo)) {
            pushError(ERROR_TYPES.NO_CONTRACT, 'У объекта не указан номер договора', id, primary === s ? 'Сайт' : 'ILVO');
        }
        // Расхождение номера договора между источниками.
        const contractValues = [s, i, k].filter(Boolean).map((r) => r.contractNumber).filter(Boolean);
        const uniqueContracts = new Set(contractValues);
        if (uniqueContracts.size > 1) {
            pushError(ERROR_TYPES.CONTRACT_MISMATCH, 'Номер договора отличается между источниками', id, 'Сайт / ILVO');
        }

        if (!presence.site) pushError(ERROR_TYPES.MISSING_SITE, 'Объект есть в других источниках, но отсутствует на сайте', id, presence.ilvo ? 'ILVO' : 'Kufar');
        if (!presence.ilvo) pushError(ERROR_TYPES.MISSING_ILVO, 'Объект есть в других источниках, но отсутствует в ILVO', id, presence.site ? 'Сайт' : 'Kufar');
        if (!presence.kufar) pushError(ERROR_TYPES.MISSING_KUFAR, 'Объект есть в других источниках, но отсутствует в XML Kufar', id, presence.site ? 'Сайт' : 'ILVO');

        let status = 'ok';
        if (!presence.site || !presence.ilvo || !presence.kufar) status = 'missing';
        if (fieldDiffs.length > 0) status = 'mismatch';

        objects.push({
            id,
            ...primary,
            id, // гарантируем неизменность id после спреда
            presence,
            fieldDiffs,
            contractNumber,
            status
        });
    }

    // Проверки договоров.
    const contractByNumber = new Map();
    for (const c of contracts) {
        if (!c.number) continue;
        if (!contractByNumber.has(c.number)) contractByNumber.set(c.number, []);
        contractByNumber.get(c.number).push(c);
    }
    for (const [number, list] of contractByNumber.entries()) {
        if (list.length > 1) {
            pushError(ERROR_TYPES.DUPLICATE_CONTRACT, `Номер договора ${number} используется у ${list.length} записей`, number, 'Договоры');
        }
        for (const c of list) {
            if (!c.objectId || !allIds.has(c.objectId)) {
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
        contracts,
        categories,
        stats,
        deltas
    };
}

module.exports = { runComparison };
