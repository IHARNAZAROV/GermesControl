import { el, formatDateTime, sourceLogo } from '../format.js';
import { store, importSource, importSiteFromUrl, importKufarFromUrl } from '../state.js';
import { openModal, closeModal } from './modal.js';
import { showToast } from './toast.js';

const SOURCE_META = {
    site: { label: 'Сайт ГермесГарант', format: 'JSON', hint: 'Автоматическая выгрузка с сайта' },
    ilvo: { label: 'ILVO CRM', format: 'XLSX', hint: 'Ручная выгрузка объектов из ILVO' },
    kufar: { label: 'Kufar', format: 'XML', hint: 'Автоматическая выгрузка объявлений из ILVO' }
};

function sourceCard(key, onChanged) {
    const meta = SOURCE_META[key];
    const src = store.sources[key] || { data: [], meta: {} };
    const info = src.meta || {};

    const card = el('div', { class: 'card import-card' });
    const status = info.count
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
    if (key === 'site') {
        actions.appendChild(el('button', {
            class: 'btn btn-primary btn-sm',
            onclick: async () => {
                try {
                    showToast('Обновление данных с сайта...');
                    const res = await importSiteFromUrl();
                    showToast(`Сайт ГермесГарант: загружено ${res.count} объектов`, 'success');
                    onChanged();
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
                        onChanged();
                    }
                } catch (err) {
                    showToast(err.message || 'Ошибка загрузки файла', 'error');
                }
            }
        }, 'Из файла'));
    } else {
        actions.appendChild(el('button', {
            class: 'btn btn-secondary btn-sm',
            onclick: async () => {
                try {
                    const res = await importSource(key);
                    if (!res.canceled) {
                        showToast(`${meta.label}: загружено ${res.count} объектов`, 'success');
                        onChanged();
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
                    onChanged();
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
    const grid = el('div', { class: 'import-grid' });
    function draw() {
        grid.innerHTML = '';
        ['site', 'ilvo', 'kufar'].forEach((key) => grid.appendChild(sourceCard(key, draw)));
    }
    draw();

    openModal({
        title: 'Загрузить данные',
        width: '720px',
        body: [
            el('p', { class: 'card-subtitle', style: 'margin-bottom:16px;' }, 'Сайт ГермесГарант обновляется по ссылке автоматически, остальные источники загружаются вручную. После обновления источников запустите проверку, чтобы обновить сводку.'),
            grid
        ],
        footer: [el('button', { class: 'btn btn-secondary', onclick: closeModal }, 'Закрыть')]
    });
}
