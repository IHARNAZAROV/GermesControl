const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const loadOrder = () => import(`data:text/javascript;base64,${Buffer.from(
    fs.readFileSync('render/js/objectOrder.js', 'utf8')
).toString('base64')}`);

test('Порядок объектов: даты договоров, одинаковые даты, неизвестные даты', async () => {
    const { createObjectDateOrder } = await loadOrder();
    const rows = [
        { id: 'old', objectNumber: 101 },
        { id: 'unknown', objectNumber: 999 },
        { id: 'new', objectNumber: 102 },
        { id: 'same', objectNumber: 103 },
        { id: 'invalid', objectNumber: 104 }
    ];
    const compare = createObjectDateOrder([
        { objectId: 'old', date: '2025-12-31' },
        { objectId: 'new', date: '2026-01-01' },
        { objectId: 'same', date: '2026-01-01' },
        { objectId: 'invalid', date: '2026-02-30' }
    ]);
    const order = (direction) => rows.slice().sort((a, b) => compare(a, b, direction)).map((o) => o.id);
    assert.deepEqual(order(-1), ['same', 'new', 'old', 'unknown', 'invalid']);
    assert.deepEqual(order(1), ['old', 'new', 'same', 'invalid', 'unknown']);
    assert.equal(rows[0].id, 'old', 'Исходный отчёт не меняется');
});

test('Старый отчёт без дат сортируется по номерам объектов', async () => {
    const { createObjectDateOrder } = await loadOrder();
    const rows = [{ objectNumber: 1 }, { objectNumber: 3 }, { objectNumber: 2 }];
    assert.deepEqual(rows.sort((a, b) => createObjectDateOrder()(a, b, -1))
        .map((row) => row.objectNumber), [3, 2, 1]);
});
