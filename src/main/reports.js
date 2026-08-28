'use strict';

const fs = require('fs-extra');
const path = require('path');
const dayjs = require('dayjs');
const XLSX = require('xlsx');
const PDFDocument = require('pdfkit');

const REPORT_LABELS = {
    missing: 'Отчёт по отсутствующим объектам',
    contracts: 'Отчёт по договорам',
    errors: 'Отчёт по ошибкам',
    diffs: 'Отчёт по расхождениям данных',
    full: 'Полный отчёт'
};

function buildRows(reportType, report) {
    const { objects, errors, contracts } = report;
    switch (reportType) {
        case 'missing':
            return objects
                .filter((o) => o.status === 'missing')
                .map((o) => ({
                    'ID группы': o.id,
                    Объект: o.title || '',
                    Сайт: o.presence.site ? 'есть' : 'нет',
                    ILVO: o.presence.ilvo ? 'есть' : 'нет',
                    Kufar: o.presence.kufar ? 'есть' : 'нет'
                }));
        case 'contracts':
            return contracts.map((c) => ({
                'Номер договора': c.number || '',
                Дата: c.date || '',
                'ID группы': c.objectId || '—'
            }));
        case 'errors':
            return errors.map((e) => ({
                Тип: e.type,
                Описание: e.description,
                'Объект / Договор': e.target,
                Источник: e.source,
                Дата: e.date,
                Важность: e.severity,
                Статус: e.status
            }));
        case 'diffs':
            return objects
                .filter((o) => o.fieldDiffs && o.fieldDiffs.length)
                .flatMap((o) =>
                    o.fieldDiffs.map((d) => ({
                        'ID группы': o.id,
                        Поле: d.label,
                        Сайт: d.values.site ?? '',
                        ILVO: d.values.ilvo ?? '',
                        Kufar: d.values.kufar ?? ''
                    }))
                );
        case 'full':
        default:
            return objects.map((o) => ({
                'ID группы': o.id,
                Объект: o.title || '',
                Тип: o.type || '',
                Город: o.city || '',
                Цена: o.price ?? '',
                Площадь: o.totalArea ?? '',
                Договор: o.contractNumber || '',
                Сайт: o.presence.site ? '✓' : '×',
                ILVO: o.presence.ilvo ? '✓' : '×',
                Kufar: o.presence.kufar ? '✓' : '×',
                Статус: o.status
            }));
    }
}

async function writeXlsx(rows, destPath, sheetName) {
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
    XLSX.writeFile(wb, destPath);
}

async function writeCsv(rows, destPath) {
    if (rows.length === 0) {
        await fs.writeFile(destPath, '');
        return;
    }
    const headers = Object.keys(rows[0]);
    const lines = [headers.join(';')];
    for (const row of rows) {
        lines.push(headers.map((h) => String(row[h] ?? '').replace(/;/g, ',')).join(';'));
    }
    await fs.writeFile(destPath, '\uFEFF' + lines.join('\n'), 'utf-8');
}

async function writeJson(rows, destPath, reportType, report) {
    await fs.writeJson(destPath, { type: reportType, generatedAt: new Date().toISOString(), checkedAt: report.checkedAt, rows }, { spaces: 2 });
}

function writePdf(rows, destPath, title) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 40, size: 'A4' });
        const stream = fs.createWriteStream(destPath);
        doc.pipe(stream);
        doc.fontSize(16).fillColor('#155945').text(title, { align: 'left' });
        doc.moveDown(0.3);
        doc.fontSize(9).fillColor('#6B7280').text(`Сформировано: ${dayjs().format('DD.MM.YYYY HH:mm')}`);
        doc.moveDown(1);

        if (rows.length === 0) {
            doc.fontSize(11).fillColor('#1F2937').text('Нет данных для отображения.');
        } else {
            const headers = Object.keys(rows[0]);
            const colWidth = Math.max(60, Math.floor(500 / headers.length));
            doc.fontSize(9).fillColor('#0D3F34');
            let y = doc.y;
            headers.forEach((h, idx) => doc.text(String(h), 40 + idx * colWidth, y, { width: colWidth }));
            doc.moveDown(0.5);
            doc.fontSize(8).fillColor('#1F2937');
            rows.slice(0, 400).forEach((row) => {
                y = doc.y;
                if (y > 760) {
                    doc.addPage();
                    y = doc.y;
                }
                headers.forEach((h, idx) => doc.text(String(row[h] ?? ''), 40 + idx * colWidth, y, { width: colWidth }));
                doc.moveDown(0.4);
            });
        }
        doc.end();
        stream.on('finish', resolve);
        stream.on('error', reject);
    });
}

async function generateReport({ reportType, format, report, destPath }) {
    const rows = buildRows(reportType, report);
    const title = REPORT_LABELS[reportType] || 'Отчёт';
    if (format === 'xlsx') await writeXlsx(rows, destPath, title);
    else if (format === 'csv') await writeCsv(rows, destPath);
    else if (format === 'json') await writeJson(rows, destPath, reportType, report);
    else if (format === 'pdf') await writePdf(rows, destPath, title);
    else throw new Error(`Неизвестный формат отчёта: ${format}`);
    return { rows: rows.length, destPath };
}

module.exports = { generateReport, REPORT_LABELS };
