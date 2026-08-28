'use strict';

const fs = require('fs-extra');
const path = require('path');
const dayjs = require('dayjs');
const Store = require('electron-store');
const { buildSampleDataset } = require('./sampleData');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const REPORT_FILE = path.join(DATA_DIR, 'lastReport.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const HISTORY_LIMIT = 200;
const UPLOAD_RETENTION_LIMIT = 5;
const SOURCE_KEYS = ['site', 'ilvo', 'kufar'];

const settings = new Store({
    name: 'settings',
    defaults: {
        userName: 'Ольга Турко',
        userRole: 'Администратор',
        kufarXmlUrl: 'https://ilvo.pro/posting/Ea59071BdDe82DC8B2aCFBaa88AB80cf.xml',
        theme: 'light',
        autoRunCheckAfterImport: false
    }
});

function ensureDirs() {
    fs.ensureDirSync(DATA_DIR);
    fs.ensureDirSync(UPLOADS_DIR);
    for (const src of SOURCE_KEYS) {
        fs.ensureDirSync(path.join(UPLOADS_DIR, src));
    }
}

function pruneUploadedFiles(sourceKey, protectedPaths = []) {
    if (!SOURCE_KEYS.includes(sourceKey)) return;

    const sourceDir = path.join(UPLOADS_DIR, sourceKey);
    const protectedFiles = new Set(protectedPaths.filter(Boolean).map((filePath) => path.resolve(filePath)));
    const files = fs.readdirSync(sourceDir, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => {
            const filePath = path.join(sourceDir, entry.name);
            try {
                return { filePath, modifiedAt: fs.statSync(filePath).mtimeMs };
            } catch (e) {
                return null;
            }
        })
        .filter(Boolean)
        .sort((a, b) => b.modifiedAt - a.modifiedAt || b.filePath.localeCompare(a.filePath));

    for (const file of files.slice(UPLOAD_RETENTION_LIMIT)) {
        if (!protectedFiles.has(path.resolve(file.filePath))) {
            fs.removeSync(file.filePath);
        }
    }
}

function pruneAllUploadedFiles(state) {
    for (const sourceKey of SOURCE_KEYS) {
        const storedPath = state?.sources?.[sourceKey]?.meta?.storedPath;
        pruneUploadedFiles(sourceKey, [storedPath]);
    }
}

function defaultMeta() {
    return { fileName: null, importedAt: null, count: 0 };
}

function seedInitialState() {
    const sample = buildSampleDataset();
    const now = new Date().toISOString();
    const state = {
        sources: {
            site: { data: sample.site, meta: { fileName: 'demo: site.json', importedAt: now, count: sample.site.length, isDemo: true } },
            ilvo: { data: sample.ilvo, meta: { fileName: 'demo: ilvo.xlsx', importedAt: now, count: sample.ilvo.length, isDemo: true } },
            kufar: { data: sample.kufar, meta: { fileName: 'demo: kufar.xml', importedAt: now, count: sample.kufar.length, isDemo: true } }
        },
        contracts: sample.contracts
    };
    fs.writeJsonSync(STATE_FILE, state, { spaces: 2 });
    return state;
}

function getState() {
    ensureDirs();
    if (!fs.existsSync(STATE_FILE)) {
        const state = seedInitialState();
        pruneAllUploadedFiles(state);
        return state;
    }
    try {
        const state = fs.readJsonSync(STATE_FILE);
        pruneAllUploadedFiles(state);
        return state;
    } catch (e) {
        const state = seedInitialState();
        pruneAllUploadedFiles(state);
        return state;
    }
}

function saveState(state) {
    ensureDirs();
    fs.writeJsonSync(STATE_FILE, state, { spaces: 2 });
}

function setSourceData(sourceKey, records, meta) {
    const state = getState();
    const isRealImport = meta && meta.isDemo === false;
    if (isRealImport) {
        // Демо-источники нельзя смешивать с первым реальным импортом:
        // иначе старые синтетические договоры и объекты остаются в отчёте.
        for (const otherSource of ['site', 'ilvo', 'kufar']) {
            if (otherSource !== sourceKey && state.sources[otherSource]?.meta?.isDemo === true) {
                state.sources[otherSource] = { data: [], meta: defaultMeta() };
            }
        }
        state.contracts = [];
        fs.removeSync(REPORT_FILE);
    }
    state.sources[sourceKey] = { data: records, meta: { ...defaultMeta(), ...meta, count: records.length, importedAt: new Date().toISOString() } };
    saveState(state);
    return state;
}

function setContracts(contracts) {
    const state = getState();
    state.contracts = contracts;
    saveState(state);
    return state;
}

function copyUploadedFile(sourceKey, originalPath) {
    ensureDirs();
    const ts = dayjs().format('YYYYMMDD-HHmmss');
    const destName = `${ts}-${path.basename(originalPath)}`;
    const dest = path.join(UPLOADS_DIR, sourceKey, destName);
    fs.copySync(originalPath, dest);
    pruneUploadedFiles(sourceKey, [dest]);
    return dest;
}

function saveRawContent(sourceKey, fileNameHint, content) {
    ensureDirs();
    const ts = dayjs().format('YYYYMMDD-HHmmss');
    const dest = path.join(UPLOADS_DIR, sourceKey, `${ts}-${fileNameHint}`);
    fs.writeFileSync(dest, content);
    pruneUploadedFiles(sourceKey, [dest]);
    return dest;
}

function getLastReport() {
    if (!fs.existsSync(REPORT_FILE)) return null;
    try {
        return fs.readJsonSync(REPORT_FILE);
    } catch (e) {
        return null;
    }
}

function saveLastReport(report) {
    ensureDirs();
    fs.writeJsonSync(REPORT_FILE, report, { spaces: 2 });
}

function getHistory() {
    ensureDirs();
    if (!fs.existsSync(HISTORY_FILE)) return [];
    try {
        return fs.readJsonSync(HISTORY_FILE);
    } catch (e) {
        return [];
    }
}

function appendHistory(entry) {
    const history = getHistory();
    history.push(entry);
    while (history.length > HISTORY_LIMIT) history.shift();
    fs.writeJsonSync(HISTORY_FILE, history, { spaces: 2 });
    return history;
}

function resetToSampleData() {
    ensureDirs();
    fs.removeSync(STATE_FILE);
    fs.removeSync(REPORT_FILE);
    fs.removeSync(HISTORY_FILE);
    return seedInitialState();
}

module.exports = {
    DATA_DIR,
    settings,
    getState,
    saveState,
    setSourceData,
    setContracts,
    copyUploadedFile,
    saveRawContent,
    getLastReport,
    saveLastReport,
    getHistory,
    appendHistory,
    resetToSampleData
};
