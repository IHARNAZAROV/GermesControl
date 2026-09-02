'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const JSZip = require('jszip');

const { buildSampleDataset } = require('../src/main/sampleData');
const { runComparison } = require('../src/main/compare');
const {
    buildWorkbook,
    generateReport,
    REPORT_COLUMNS
} = require('../src/main/reports');

function demoReport() {
    return runComparison({
        ...buildSampleDataset(),
        includeContractRegistry: true
    });
}

test('builds a readable workbook with a summary and report-specific columns', () => {
    const report = demoReport();

    for (const type of Object.keys(REPORT_COLUMNS)) {
        const { workbook, rows } = buildWorkbook(type, report);
        assert.deepEqual(workbook.SheetNames, ['Сводка', 'Данные']);

        const dataRows = XLSX.utils.sheet_to_json(workbook.Sheets.Данные, {
            range: 3,
            defval: null
        });
        assert.equal(dataRows.length, rows.length);
        assert.deepEqual(Object.keys(dataRows[0]), REPORT_COLUMNS[type]);
        assert.equal(workbook.Sheets.Данные['!autofilter'].ref.startsWith('A4:'), true);
    }
});

test('keeps the report headers even when there are no data rows', () => {
    const { workbook } = buildWorkbook('errors', {
        objects: [],
        errors: [],
        contracts: [],
        stats: {},
        checkedAt: '2026-09-02T09:00:00.000Z'
    });

    const rows = XLSX.utils.sheet_to_json(workbook.Sheets.Данные, {
        range: 3,
        header: 1,
        defval: null
    });
    assert.deepEqual(rows, [REPORT_COLUMNS.errors]);
});

test('rejects every export format except xlsx', async () => {
    const destination = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'germes-reports-')), 'report.xlsx');
    await assert.rejects(
        generateReport({ reportType: 'full', format: 'csv', report: demoReport(), destPath: destination }),
        /только экспорт.*XLSX/iu
    );
    fs.rmSync(path.dirname(destination), { recursive: true, force: true });
});

test('embeds two native colored Excel charts linked to the summary', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'germes-charts-'));
    const destination = path.join(directory, 'report.xlsx');
    await generateReport({
        reportType: 'full',
        format: 'xlsx',
        report: demoReport(),
        destPath: destination
    });

    const zip = new JSZip();
    zip.load(fs.readFileSync(destination));
    const chartOne = zip.file('xl/charts/chart1.xml').asText();
    const chartTwo = zip.file('xl/charts/chart2.xml').asText();
    const drawing = zip.file('xl/drawings/drawing1.xml').asText();
    const sheet = zip.file('xl/worksheets/sheet1.xml').asText();
    const contentTypes = zip.file('[Content_Types].xml').asText();

    assert.match(chartOne, /'Сводка'!\$A\$20:\$A\$22/u);
    assert.match(chartOne, /srgbClr val="155945"/u);
    assert.match(chartTwo, /'Сводка'!\$A\$26:\$A\$30/u);
    assert.match(chartTwo, /srgbClr val="D97706"/u);
    assert.match(drawing, /<xdr:col>4<\/xdr:col>/u);
    assert.match(sheet, /<drawing r:id="rIdChart"\/>/u);
    assert.match(contentTypes, /PartName="\/xl\/drawings\/drawing1\.xml" ContentType="application\/vnd\.openxmlformats-officedocument\.drawing\+xml"/u);

    fs.rmSync(directory, { recursive: true, force: true });
});