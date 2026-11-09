'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs-extra');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');

function loadStore(dir, fsImpl = fs) {
    const modulePath = require.resolve('../src/main/dataStore');
    delete require.cache[modulePath];
    const original = Module._load;
    Module._load = function (request, parent, ...rest) {
        if (parent?.filename === modulePath) {
            if (request === 'electron') return { app: { isPackaged: true, getPath: () => dir } };
            if (request === 'electron-store') return class { constructor() { this.store = {}; } };
            if (request === 'fs-extra') return fsImpl;
        }
        return original.call(this, request, parent, ...rest);
    };
    try {
        return require(modulePath);
    } finally {
        Module._load = original;
        delete require.cache[modulePath];
    }
}

function fixture(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bizlida-state-'));
    t.after(() => fs.removeSync(dir));
    const data = path.join(dir, 'data');
    fs.ensureDirSync(data);
    const oldState = {
        sources: {
            site: { data: [{ id: 'site' }], meta: { isDemo: false } },
            bizlida: { data: [{ id: 'previous' }], meta: { importedAt: '2026-11-01', isDemo: false } }
        },
        contracts: []
    };
    fs.writeJsonSync(path.join(data, 'state.json'), oldState);
    fs.writeJsonSync(path.join(data, 'lastReport.json'), { previous: true });
    return { dir, data, oldState };
}

test('disk write failure retains the successful state both in memory and on disk, plus old report', (t) => {
    const { dir, data, oldState } = fixture(t);
    const impl = Object.create(fs);
    impl.writeJsonSync = (file, ...args) => {
        if (String(file).endsWith('state.json.tmp')) throw new Error('Disk full');
        return fs.writeJsonSync(file, ...args);
    };
    const store = loadStore(dir, impl);
    store.getState();
    assert.throws(() => store.setSourceData('bizlida', [{ id: 'new' }], { isDemo: false }), /Disk full/u);
    assert.deepEqual(store.getState().sources.bizlida, oldState.sources.bizlida);
    assert.deepEqual(fs.readJsonSync(path.join(data, 'state.json')), oldState);
    assert.deepEqual(store.getLastReport(), { previous: true });
    assert.equal(fs.existsSync(path.join(data, 'state.json.tmp')), false);
});

test('successful save is durable across a new store instance and retains other real sources', (t) => {
    const { dir } = fixture(t);
    const store = loadStore(dir);
    store.setSourceData('bizlida', [{ id: 'new' }], { isDemo: false, complete: true, pages: 4 });
    const reloaded = loadStore(dir).getState();
    assert.deepEqual(reloaded.sources.bizlida.data, [{ id: 'new' }]);
    assert.equal(reloaded.sources.bizlida.meta.complete, true);
    assert.equal(reloaded.sources.bizlida.meta.pages, 4);
    assert.ok(reloaded.sources.bizlida.meta.importedAt);
    assert.equal(reloaded.sources.site.data[0].id, 'site');
});

test('raw snapshot retention protects the previous successful snapshot if a later import fails', (t) => {
    const { dir, data } = fixture(t);
    const store = loadStore(dir);
    const uploadDir = path.join(data, 'uploads', 'bizlida');
    fs.ensureDirSync(uploadDir);
    const previous = path.join(uploadDir, 'old-success.json');
    fs.writeFileSync(previous, '{"successful":true}');
    fs.utimesSync(previous, new Date(0), new Date(0));
    store.setSourceData('bizlida', [{ id: 'old' }], { isDemo: false, storedPath: previous });
    for (let i = 0; i < 7; i++) fs.writeFileSync(path.join(uploadDir, `attempt-${i}.json`), '{}');
    store.saveRawContent('bizlida', 'new-attempt.json', '{}');
    assert.equal(fs.existsSync(previous), true);
    assert.equal(store.getState().sources.bizlida.data[0].id, 'old');
});
