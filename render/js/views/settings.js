import { el, icon, sourceLogo } from '../format.js';
import { store, loadState } from '../state.js';
import { showToast } from '../components/toast.js';

const APP_VERSION = '1.0.0';
const APP_AUTHOR = 'INazarov';
const SITE_JSON_URL = 'https://germesgarant.by/data/objects.json';

const APP_DESCRIPTION = [
    'GermesControl — desktop-система контроля качества данных для агентства недвижимости.',
    'Приложение автоматически сверяет объекты, договоры и рекламные выгрузки между тремя источниками: сайтом компании, ILVO CRM и площадкой Kufar.',
    'Система находит расхождения в ценах, площадях, адресах и номерах договоров, показывает объекты, отсутствующие на площадках, и формирует наглядные отчёты только в XLSX.'
].join(' ');

function createToggle(checked, onChange) {
    const input = el('input', {
        type: 'checkbox',
        class: 'settings-toggle-input',
        ...(checked ? { checked: true } : {})
    });
    input.addEventListener('change', () => onChange(input.checked));

    const track = el('span', { class: 'settings-toggle-track' }, [
        el('span', { class: 'settings-toggle-thumb' })
    ]);

    const wrap = el('label', { class: 'settings-toggle' }, [input, track]);
    return { wrap, input };
}

function sectionCard({ iconName, title, subtitle, children, className = '' }) {
    return el('section', { class: `settings-card card card-pad ${className}`.trim() }, [
        el('div', { class: 'settings-card-head' }, [
            el('div', { class: 'settings-card-icon' }, [icon(iconName, 18)]),
            el('div', { class: 'settings-card-titles' }, [
                el('h3', { class: 'settings-card-title' }, title),
                subtitle ? el('p', { class: 'settings-card-subtitle' }, subtitle) : null
            ])
        ]),
        el('div', { class: 'settings-card-body' }, children)
    ]);
}

function settingRow({ title, description, control, className = '' }) {
    return el('div', { class: `settings-row ${className}`.trim() }, [
        el('div', { class: 'settings-row-copy' }, [
            el('div', { class: 'settings-row-title' }, title),
            description ? el('div', { class: 'settings-row-desc' }, description) : null
        ]),
        el('div', { class: 'settings-row-control' }, control)
    ]);
}

function sourceEndpointRow(sourceKey, label, endpoint, note) {
    const meta = store.sources?.[sourceKey]?.meta || {};
    const isLoaded = (meta.count || 0) > 0;
    const freshness = meta.importedAt
        ? new Date(meta.importedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
        : 'не загружался';

    return el('div', { class: `settings-source-row source-${sourceKey}` }, [
        el('div', { class: 'settings-source-mark' }, [sourceLogo(sourceKey)]),
        el('div', { class: 'settings-source-copy' }, [
            el('div', { class: 'settings-source-label' }, label),
            el('div', { class: 'settings-source-endpoint' }, endpoint),
            note ? el('div', { class: 'settings-source-note' }, note) : null
        ]),
        el('div', { class: 'settings-source-status' }, [
            el('span', { class: `badge ${isLoaded ? 'badge-success' : 'badge-neutral'}` }, isLoaded ? `${meta.count} объектов` : 'Нет данных'),
            el('span', { class: 'settings-source-time' }, freshness)
        ])
    ]);
}

export function renderSettings(container) {
    container.innerHTML = '';
    const s = store.settings || {};

    const header = el('header', { class: 'settings-page-header' }, [
        el('p', { class: 'settings-eyebrow' }, 'Конфигурация'),
        el('h2', { class: 'page-title' }, 'Настройки'),
        el('p', { class: 'page-subtitle' }, 'Профиль, подключение источников, автоматизация и служебные действия')
    ]);

    const hero = el('section', { class: 'settings-hero card' }, [
        el('div', { class: 'settings-hero-glow' }),
        el('div', { class: 'settings-hero-inner' }, [
            el('div', { class: 'settings-hero-main' }, [
                el('div', { class: 'settings-hero-badges' }, [
                    el('span', { class: 'settings-pill' }, `v${APP_VERSION}`),
                    el('span', { class: 'settings-pill settings-pill-accent' }, 'Desktop · Electron')
                ]),
                el('h3', { class: 'settings-hero-title' }, 'GermesControl'),
                el('p', { class: 'settings-hero-desc' }, APP_DESCRIPTION),
                el('div', { class: 'settings-hero-tags' }, [
                    'Сверка площадок',
                    'Контроль договоров',
                    'Отчёты',
                    'ILVO API',
                    'Kufar XML'
                ].map((tag) => el('span', { class: 'settings-tag' }, tag)))
            ]),
            el('aside', { class: 'settings-hero-meta' }, [
                el('div', { class: 'settings-meta-item' }, [
                    el('span', { class: 'settings-meta-label' }, 'Автор'),
                    el('span', { class: 'settings-meta-value' }, APP_AUTHOR)
                ]),
                el('div', { class: 'settings-meta-item' }, [
                    el('span', { class: 'settings-meta-label' }, 'Лицензия'),
                    el('span', { class: 'settings-meta-value' }, 'MIT')
                ]),
                el('div', { class: 'settings-meta-item' }, [
                    el('span', { class: 'settings-meta-label' }, 'Стек'),
                    el('span', { class: 'settings-meta-value' }, 'Electron · Vanilla JS')
                ]),
                el('div', { class: 'settings-meta-item' }, [
                    el('span', { class: 'settings-meta-label' }, 'Хранение'),
                    el('span', { class: 'settings-meta-value' }, 'JSON / XLSX / XML')
                ])
            ])
        ])
    ]);

    const profileCard = sectionCard({
        iconName: 'shield',
        title: 'Профиль',
        subtitle: 'Отображается в верхней панели приложения',
        children: [
            el('div', { class: 'settings-form-grid' }, [
                el('div', { class: 'form-row' }, [
                    el('label', { for: 'set-username' }, 'Имя'),
                    el('input', { id: 'set-username', value: s.userName || '', placeholder: 'Ваше имя' })
                ]),
                el('div', { class: 'form-row' }, [
                    el('label', { for: 'set-userrole' }, 'Роль'),
                    el('input', { id: 'set-userrole', value: s.userRole || '', placeholder: 'Должность' })
                ])
            ]),
            el('button', {
                class: 'btn btn-primary',
                onclick: async () => {
                    await window.electronAPI.setSettings({
                        userName: document.getElementById('set-username').value.trim(),
                        userRole: document.getElementById('set-userrole').value.trim()
                    });
                    await loadState();
                    showToast('Профиль сохранён', 'success');
                    document.dispatchEvent(new CustomEvent('app:refresh-chrome'));
                }
            }, [icon('check', 15), 'Сохранить профиль'])
        ]
    });

    const autoToggle = createToggle(!!s.autoRunCheckAfterImport, async (checked) => {
        await window.electronAPI.setSettings({ autoRunCheckAfterImport: checked });
        await loadState();
        showToast(checked ? 'Автопроверка включена' : 'Автопроверка отключена', 'success');
    });

    const automationCard = sectionCard({
        iconName: 'play',
        title: 'Автоматизация',
        subtitle: 'Поведение после загрузки данных',
        children: [
            settingRow({
                title: 'Проверка после импорта',
                description: 'Автоматически запускать сверку, когда обновлён хотя бы один источник',
                control: autoToggle.wrap
            })
        ]
    });

    const sourcesCard = sectionCard({
        iconName: 'database',
        title: 'Источники данных',
        subtitle: 'Подключение и актуальность выгрузок',
        className: 'settings-card-wide',
        children: [
            el('div', { class: 'settings-sources-list' }, [
                sourceEndpointRow('site', 'Сайт ГермесГарант', SITE_JSON_URL, 'Автозагрузка JSON по URL'),
                sourceEndpointRow('ilvo', 'ILVO CRM', 'api.ilvo.pro · events', 'API-ключ хранится в .env / Secrets'),
                sourceEndpointRow('kufar', 'Kufar', s.kufarXmlUrl || '—', 'XML-фид через ILVO Posting')
            ]),
            el('div', { class: 'settings-inline-field' }, [
                el('label', { for: 'set-kufar-url' }, 'Ссылка XML-фида Kufar'),
                el('div', { class: 'settings-inline-field-row' }, [
                    el('input', { id: 'set-kufar-url', value: s.kufarXmlUrl || '', placeholder: 'https://…' }),
                    el('button', {
                        class: 'btn btn-secondary',
                        onclick: async () => {
                            await window.electronAPI.setSettings({
                                kufarXmlUrl: document.getElementById('set-kufar-url').value.trim()
                            });
                            await loadState();
                            showToast('Ссылка Kufar сохранена', 'success');
                        }
                    }, 'Сохранить')
                ])
            ])
        ]
    });

    const storageCard = sectionCard({
        iconName: 'file',
        title: 'Хранение',
        subtitle: 'Локальные файлы и ротация загрузок',
        children: [
            el('div', { class: 'settings-stat-strip' }, [
                el('div', { class: 'settings-stat-chip' }, [
                    el('span', { class: 'settings-stat-value' }, '5'),
                    el('span', { class: 'settings-stat-label' }, 'файлов на источник')
                ]),
                el('div', { class: 'settings-stat-chip' }, [
                    el('span', { class: 'settings-stat-value' }, '200'),
                    el('span', { class: 'settings-stat-label' }, 'записей истории')
                ]),
                el('div', { class: 'settings-stat-chip' }, [
                    el('span', { class: 'settings-stat-value' }, 'data/'),
                    el('span', { class: 'settings-stat-label' }, 'рабочая папка')
                ])
            ]),
            el('p', { class: 'settings-note' }, 'Для каждого источника сохраняются 5 последних исходных файлов. Более старые удаляются после нового импорта. Текущие данные, последний отчёт и история проверок не затрагиваются.')
        ]
    });

    const bento = el('div', { class: 'settings-bento' }, [
        profileCard,
        automationCard,
        sourcesCard,
        storageCard
    ]);

    container.appendChild(header);
    container.appendChild(hero);
    container.appendChild(bento);
}
