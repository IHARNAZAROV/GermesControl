'use strict';

const fs = require('fs-extra');
const path = require('path');
const XLSX = require('xlsx');
const { XMLParser } = require('fast-xml-parser');
const { OBJECT_FIELDS } = require('./schema');

const NUMERIC_KEYS = new Set(OBJECT_FIELDS.filter((f) => f.numeric).map((f) => f.key));

function toNumberOrNull(v) {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(String(v).toString().replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
}

function normalizeRecord(raw) {
    const rec = {};
    for (const field of OBJECT_FIELDS) {
        let v = raw[field.key];
        if (v === undefined) v = null;
        if (NUMERIC_KEYS.has(field.key)) v = toNumberOrNull(v);
        if (typeof v === 'string') v = v.trim();
        rec[field.key] = v === '' ? null : v;
    }
    if (!rec.id) return null;
    return rec;
}

/**
 * Сайт ГермесГарант — ручная выгрузка в формате JSON.
 * Ожидается массив объектов либо { objects: [...] }.
 */
async function parseSiteJson(filePath) {
    const raw = await fs.readJson(filePath);
    const list = Array.isArray(raw) ? raw : (Array.isArray(raw.objects) ? raw.objects : []);
    return list.map(normalizeRecord).filter(Boolean);
}

/**
 * ILVO CRM — ручная выгрузка в формате XLSX.
 * Первая строка листа — заголовки, совпадающие с ключами схемы
 * (id, title, type, dealType, city, address, price, priceUsd,
 * rooms, totalArea, livingArea, kitchenArea, floor, floors,
 * description, contractNumber, status).
 */
async function parseIlvoXlsx(filePath) {
    const wb = XLSX.readFile(filePath);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
    return rows.map(normalizeRecord).filter(Boolean);
}

function unwrapArray(v) {
    if (v === undefined || v === null) return [];
    return Array.isArray(v) ? v : [v];
}

/**
 * Kufar — автоматическая XML-выгрузка из ILVO.
 * Ожидаемая структура: <feed><offer id="..."><title/>...<contractNumber/></offer></feed>
 * Допускается корневой узел <ads><ad>...</ad></ads> как альтернативный формат.
 */
async function parseKufarXml(filePathOrContent, isRawContent) {
    const xml = isRawContent ? filePathOrContent : await fs.readFile(filePathOrContent, 'utf-8');
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
    const parsed = parser.parse(xml);

    const root = parsed.feed || parsed.ads || parsed;
    let items = unwrapArray(root && (root.offer || root.ad));

    return items
        .map((item) => {
            const rec = {};
            for (const field of OBJECT_FIELDS) {
                const v = item[field.key] !== undefined ? item[field.key] : item['@_' + field.key];
                rec[field.key] = v && typeof v === 'object' ? (v['#text'] ?? null) : v;
            }
            if (!rec.id) rec.id = item['@_id'] || null;
            return normalizeRecord(rec);
        })
        .filter(Boolean);
}

module.exports = { parseSiteJson, parseIlvoXlsx, parseKufarXml, normalizeRecord };
