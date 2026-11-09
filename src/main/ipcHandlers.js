'use strict';

const { ipcMain, dialog, shell } = require('electron');
const path = require('path');
const dayjs = require('dayjs');
const store = require('./dataStore');
const {
    parseSiteJson,
    parseSiteJsonContent,
    parseIlvoXlsx,
    parseBizlidaXlsx,
    parseKufarXml
} = require('./parsers');
const { runComparison } = require('./compare');
const { generateReport, REPORT_LABELS } = require('./reports');
const { SOURCES } = require('./schema');
const { scrapeBizlida } = require('./bizlidaScraper');
let bizlidaUpdating = false;

const FILE_FILTERS = {
    site: [{ name: 'JSON', extensions: ['json'] }],
    ilvo: [{ name: 'Excel', extensions: ['xlsx', 'xls'] }],
    kufar: [{ name: 'XML', extensions: ['xml'] }],
    bizlida: [{ name: 'Excel', extensions: ['xlsx'] }]
};

const REPORT_FORMAT = 'xlsx';
const SITE_JSON_URL = 'https://germesgarant.by/data/objects-source.json';
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
        bizlidaUpdating,
        settings: store.settings.store
    };
}

async function importFromPath(sourceKey, filePath) {
    if (sourceKey === 'bizlida' && bizlidaUpdating) throw new Error('Дождитесь завершения обновления Bizlida.');
    let records;
    if (sourceKey === 'site') records = await parseSiteJson(filePath);
    else if (sourceKey === 'ilvo') records = await parseIlvoXlsx(filePath);
    else if (sourceKey === 'bizlida') records = await parseBizlidaXlsx(filePath);
    else if (sourceKey === 'kufar') records = await parseKufarXml(filePath, false);
    else throw new Error('Неизвестный источник: ' + sourceKey);

    const storedPath = store.copyUploadedFile(sourceKey, filePath);
    store.setSourceData(sourceKey, records, { fileName: path.basename(filePath), storedPath, isDemo: false });
    return { sourceKey, count: records.length, fileName: path.basename(filePath) };
}

function runCurrentCheck() {
    const state = store.getState();
    const allSourcesAreDemo = ['site', 'ilvo', 'kufar']
        .every((key) => state.sources[key]?.meta?.isDemo === true);
    const report = runComparison({
        site: state.sources.site?.data || [],
        ilvo: state.sources.ilvo?.data || [],
        kufar: state.sources.kufar?.data || [],
        bizlida: state.sources.bizlida?.data || [],
        contracts: state.contracts || [],
        includeContractRegistry: allSourcesAreDemo
    }, store.getLastReport());
    store.saveLastReport(report);
    store.appendHistory({ checkedAt: report.checkedAt, stats: report.stats, categories: report.categories });
    return report;
}

function registerIpcHandlers(getMainWindow) {
    ipcMain.handle('app:getState', async () => buildFullState());

    ipcMain.handle('app:selectAndImportFile', async (evt, sourceKey) => {
        if (sourceKey === 'bizlida' && bizlidaUpdating) throw new Error('Дождитесь завершения обновления Bizlida.');
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

            const storedPath = store.saveRawContent('site', 'objects-source.json', jsonText);
            store.setSourceData('site', records, {
                fileName: 'objects-source.json (сайт)',
                storedPath,
                sourceUrl: SITE_JSON_URL,
                isDemo: false
            });
            return { sourceKey: 'site', count: records.length, fileName: 'objects-source.json (сайт)', sourceUrl: SITE_JSON_URL };
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

    ipcMain.handle('app:importBizlidaFromUrl', async () => {
        if (bizlidaUpdating) throw new Error('Обновление Bizlida уже выполняется.');
        bizlidaUpdating = true;
        const sendProgress = (progress) => {
            const win = getMainWindow();
            if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
                try {
                    win.webContents.send('app:bizlidaProgress', progress);
                } catch (error) {
                    // Closing a window must not interrupt a successful data transaction.
                    console.warn('Не удалось показать ход обновления Bizlida:', error.message);
                }
            }
        };
        try {
            const snapshot = await scrapeBizlida({ onProgress: sendProgress });
            sendProgress({ phase: 'saving', total: snapshot.records.length });
            const storedPath = store.saveRawContent('bizlida', 'bizlida-snapshot.json', JSON.stringify(snapshot, null, 2));
            store.setSourceData('bizlida', snapshot.records, {
                fileName: 'Bizlida (прямое обновление)',
                storedPath,
                sourceUrl: snapshot.sourceUrl,
                pages: snapshot.pages,
                completedAt: snapshot.completedAt,
                complete: true,
                isDemo: false
            });
            let checkError = null;
            try {
                sendProgress({ phase: 'checking', total: snapshot.records.length });
                runCurrentCheck();
            } catch (error) {
                checkError = `Данные Bizlida сохранены, но сверка не завершена: ${error.message}`;
            }
            return { count: snapshot.records.length, pages: snapshot.pages, checkError };
        } catch (error) {
            if (error.sourceDataSaved) {
                throw new Error(`Данные Bizlida сохранены, но предыдущий отчёт не удалось сбросить. Запустите сверку повторно. ${error.message}`);
            }
            throw new Error(`Обновление Bizlida не завершено. Последний успешный результат не заменён. ${error.message}`);
        } finally {
            bizlidaUpdating = false;
            sendProgress({ phase: 'idle' });
        }
    });

    ipcMain.handle('app:runCheck', async () => {
        if (bizlidaUpdating) throw new Error('Дождитесь завершения обновления Bizlida: после него сверка запустится автоматически.');
        return runCurrentCheck();
    });

    ipcMain.handle('app:getSettings', async () => store.settings.store);

    ipcMain.handle('app:setSettings', async (evt, patch) => {
        store.settings.set(patch);
        return store.settings.store;
    });

    ipcMain.handle('app:generateReport', async (evt, { reportType, format = REPORT_FORMAT }) => {
        const report = store.getLastReport();
        if (!report) throw new Error('Сначала запустите проверку данных.');
        if (format !== REPORT_FORMAT) throw new Error('Доступен только экспорт в XLSX.');
        const win = getMainWindow();
        const suggested = `${reportType}-${dayjs().format('YYYY-MM-DD')}.xlsx`;
        const { canceled, filePath } = await dialog.showSaveDialog(win, {
            title: REPORT_LABELS[reportType] || 'Сохранить отчёт',
            defaultPath: suggested,
            filters: [{ name: 'Excel', extensions: ['xlsx'] }]
        });
        if (canceled || !filePath) return { canceled: true };
        const result = await generateReport({ reportType, format, report, destPath: filePath });
        return { canceled: false, ...result };
    });

    ipcMain.handle('app:openPath', async (evt, targetPath) => {
        await shell.showItemInFolder(targetPath);
    });

}

module.exports = { registerIpcHandlers };
