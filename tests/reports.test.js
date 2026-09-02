'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');

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