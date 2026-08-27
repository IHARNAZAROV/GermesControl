import { el, formatDateTime } from './format.js';
import { store, loadState, subscribe } from './state.js';
import { initRouter, navigate, onRouteChange, getCurrentRoute } from './router.js';
import { openImportModal } from './components/importPanel.js';
import { runCheckWithProgress } from './components/checkProgress.js';

import { renderDashboard } from './views/dashboard.js';
import { renderObjects } from './views/objects.js';
import { renderContracts } from './views/contracts.js';
import { renderComparison } from './views/comparison.js';
import { renderErrors } from './views/errors.js';
import { renderAnalytics } from './views/analytics.js';
import { renderReports } from './views/reports.js';
import { renderSettings } from './views/settings.js';

const NAV_ITEMS = [
    { key: 'dashboard', icon: '\u2302', label: 'Главная' },
    { key: 'objects', icon: '\u25A3', label: 'Объекты' },
    { key: 'contracts', icon: '\u25A4', label: 'Договоры' },
    { key: 'comparison', icon: '\u21C4', label: 'Сравнение площадок' },
    { key: 'errors', icon: '\u26A0', label: 'Ошибки', badge: (s) => s.report ? s.report.stats.errorsCount : null },
    { key: 'analytics', icon: '\u25A5', label: 'Аналитика' },
    { key: 'reports', icon: '\u25A4', label: 'Отчёты' },
    { key: 'settings', icon: '\u2699', label: 'Настройки' }
];

const VIEWS = {
    dashboard: renderDashboard,
    objects: renderObjects,
    contracts: renderContracts,
    comparison: renderComparison,
    errors: renderErrors,
    analytics: renderAnalytics,
    reports: renderReports,
    settings: renderSettings
};

const viewRoot = document.getElementById('view-root');
const sidebarEl = document.getElementById('sidebar');
const topbarEl = document.getElementById('topbar');

function renderSidebar(activeRoute) {
    sidebarEl.innerHTML = '';
    sidebarEl.appendChild(el('div', { class: 'sidebar-brand' }, [
        el('h1', {}, 'Hermes Control'),
        el('p', {}, 'Контроль объектов и договоров')
    ]));

    const nav = el('div', { class: 'sidebar-nav' });
    NAV_ITEMS.forEach((item) => {
        const badgeValue = item.badge ? item.badge(store) : null;
        nav.appendChild(el('div', {
            class: `nav-item${item.key === activeRoute ? ' active' : ''}`,
            onclick: () => navigate(item.key)
        }, [
            el('span', { class: 'nav-icon' }, item.icon),
            el('span', { class: 'nav-label' }, item.label),
            badgeValue ? el('span', { class: 'nav-badge' }, String(badgeValue)) : null
        ]));
    });
    sidebarEl.appendChild(nav);

    sidebarEl.appendChild(el('div', { class: 'sidebar-footer' }, [
        el('div', {}, 'Надёжный контроль.'),
        el('div', {}, 'Больше возможностей.'),
        el('div', { class: 'version' }, 'Версия 1.0.0')
    ]));
}

function initials(name) {
    return (name || '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

let clockInterval = null;

function renderTopbar(activeRoute) {
    topbarEl.innerHTML = '';
    const item = NAV_ITEMS.find((i) => i.key === activeRoute);
    const now = new Date();

    topbarEl.appendChild(el('div', { class: 'topbar-titles' }, [
        el('h2', {}, item ? item.label : ''),
        activeRoute === 'dashboard' ? el('p', {}, now.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })) : null
    ]));

    const actions = el('div', { class: 'topbar-actions' }, [
        el('button', { class: 'btn btn-secondary', onclick: () => openImportModal() }, ['\u2B07 Загрузить данные']),
        el('button', {
            class: 'btn btn-primary',
            onclick: () => runCheckWithProgress(() => rerenderCurrent())
        }, 'Запустить проверку'),
        el('div', { class: 'topbar-clock' }, [
            el('div', { class: 'time' }, now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })),
            el('div', {}, now.toLocaleDateString('ru-RU'))
        ]),
        el('div', { class: 'topbar-user' }, [
            el('div', { class: 'avatar' }, initials(store.settings.userName)),
            el('div', {}, [
                el('div', { class: 'name' }, store.settings.userName || 'Пользователь'),
                el('div', { class: 'role' }, store.settings.userRole || '')
            ])
        ])
    ]);
    topbarEl.appendChild(actions);

    if (clockInterval) clearInterval(clockInterval);
    clockInterval = setInterval(() => renderTopbar(getCurrentRoute()), 60000);
}

function rerenderCurrent() {
    const route = getCurrentRoute();
    renderSidebar(route);
    renderTopbar(route);
    const renderFn = VIEWS[route] || renderDashboard;
    renderFn(viewRoot);
}

async function bootstrap() {
    const initialRoute = initRouter();
    await loadState();
    rerenderCurrent();

    onRouteChange(() => rerenderCurrent());
    subscribe(() => rerenderCurrent());
    document.addEventListener('app:refresh-chrome', () => rerenderCurrent());
    document.addEventListener('app:refresh-view', () => rerenderCurrent());
}

bootstrap();
