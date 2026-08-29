'use strict';

const { ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const dayjs = require('dayjs');
const store = require('./dataStore');
const {
    parseSiteJson,
    parseSiteJsonContent,
    parseIlvoXlsx,
    parseIlvoApiEvents,
    parseKufarXml
} = require('./parsers');
const { runComparison } = require('./compare');
const { generateReport, REPORT_LABELS } = require('./reports');
const { SOURCES } = require('./schema');

const FILE_FILTERS = {
    site: [{ name: 'JSON', extensions: ['json'] }],
    ilvo: [{ name: 'Excel', extensions: ['xlsx', 'xls'] }],
    kufar: [{ name: 'XML', extensions: ['xml'] }]
};

const FORMAT_EXT = { xlsx: 'xlsx', csv: 'csv', json: 'json', pdf: 'pdf' };
const SITE_JSON_URL = 'https://germesgarant.by/data/objects.json';
const ILVO_EVENTS_URL = 'https://api.ilvo.pro/v1/events';
const URL_REQUEST_TIMEOUT_MS = 30_000;

function buildFullState() {
    const state = store.getState();
    const lastReport = store.getLastReport();
    const history = store.getHistory();
    return {
        sources: state.sources,
        contracts: state.contracts,
        report: lastReport,
        history,
        settings: store.settings.store
    };
}

async function importFromPath(sourceKey, filePath) {
    let records;
    if (sourceKey === 'site') records = await parseSiteJson(filePath);
    else if (sourceKey === 'ilvo') records = await parseIlvoXlsx(filePath);
    else if (sourceKey === 'kufar') records = await parseKufarXml(filePath, false);
    else throw new Error('Неизвестный источник: ' + sourceKey);

    const storedPath = store.copyUploadedFile(sourceKey, filePath);
    store.setSourceData(sourceKey, records, { fileName: path.basename(filePath), storedPath, isDemo: false });
    return { sourceKey, count: records.length, fileName: path.basename(filePath) };
}

function registerIpcHandlers(getMainWindow) {
    ipcMain.handle('app:getState', async () => buildFullState());

    ipcMain.handle('app:selectAndImportFile', async (evt, sourceKey) => {
        const win = getMainWindow();
        const { canceled, filePaths } = await dialog.showOpenDialog(win, {
            title: `Загрузить ${SOURCES[sourceKey].label}`,
            filters: FILE_FILTERS[sourceKey],
            properties: ['openFile']
        });
        if (canceled || !filePaths[0]) return { canceled: true };
        const result = await importFromPath(sourceKey, filePaths[0]);
        return { canceled: false, ...result };
    });

    ipcMain.handle('app:importSiteFromUrl', async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), URL_REQUEST_TIMEOUT_MS);
        let response;
        try {
            response = await fetch(SITE_JSON_URL, {
                headers: { Accept: 'application/json' },
                signal: controller.signal
            });
            if (!response.ok) {
                throw new Error(`Сайт вернул ошибку HTTP ${response.status}.`);
            }
            const jsonText = await response.text();
            let records;
            try {
                records = parseSiteJsonContent(jsonText);
            } catch (error) {
                throw new Error(`Сайт вернул некорректный JSON: ${error.message}`);
            }
            if (records.length === 0) {
                throw new Error('В выгрузке сайта не найдено объектов.');
            }

            const storedPath = store.saveRawContent('site', 'objects.json', jsonText);
            store.setSourceData('site', records, {
                fileName: 'objects.json (сайт)',
                storedPath,
                sourceUrl: SITE_JSON_URL,
                isDemo: false
            });
            return { sourceKey: 'site', count: records.length, fileName: 'objects.json (сайт)', sourceUrl: SITE_JSON_URL };
        } catch (error) {
            if (error?.name === 'AbortError') {
                throw new Error('Сайт не ответил за 30 секунд. Проверьте подключение к интернету.');
            }
            throw error;
        } finally {
            clearTimeout(timeout);
        }
    });

    ipcMain.handle('app:importKufarFromUrl', async (evt, url) => {
        const targetUrl = url || store.settings.get('kufarXmlUrl');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), URL_REQUEST_TIMEOUT_MS);
        try {
            const response = await fetch(targetUrl, { signal: controller.signal });
            if (!response.ok) throw new Error(`Не удалось загрузить XML (${response.status})`);
            const xmlText = await response.text();
            const records = await parseKufarXml(xmlText, true);
            const storedPath = store.saveRawContent('kufar', 'kufar-feed.xml', xmlText);
            store.setSourceData('kufar', records, { fileName: 'kufar-feed.xml (URL)', storedPath, isDemo: false });
            return { count: records.length, fileName: 'kufar-feed.xml' };
        } catch (error) {
            if (error?.name === 'AbortError') {
                throw new Error('Kufar XML не ответил за 30 секунд. Проверьте ссылку и подключение к интернету.');
            }
            throw error;
        } finally {
            clearTimeout(timeout);
        }
    });

    ipcMain.handle('app:importIlvoFromApi', async () => {
        const token = String(process.env.ILVO_API_TOKEN || '').trim();
        if (!token) {
            throw new Error('Не найден ключ ILVO API. В Replit добавьте ILVO_API_TOKEN в Secrets, а при запуске из VS Code — в локальный файл .env.');
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), URL_REQUEST_TIMEOUT_MS);
        try {
            const response = await fetch(ILVO_EVENTS_URL, {
                headers: {
                    Accept: 'application/json',
                    'x-token': token
                },
                signal: controller.signal
            });
            if (!response.ok) {
                if (response.status === 403) {
                    throw new Error('ILVO отклонил ключ API (HTTP 403). Проверьте ключ в Secrets и настройки доступа в ILVO.');
                }
                throw new Error(`ILVO вернул ошибку HTTP ${response.status}.`);
            }

            const jsonText = await response.text();
            let rawEvents;
            try {
                rawEvents = JSON.parse(jsonText);
            } catch (error) {
                throw new Error(`ILVO вернул некорректный JSON: ${error.message}`);
            }
            const records = parseIlvoApiEvents(rawEvents);
            if (records.length === 0) {
                throw new Error('В ответе ILVO не найдено событий с данными объектов.');
            }

            const storedPath = store.saveRawContent('ilvo', 'events.json', jsonText);
            store.setSourceData('ilvo', records, {
                fileName: 'events.json (ILVO API)',
                storedPath,
                sourceUrl: ILVO_EVENTS_URL,
                eventCount: Array.isArray(rawEvents) ? rawEvents.length : 0,
                syncMode: 'api',
                isDemo: false
            });
            return {
                sourceKey: 'ilvo',
                count: records.length,
                eventCount: Array.isArray(rawEvents) ? rawEvents.length : 0,
                fileName: 'events.json (ILVO API)',
                sourceUrl: ILVO_EVENTS_URL
            };
        } catch (error) {
            if (error?.name === 'AbortError') {
                throw new Error('ILVO не ответил за 30 секунд. Проверьте ссылку и подключение к интернету.');
            }
            throw error;
        } finally {
            clearTimeout(timeout);
        }
    });

    ipcMain.handle('app:runCheck', async () => {
        const state = store.getState();
        const previous = store.getLastReport();
        const site = (state.sources.site && state.sources.site.data) || [];
        const ilvo = (state.sources.ilvo && state.sources.ilvo.data) || [];
        const kufar = (state.sources.kufar && state.sources.kufar.data) || [];
        const sourceKeys = ['site', 'ilvo', 'kufar'];
        const allSourcesAreDemo = sourceKeys.every((sourceKey) => state.sources[sourceKey]?.meta?.isDemo === true);
        const report = runComparison({
            site,
            ilvo,
            kufar,
            contracts: state.contracts || [],
            includeContractRegistry: allSourcesAreDemo
        }, previous);
        store.saveLastReport(report);
        store.appendHistory({
            checkedAt: report.checkedAt,
            stats: report.stats,
            categories: report.categories
        });
        return report;
    });

    ipcMain.handle('app:getSettings', async () => store.settings.store);

    ipcMain.handle('app:setSettings', async (evt, patch) => {
        store.settings.set(patch);
        return store.settings.store;
    });

    ipcMain.handle('app:resetSampleData', async () => {
        store.resetToSampleData();
        return buildFullState();
    });

    ipcMain.handle('app:generateReport', async (evt, { reportType, format }) => {
        const report = store.getLastReport();
        if (!report) throw new Error('Сначала запустите проверку данных.');
        const win = getMainWindow();
        const suggested = `${reportType}-${dayjs().format('YYYY-MM-DD')}.${FORMAT_EXT[format]}`;
        const { canceled, filePath } = await dialog.showSaveDialog(win, {
            title: REPORT_LABELS[reportType] || 'Сохранить отчёт',
            defaultPath: suggested,
            filters: [{ name: format.toUpperCase(), extensions: [FORMAT_EXT[format]] }]
        });
        if (canceled || !filePath) return { canceled: true };
        const result = await generateReport({ reportType, format, report, destPath: filePath });
        return { canceled: false, ...result };
    });

    ipcMain.handle('app:openPath', async (evt, targetPath) => {
        await shell.showItemInFolder(targetPath);
    });

    ipcMain.handle('app:exportSampleFiles', async () => {
        const win = getMainWindow();
        const { canceled, filePaths } = await dialog.showOpenDialog(win, {
            title: 'Выберите папку для примеров файлов',
            properties: ['openDirectory']
        });
        if (canceled || !filePaths[0]) return { canceled: true };
        const { buildSampleDataset } = require('./sampleData');
        const XLSX = require('xlsx');
        const dataset = buildSampleDataset();
        const dir = filePaths[0];

        await fs.writeJson(path.join(dir, 'site.sample.json'), dataset.site, { spaces: 2 });

        const ws = XLSX.utils.json_to_sheet(dataset.ilvo);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'ILVO');
        XLSX.writeFile(wb, path.join(dir, 'ilvo.sample.xlsx'));

        const fields = Object.keys(dataset.kufar[0] || {});
        const xmlItems = dataset.kufar
            .map((rec) => `  <offer id="${rec.id}">\n${fields.filter((f) => f !== 'id').map((f) => `    <${f}>${rec[f] ?? ''}</${f}>`).join('\n')}\n  </offer>`)
            .join('\n');
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<feed>\n${xmlItems}\n</feed>\n`;
        await fs.writeFile(path.join(dir, 'kufar.sample.xml'), xml, 'utf-8');

        return { canceled: false, dir };
    });
}

module.exports = { registerIpcHandlers };
