'use strict';

// Только сведения об объекте: рекламная подпись часто содержит адрес офиса.
function propertyDescription(description) {
    return String(description || '').split(
        /(?:лицензия|работаем со всеми|консультаци[а-яё]*\s+по|обращайтесь|наш\s+офис|адрес\s+офиса|покупатель\s+не\s+платит|ООО\s*["«])/iu
    )[0];
}

function extractBizlidaLocation(title, description) {
    const parts = [String(title || ''), propertyDescription(description)];
    const localities = [];
    const streets = [];
    const localityPattern = /(?:^|[\s,(])(?:г\.\s*п\.|д\.|деревн[а-яё]*\s+|аг\.|агрогород[а-яё]*\s+|г\.|город[ае]?\s+|пос\.|(?:городском\s+)?пос[её]л[а-яё]*\s+)\s*([А-ЯЁ][А-Яа-яЁё]*(?:-[А-Яа-яЁё0-9]+)*(?:\s+[А-ЯЁ][а-яё-]+)?)/gu;
    // Название может начинаться с числа; последующие слова — с маленькой
    // буквы («7 ноября», «40 лет Победы»). Не захватываем следующее предложение.
    const streetPattern = /(?:^|[\s,(])(?:улиц[а-яё]*|проспект[а-яё]*|переул[а-яё]*|бульвар[а-яё]*|ул\.?|пр-т\.?|пер\.?|б-р\.?)(?![а-яё])\s*((?:\d+\s+)?[А-Яа-яЁёA-Za-z](?:\.\s*)?[А-Яа-яЁёA-Za-z-]*(?:\s+(?:лет\s+)?[А-ЯЁ][А-Яа-яЁё-]*){0,3})(?:\s*,?\s*(?:д(?:ом)?\.?\s*)?(\d+[а-яА-Яa-zA-Z]?(?:\/\d+)?)(?:\s*(?:корп(?:ус)?\.?|к\.?|[-–—])\s*(\d+[а-яА-Яa-zA-Z]?))?)?/gu;
    for (const text of parts) {
        for (const match of text.matchAll(localityPattern)) {
            const before = text.slice(0, match.index).trim();
            // Не путать местоположение с расстоянием до ближайшего города.
            if (/(?:от|до|от центра)\s*$/iu.test(before)) continue;
            const words = match[1].split(/\s+/);
            localities.push(words.length > 1 && !/(?:ая|яя|ое|ее|ий|ый|ой)$/u.test(words[0]) ? words[0] : match[1]);
        }
        for (const match of text.matchAll(streetPattern)) {
            if (/^(?:д|деревн|аг)(?:\.|$)/iu.test(match[1])) continue;
            streets.push({ name: match[1].trim(), house: match[2], corpus: match[3] });
        }
    }
    let city = localities[0] || null;
    if (city === 'Лиде' || city === 'Лиды') city = 'Лида';
    if (!city) city = String(title || '').match(/(?:^|\s)в\s+(Вороново)(?=$|[\s,.])/u)?.[1] || null;
    if (!city) city = String(title || '').match(/\((Новос[её]лки)\)/u)?.[1] || null;
    const streetKey = (name) => name.toLowerCase().replace(/ё/g, 'е').replace(/ой$/u, 'ая');
    // Уточняем улицу из заголовка, а не подменяем её адресом ориентира.
    const street = streets.filter((candidate) => streetKey(candidate.name) === streetKey(streets[0].name))
        .sort((a, b) => Number(!!b.house) - Number(!!a.house)
        || Number(!!b.corpus) - Number(!!a.corpus))[0];
    const text = parts.join(' ');
    const garden = text.match(/(?:^|\s)(?:СТ|садовом\s+товариществе)\s+[«"]?([А-ЯЁ][А-Яа-яЁё-]*)/u);
    const shortStreet = parts[0].match(/квартир[а-яё]*\s+на\s+([А-ЯЁ][А-Яа-яЁё-]*ского)(?=$|[\s,.])/u);
    return {
        city,
        address: street
            ? [street.name, street.house, street.corpus ? `корпус ${street.corpus}` : null].filter(Boolean).join(', ')
            : garden ? `СТ ${garden[1]}` : shortStreet ? shortStreet[1] : null
    };
}

function numberMatch(text, pattern) {
    const match = text.match(pattern);
    return match ? Number(match[1].replace(',', '.')) : null;
}

// Эти признаки применяются к каждой стороне сравнения, а не только к XLSX.
// Не смешиваем общую площадь и площадь по СНБ, не используем цену как ID.
function propertyFeatures(record) {
    const text = `${record.title || ''} ${propertyDescription(record.description)}`.toLowerCase().replace(/ё/g, 'е');
    return {
        year: numberMatch(text, /((?:19|20)\d{2})\s*(?:г\.?\s*п\.?|года\s+постройки)/u)
            || numberMatch(text, /постро[а-я]*\s+в\s+((?:19|20)\d{2})/u),
        plot: numberMatch(text, /(?:участ[а-я]*\s*[:—–-]?\s*(?:(?:площадью|в)\s*)?|на\s+)(\d+(?:[.,]\d+)?)\s*сот/u),
        snb: numberMatch(text, /(?:площад[а-я]*\s*)?по\s+снб[^0-9]{0,25}(\d+(?:[.,]\d+)?)/u),
        distance: numberMatch(text, /(?:всего\s+)?(?:в\s+)?(\d+(?:[.,]\d+)?)\s*(?:км|километр[а-я]*)\s+от\s+(?:центра\s+)?(?:города\s+)?лид/u),
        pond: /собственн[а-я]*\s+(?:живописн[а-я]*\s+)?пруд/u.test(text),
        project: /чешк[а-я]*|чешск[а-я]*\s+проект/u.test(text) ? 'чешка' : null
    };
}

function compatiblePropertyType(a, b) {
    if (!a.type || !b.type || a.type === b.type) return true;
    // Сайт классифицирует садовые дома как «Дом», Bizlida — как «Дача».
    if ([a.type, b.type].every((type) => ['Дом', 'Дача'].includes(type))) {
        return /(?<![а-яё])ст(?![а-яё])|дач|садов/iu.test(`${a.title} ${a.address} ${b.title} ${b.address}`);
    }
    return false;
}

function additionalEvidence(a, b) {
    const fa = propertyFeatures(a), fb = propertyFeatures(b);
    const matches = [];
    const conflicts = [];
    for (const key of ['year', 'plot', 'snb', 'distance']) {
        if (fa[key] === null || fb[key] === null) continue;
        // В кратком объявлении участок часто записан целым числом соток
        // (10 вместо кадастровых 10,7). Разница до сотки не опровергает
        // совпадение; для двух дробных значений оставляем строгий допуск.
        const tolerance = key === 'plot' && (Number.isInteger(fa.plot) || Number.isInteger(fb.plot))
            ? 1 : ['plot', 'snb'].includes(key) ? Math.max(0.1, Math.max(fa[key], fb[key]) * 0.01) : 0;
        (Math.abs(fa[key] - fb[key]) <= tolerance ? matches : conflicts).push(key);
    }
    if (fa.pond && fb.pond) matches.push('pond');
    if (fa.project && fa.project === fb.project) matches.push('project');
    return { matches, conflicts };
}

module.exports = { propertyDescription, extractBizlidaLocation, propertyFeatures, compatiblePropertyType, additionalEvidence };
