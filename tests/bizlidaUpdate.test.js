'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function setup(scrape, { saveError = false, checkError = false } = {}) {
    const handlers = {};
    const oldRecords = [{ id: 'old' }];
    let records = oldRecords;
    const calls = [];
    const progress = [];
    const store = {
        settings: { store: {} },
        getState: () => ({ sources: { bizlida: { data: records } } }),
        getLastReport: () => ({ previous: true }),
        getHistory: () => [],
        saveRawContent: () => { calls.push('raw'); return 'snapshot.json'; },
        setSourceData: (_key, data, meta) => {
            calls.push('source');
            if (saveError) throw new Error('Disk full');
            assert.equal(meta.complete, true);
            assert.equal(meta.isDemo, false);
            records = data;
        },
        saveLastReport: () => { calls.push('report'); },
        appendHistory: () => { calls.push('history'); }
    };
    const modulePath = require.resolve('../src/main/ipcHandlers');
    delete require.cache[modulePath];
    const original = Module._load;
    Module._load = function (request, parent, ...rest) {
        if (parent?.filename === modulePath) {
            if (request === 'electron') return { ipcMain: { handle: (name, fn) => { handlers[name] = fn; } } };
            if (request === './dataStore') return store;
            if (request === './bizlidaScraper') return { scrapeBizlida: scrape };
            if (request === './reports') return { REPORT_LABELS: {} };
            if (request === './compare') return { runComparison: (input) => {
                calls.push('compare');
                assert.deepEqual(input.bizlida, records);
                if (checkError) throw new Error('Comparison failed');
                return { checkedAt: 'now', stats: {}, categories: {} };
            } };
        }
        return original.call(this, request, parent, ...rest);
    };
    try {
        require(modulePath).registerIpcHandlers(() => ({
            isDestroyed: () => false,
            webContents: { isDestroyed: () => false, send: (_channel, payload) => progress.push(payload) }
        }));
    } finally {
        Module._load = original;
        delete require.cache[modulePath];
    }
    return { handlers, calls, progress, oldRecords, currentRecords: () => records };
}

const snapshot = {
    records: [{ id: 'new' }], pages: 2,
    sourceUrl: 'https://bizlida.by/baraholka/cat/37', completedAt: 'now'
};

test('successful full update saves snapshot before replacing data and running check', async () => {
    const env = setup(async () => snapshot);
    const result = await env.handlers['app:importBizlidaFromUrl']();
    assert.deepEqual(env.calls, ['raw', 'source', 'compare', 'report', 'history']);
    assert.deepEqual(env.currentRecords(), snapshot.records);
    assert.deepEqual(result, { count: 1, pages: 2, checkError: null });
    assert.equal(env.progress.at(-1).phase, 'idle');
});

test('failed download preserves previous records and does not save or check', async () => {
    const env = setup(async () => { throw new Error('Page 2 unavailable'); });
    await assert.rejects(env.handlers['app:importBizlidaFromUrl'](), /Последний успешный результат не заменён/u);
    assert.strictEqual(env.currentRecords(), env.oldRecords);
    assert.deepEqual(env.calls, []);
    assert.equal((await env.handlers['app:getState']()).bizlidaUpdating, false);
});

test('failed state save retains previous data and does not run comparison', async () => {
    const env = setup(async () => snapshot, { saveError: true });
    await assert.rejects(env.handlers['app:importBizlidaFromUrl'](), /Disk full/u);
    assert.strictEqual(env.currentRecords(), env.oldRecords);
    assert.deepEqual(env.calls, ['raw', 'source']);
});

test('a check failure is distinguished from a failed import', async () => {
    const env = setup(async () => snapshot, { checkError: true });
    const result = await env.handlers['app:importBizlidaFromUrl']();
    assert.match(result.checkError, /Данные Bizlida сохранены/u);
    assert.deepEqual(env.currentRecords(), snapshot.records);
});

test('blocks duplicate updates, manual Bizlida imports and checks while scraping; releases lock', async () => {
    let release;
    const env = setup(() => new Promise((resolve) => { release = resolve; }));
    const first = env.handlers['app:importBizlidaFromUrl']();
    assert.equal((await env.handlers['app:getState']()).bizlidaUpdating, true);
    await assert.rejects(env.handlers['app:importBizlidaFromUrl'](), /уже выполняется/u);
    await assert.rejects(env.handlers['app:selectAndImportFile']({}, 'bizlida'), /Дождитесь/u);
    await assert.rejects(env.handlers['app:runCheck'](), /Дождитесь/u);
    release(snapshot);
    await first;
    assert.equal((await env.handlers['app:getState']()).bizlidaUpdating, false);
});
