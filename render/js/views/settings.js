import { el } from '../format.js';
import { store, loadState, resetSampleData } from '../state.js';
import { showToast } from '../components/toast.js';

export function renderSettings(container) {
    container.innerHTML = '';
    container.appendChild(el('div', { class: 'page-title' }, 'Настройки'));
    container.appendChild(el('div', { class: 'page-subtitle' }, 'Профиль, источники данных и служебные действия'));

    const s = store.settings || {};

    const profileSection = el('div', { class: 'card card-pad settings-section' }, [
        el('div', { class: 'card-title' }, 'Профиль'),
        el('div', { class: 'form-row', style: 'margin-top:14px;' }, [
            el('label', {}, 'Имя'),
            el('input', { id: 'set-username', value: s.userName || '' })
        ]),
        el('div', { class: 'form-row' }, [
            el('label', {}, 'Роль'),
            el('input', { id: 'set-userrole', value: s.userRole || '' })
        ]),
        el('button', {
            class: 'btn btn-primary',
            onclick: async () => {
                await window.electronAPI.setSettings({
                    userName: document.getElementById('set-username').value,
                    userRole: document.getElementById('set-userrole').value
                });
                await loadState();
                showToast('Профиль сохранён', 'success');
                document.dispatchEvent(new CustomEvent('app:refresh-chrome'));
            }
        }, 'Сохранить')
    ]);

    const sourceSection = el('div', { class: 'card card-pad settings-section' }, [
        el('div', { class: 'card-title' }, 'Источники данных'),
        el('div', { class: 'form-row', style: 'margin-top:14px;' }, [
            el('label', {}, 'Сайт ГермесГарант (автоматическая загрузка)'),
            el('div', { class: 'card-subtitle' }, 'https://germesgarant.by/data/objects.json')
        ]),
        el('div', { class: 'form-row', style: 'margin-top:14px;' }, [
            el('label', {}, 'Ссылка на выгрузку Kufar (ILVO)'),
            el('input', { id: 'set-kufar-url', value: s.kufarXmlUrl || '' })
        ]),
        el('div', { class: 'form-row', style: 'margin-top:14px;' }, [
            el('label', {}, 'ILVO API'),
            el('div', { class: 'card-subtitle' }, 'Ключ хранится в Secrets проекта и не показывается в приложении. Синхронизация выполняется кнопкой в окне «Загрузить данные».')
        ]),
        el('button', {
            class: 'btn btn-secondary',
            onclick: async () => {
                await window.electronAPI.setSettings({ kufarXmlUrl: document.getElementById('set-kufar-url').value });
                await loadState();
                showToast('Ссылка сохранена', 'success');
            }
        }, 'Сохранить ссылку')
    ]);

    const storageSection = el('div', { class: 'card card-pad settings-section' }, [
        el('div', { class: 'card-title' }, 'Хранение загрузок'),
        el('p', { class: 'card-subtitle', style: 'margin-top:8px;' }, 'Для каждого источника сохраняются 5 последних исходных файлов. Более старые файлы удаляются автоматически после нового импорта. Текущие данные, последний отчёт и история проверок не удаляются.')
    ]);

    const dataSection = el('div', { class: 'card card-pad settings-section' }, [
        el('div', { class: 'card-title' }, 'Демо-данные'),
        el('p', { class: 'card-subtitle', style: 'margin: 8px 0 14px;' }, 'Скачайте примеры файлов в ожидаемом формате или восстановите демонстрационный набор данных.'),
        el('div', { class: 'settings-actions' }, [
            el('button', {
                class: 'btn btn-secondary',
                onclick: async () => {
                    const res = await window.electronAPI.exportSampleFiles();
                    if (!res.canceled) showToast(`Примеры сохранены в ${res.dir}`, 'success');
                }
            }, 'Скачать примеры файлов'),
            el('button', {
                class: 'btn btn-secondary',
                onclick: async () => {
                    await resetSampleData();
                    showToast('Демо-данные восстановлены', 'success');
                    document.dispatchEvent(new CustomEvent('app:refresh-view'));
                }
            }, 'Восстановить демо-данные')
        ])
    ]);

    const aboutSection = el('div', { class: 'card card-pad settings-section' }, [
        el('div', { class: 'card-title' }, 'О приложении'),
        el('p', { class: 'card-subtitle', style: 'margin-top:8px;' }, 'GermesControl — контроль объектов, договоров и рекламных площадок АН «ГермесГарант».'),
        el('p', { class: 'card-subtitle' }, 'Версия 1.0.0')
    ]);

    container.appendChild(profileSection);
    container.appendChild(sourceSection);
    container.appendChild(storageSection);
    container.appendChild(dataSection);
    container.appendChild(aboutSection);
}
