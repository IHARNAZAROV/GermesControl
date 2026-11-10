// Дата договора — доступный общий ориентир новизны, не дата импорта.
export function createObjectDateOrder(contracts = []) {
    const dates = new Map();
    for (const contract of contracts) {
        const text = String(contract.date || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) continue;
        const timestamp = Date.parse(`${text}T00:00:00Z`);
        if (Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === text) {
            if (!dates.has(contract.objectId)) dates.set(contract.objectId, timestamp);
        }
    }
    return (a, b, direction) => {
        const da = dates.get(a.id);
        const db = dates.get(b.id);
        // Неизвестная дата всегда в конце, независимо от направления.
        if (da === undefined && db !== undefined) return 1;
        if (db === undefined && da !== undefined) return -1;
        if (da !== undefined && da !== db) return (da - db) * direction;
        return ((Number(a.objectNumber) || 0) - (Number(b.objectNumber) || 0)) * direction;
    };
}
