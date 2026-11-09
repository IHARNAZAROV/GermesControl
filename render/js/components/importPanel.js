import { el, formatDateTime, sourceLogo } from '../format.js';
import { store, importSource, importSiteFromUrl, importKufarFromUrl, importBizlidaFromUrl, runCheck } from '../state.js';
import { openModal, closeModal } from './modal.js';
import { showToast } from './toast.js';

const SOURCE_META = {
    site: { label: 'Сайт ГермесГарант', format: 'JSON', hint: 'Автоматическая выгрузка с сайта' },
    ilvo: { label: 'ILVO CRM', format: 'XLSX', hint: 'Ручная выгрузка объектов из ILVO' },
    kufar: { label: 'Kufar', format: 'XML', hint: 'Автоматическая выгрузка объявлений из ILVO' },
    bizlida: { label: 'Bizlida', format: 'Сайт / XLSX', hint: 'Прямое обновление объявлений агентства' }
};

async function afterImport(onChanged) {
    if (onChanged) onChanged();
    if (store.settings?.autoRunCheckAfterImport) {
        try {
            await runCheck();
            showToast('Автопроверка завершена', 'success');
        } catch (err) {
            showToast(err.message || 'Не удалось выполнить автопроверку', 'error');
        }
    }
}

function sourceCard(key, onChanged) {
    const meta = SOURCE_META[key];
    const src = store.sources[key] || { data: [], meta: {} };
    const info = src.meta || {};

    const card = el('div', { class: 'card import-card' });
    const status = info.importedAt
        ? el('span', { class: `badge ${info.isDemo ? 'badge-warning' : 'badge-success'}` }, info.isDemo ? 'Демо-данные' : '\u2713 Загружено')
        : el('span', { class: 'badge badge-danger' }, 'Нет данных');

    const title = key === 'kufar' ? meta.label : `${meta.label} (${meta.format})`;
    card.appendChild(el('div', { class: `imp-title source-title source-${key}` }, [
        el('span', { class: 'source-icon' }, [sourceLogo(key)]),
        el('span', {}, title)
    ]));
    card.appendChild(el('div', { class: 'imp-file' }, info.fileName || 'Файл не загружен'));
    card.appendChild(el('div', { class: 'imp-count' }, `${info.count || 0} объектов`));
    card.appendChild(status);
    card.appendChild(el('div', { class: 'text-secondary', style: 'font-size:11.5px;' }, info.importedAt ? formatDateTime(info.importedAt) : ''));

    const actions = el('div', { class: 'import-actions' });
    if (key === 'bizlida') {
        actions.appendChild(el('button', {
            class: 'btn btn-primary btn-sm',
            disabled: store.bizlidaUpdating,
            onclick: async () => {
                const pending = importBizlidaFromUrl(onChanged);
                onChanged();
                try {
                    const res = await pending;
                    showToast(`Bizlida: ${res.count} объектов, ${res.pages} стр. ${res.checkError ? '' : 'Сверка завершена.'}`, 'success');
                    if (res.checkError) showToast(res.checkError, 'error');
                } catch (err) {
                    showToast(err.message || 'Не удалось обновить Bizlida. Предыдущие данные сохранены.', 'error');
                } finally {
                    onChanged();
                }
            }
        }, store.bizlidaUpdating ? 'Обновление…' : 'Обновить Bizlida'));
        const progress = store.bizlidaProgress;
        const progressText = !store.bizlidaUpdating
            ? 'Последняя успешная загрузка указана выше. При ошибке данные не заменяются.'
            : progress?.phase === 'listings' ? `Карточки: ${progress.completed} из ${progress.total}`
                : progress?.phase === 'checking' ? 'Данные сохранены. Выполняется сверка…'
                    : progress?.phase === 'saving' || progress?.phase === 'complete' ? 'Сохранение полного результата…'
                        : `Обход страниц: ${progress?.page || 1}${progress?.total > 1 ? ` из ${progress.total}` : ''}`;
        card.appendChild(el('div', {
            class: 'text-secondary', role: 'status', 'aria-live': 'polite',
            style: 'font-size:12px;margin-top:8px;'
        }, progressText));
    }
    if (key === 'site') {
        actions.appendChild(el('button', {
            class: 'btn btn-primary btn-sm',
            onclick: async () => {
                try {
                    showToast('Обновление данных с сайта...');
                    const res = await importSiteFromUrl();
                    showToast(`Сайт ГермесГарант: загружено ${res.count} объектов`, 'success');
                    await afterImport(onChanged);
                } catch (err) {
                    showToast(err.message || 'Не удалось загрузить данные с сайта', 'error');
                }
            }
        }, 'Обновить с сайта'));
        actions.appendChild(el('button', {
            class: 'btn btn-ghost btn-sm',
            onclick: async () => {
                try {
                    const res = await importSource(key);
                    if (!res.canceled) {
                        showToast(`${meta.label}: загружено ${res.count} объектов`, 'success');
                        await afterImport(onChanged);
                    }
                } catch (err) {
                    showToast(err.message || 'Ошибка загрузки файла', 'error');
                }
            }
        }, 'Из файла'));
    } else if (key === 'ilvo' || key === 'bizlida') {
        actions.appendChild(el('button', {
            class: key === 'bizlida' ? 'btn btn-ghost btn-sm' : 'btn btn-primary btn-sm',
            disabled: key === 'bizlida' && store.bizlidaUpdating,
            onclick: async () => {
                try {
                    const res = await importSource(key);
                    if (!res.canceled) {
                        showToast(`${meta.label}: загружено ${res.count} объектов`, 'success');
                        await afterImport(onChanged);
                    }
                } catch (err) {
                    showToast(err.message || 'Ошибка загрузки файла', 'error');
                }
            }
        }, key === 'bizlida' ? 'Из XLSX' : `Загрузить ${meta.format}`));
    } else {
        actions.appendChild(el('button', {
            class: 'btn btn-secondary btn-sm',
            onclick: async () => {
                try {
                    const res = await importSource(key);
                    if (!res.canceled) {
                        showToast(`${meta.label}: загружено ${res.count} объектов`, 'success');
                        await afterImport(onChanged);
                    }
                } catch (err) {
                    showToast(err.message || 'Ошибка загрузки файла', 'error');
                }
            }
        }, `Загрузить ${meta.format}`));
    }

    if (key === 'kufar') {
        actions.appendChild(el('button', {
            class: 'btn btn-ghost btn-sm',
            onclick: async () => {
                try {
                    showToast('Загрузка XML по ссылке...');
                    const res = await importKufarFromUrl(store.settings.kufarXmlUrl);
                    showToast(`Kufar: загружено ${res.count} объектов`, 'success');
                    await afterImport(onChanged);
                } catch (err) {
                    showToast(err.message || 'Не удалось загрузить XML по ссылке', 'error');
                }
            }
        }, 'По ссылке'));
    }

    card.appendChild(actions);
    return card;
}

export function openImportModal() {
    const grid = el('div', { class: 'import-grid', id: 'import-source-grid' });
    function draw() {
        // An update may continue after closing/reopening the modal.
        const target = document.getElementById('import-source-grid') || grid;
        target.innerHTML = '';
        ['site', 'ilvo', 'kufar', 'bizlida'].forEach((key) => target.appendChild(sourceCard(key, draw)));
    }
    draw();

    openModal({
        title: 'Загрузить данные',
        kicker: 'Источники данных',
        width: '720px',
        body: [
            el('p', { class: 'card-subtitle', style: 'margin-bottom:16px;' }, 'Bizlida: кнопка «Обновить Bizlida» обходит все страницы раздела и загружает полные карточки ГермесГаранта. После успешной загрузки сверка запускается автоматически. Это может занять несколько минут. XLSX остаётся запасным способом. ILVO — из XLSX, Kufar — из XML.'),
            grid
        ],
        footer: [el('button', { class: 'btn btn-secondary', onclick: closeModal }, 'Закрыть')]
    });
}
