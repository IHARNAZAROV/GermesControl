'use strict';

/**
 * Детерминированный генератор демонстрационного набора данных.
 * Используется при первом запуске приложения, чтобы Dashboard и
 * остальные разделы сразу показывали содержательную картину, а
 * также доступен из «Настроек» как «Восстановить демо-данные».
 *
 * Числа подобраны так, чтобы примерно соответствовать примерам
 * из технического задания (247 / 231 / 224 / ~29 проблем).
 */

const CITIES = ['Минск', 'Гродно', 'Брест', 'Витебск', 'Могилёв', 'Гомель'];
const TYPES = ['Квартира', 'Дом', 'Коммерческая', 'Участок'];
const DEAL_TYPES = ['Продажа', 'Аренда'];
const STREETS = ['ул. Независимости', 'пр. Победителей', 'ул. Немига', 'ул. Сурганова', 'ул. Притыцкого', 'ул. Козлова', 'ул. Кальварийская'];

// Простой детерминированный ГПСЧ (mulberry32), чтобы демо-набор
// был воспроизводим между запусками генератора.
function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function pick(rng, arr) {
    return arr[Math.floor(rng() * arr.length)];
}

function buildBaseObject(rng, idNum) {
    const id = `OBJ-${String(idNum).padStart(4, '0')}`;
    const type = pick(rng, TYPES);
    const dealType = pick(rng, DEAL_TYPES);
    const city = pick(rng, CITIES);
    const rooms = type === 'Квартира' ? 1 + Math.floor(rng() * 4) : 0;
    const totalArea = Math.round((30 + rng() * 150) * 10) / 10;
    const livingArea = Math.round(totalArea * (0.55 + rng() * 0.2) * 10) / 10;
    const kitchenArea = Math.round((6 + rng() * 12) * 10) / 10;
    const floor = 1 + Math.floor(rng() * 16);
    const floors = floor + Math.floor(rng() * 6);
    const pricePerM2 = 900 + rng() * 900;
    const priceUsd = Math.round(totalArea * pricePerM2);
    const price = Math.round(priceUsd * 3.27);
    const address = `${pick(rng, STREETS)}, ${1 + Math.floor(rng() * 180)}`;

    return {
        id,
        title: `${type}, ${rooms > 0 ? rooms + '-комн., ' : ''}${totalArea} м²`,
        type,
        dealType,
        city,
        address,
        price,
        priceUsd,
        rooms,
        totalArea,
        livingArea,
        kitchenArea,
        floor,
        floors,
        description: `${type} в городе ${city}, ${totalArea} м², ${floor}/${floors} этаж.`,
        contractNumber: null,
        status: rng() < 0.08 ? 'sold' : 'active'
    };
}

function cloneFor(source, obj) {
    const copy = { ...obj };
    if (source === 'kufar') {
        // Kufar получает данные через рекламную XML-выгрузку - минимум полей.
        delete copy.description;
        delete copy.status;
    }
    return copy;
}

function buildSampleDataset() {
    const rng = makeRng(20260827);

    // Группы по присутствию в источниках (site, ilvo, kufar):
    const GROUPS = [
        { key: 'all', count: 196, site: true, ilvo: true, kufar: true },
        { key: 'missingSite', count: 12, site: false, ilvo: true, kufar: true },
        { key: 'missingKufar', count: 17, site: true, ilvo: true, kufar: false },
        { key: 'missingIlvo', count: 9, site: true, ilvo: false, kufar: true },
        { key: 'onlySite', count: 25, site: true, ilvo: false, kufar: false },
        { key: 'onlyIlvo', count: 6, site: false, ilvo: true, kufar: false },
        { key: 'onlyKufar', count: 7, site: false, ilvo: false, kufar: true }
    ];

    const site = [];
    const ilvo = [];
    const kufar = [];
    const contracts = [];
    let contractSeq = 4560;
    let idNum = 1;

    const withContractLog = [];

    for (const group of GROUPS) {
        for (let i = 0; i < group.count; i++) {
            const base = buildBaseObject(rng, idNum++);

            // Назначаем «истинный» номер договора большинству объектов.
            const hasContract = rng() < 0.87;
            let contractNumber = null;
            if (hasContract) {
                contractSeq += 1;
                contractNumber = `№${contractSeq}`;
            }
            base.contractNumber = contractNumber;

            const siteRec = cloneFor('site', base);
            const ilvoRec = cloneFor('ilvo', base);
            const kufarRec = cloneFor('kufar', base);

            // Расхождения полей между источниками (только если объект есть в 2+ источниках).
            const presentCount = [group.site, group.ilvo, group.kufar].filter(Boolean).length;
            if (presentCount >= 2) {
                const roll = rng();
                if (roll < 0.06 && group.site && group.ilvo) {
                    ilvoRec.price = Math.round(base.price * (1 + (rng() < 0.5 ? -1 : 1) * (0.02 + rng() * 0.05)));
                } else if (roll < 0.1 && group.site && group.kufar) {
                    kufarRec.totalArea = Math.round((base.totalArea + (rng() < 0.5 ? -1 : 1) * (2 + rng() * 5)) * 10) / 10;
                } else if (roll < 0.13 && group.site && group.ilvo) {
                    ilvoRec.address = `${pick(rng, STREETS)}, ${1 + Math.floor(rng() * 180)}`;
                } else if (roll < 0.15 && group.site && group.kufar && base.rooms > 0) {
                    kufarRec.rooms = Math.max(1, base.rooms + (rng() < 0.5 ? -1 : 1));
                } else if (roll < 0.17 && contractNumber && group.site && group.ilvo) {
                    ilvoRec.contractNumber = `№${contractSeq + 500}`;
                }
            }

            if (group.site) site.push(siteRec);
            if (group.ilvo) ilvo.push(ilvoRec);
            if (group.kufar) kufar.push(kufarRec);

            if (contractNumber) {
                withContractLog.push({ objectId: base.id, contractNumber, date: base.id });
            }
        }
    }

    // Реестр договоров (учётная система): почти все совпадают с объектами,
    // плюс несколько дублей и «сирот» без объекта.
    const baseDate = new Date('2026-08-27T00:00:00');
    function dateOffset(days) {
        const d = new Date(baseDate.getTime() - days * 86400000);
        return d.toISOString().slice(0, 10);
    }

    withContractLog.forEach((entry, idx) => {
        contracts.push({
            number: entry.contractNumber,
            date: dateOffset(Math.floor(rng() * 240)),
            objectId: entry.objectId
        });
    });

    // Дубликаты номеров договоров у разных объектов.
    for (let i = 0; i < 3 && i + 1 < contracts.length; i++) {
        const victim = contracts[10 + i * 17];
        const donor = contracts[40 + i * 13];
        if (victim && donor) {
            donor.number = victim.number;
        }
    }

    // Договоры без объекта («сироты»).
    for (let i = 0; i < 6; i++) {
        contractSeq += 1;
        contracts.push({
            number: `№${contractSeq}`,
            date: dateOffset(30 + i * 40),
            objectId: null
        });
    }

    return { site, ilvo, kufar, contracts };
}

module.exports = { buildSampleDataset };
