const listeners = new Set();
const REPORT_MATCHING_VERSION = 4;

export const store = {
    sources: { site: { data: [], meta: {} }, ilvo: { data: [], meta: {} }, kufar: { data: [], meta: {} } },
    contracts: [],
    report: null,
    history: [],
    settings: {},
    checking: false
};

export function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

function notify() {
    for (const fn of listeners) fn(store);
}

export async function loadState() {
    let state = await window.electronAPI.getState();
    const hasSourceData = Object.values(state.sources || {}).some((source) => (
        source && Array.isArray(source.data) && source.data.length > 0
    ));
    // Отчёты до версии 2 содержат старые названия, форматы договоров
    // и технические идентификаторы. Пересчитываем их один раз при открытии
    // приложения, чтобы пользователь не видел устаревшую сохранённую таблицу.
    if (state.report && state.report.matchingVersion !== REPORT_MATCHING_VERSION && hasSourceData) {
        await window.electronAPI.runCheck();
        state = await window.electronAPI.getState();
    }
    Object.assign(store, state);
    notify();
    return store;
}

export async function importSource(sourceKey) {
    const result = await window.electronAPI.selectAndImportFile(sourceKey);
    if (!result.canceled) {
        await loadState();
    }
    return result;
}

export async function importKufarFromUrl(url) {
    const result = await window.electronAPI.importKufarFromUrl(url);
    await loadState();
    return result;
}

export async function runCheck() {
    store.checking = true;
    notify();
    try {
        const report = await window.electronAPI.runCheck();
        await loadState();
        return report;
    } finally {
        store.checking = false;
        notify();
    }
}

export async function resetSampleData() {
    await window.electronAPI.resetSampleData();
    await loadState();
}
