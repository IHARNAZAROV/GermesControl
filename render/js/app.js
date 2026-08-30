import { el, icon, sourceLogo } from './format.js';
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
    { key: 'dashboard', icon: 'grid', label: 'Главная' },
    { key: 'objects', icon: 'building', label: 'Объекты' },
    { key: 'contracts', icon: 'file', label: 'Договоры' },
    { key: 'comparison', icon: 'compare', label: 'Сравнение площадок' },
    { key: 'errors', icon: 'alert', label: 'Ошибки', badge: (s) => s.report ? s.report.stats.errorsCount : null },
    { key: 'analytics', icon: 'chart', label: 'Аналитика' },
    { key: 'reports', icon: 'report', label: 'Отчёты' },
    { key: 'settings', icon: 'settings', label: 'Настройки' }
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
let scheduledRenderFrame = null;

function renderSidebar(activeRoute) {
    sidebarEl.innerHTML = '';
    sidebarEl.appendChild(el('div', { class: 'sidebar-brand' }, [
        el('div', { class: 'brand-lockup' }, [
            el('div', { class: 'brand-mark' }, [sourceLogo('site')]),
            el('div', {}, [
                el('h1', {}, 'GermesControl'),
                el('p', {}, 'Real estate intelligence')
            ])
        ]),
        el('div', { class: 'brand-status' }, [
            el('span', { class: 'status-pulse' }),
            el('span', {}, 'Система активна')
        ])
    ]));

    const nav = el('div', { class: 'sidebar-nav' });
    NAV_ITEMS.forEach((item) => {
        const badgeValue = item.badge ? item.badge(store) : null;
        nav.appendChild(el('div', {
            class: `nav-item${item.key === activeRoute ? ' active' : ''}`,
            onclick: () => navigate(item.key)
        }, [
            el('span', { class: 'nav-icon' }, [icon(item.icon, 17)]),
            el('span', { class: 'nav-label' }, item.label),
            badgeValue ? el('span', { class: 'nav-badge' }, String(badgeValue)) : null
        ]));
    });
    sidebarEl.appendChild(nav);

    sidebarEl.appendChild(el('div', { class: 'sidebar-footer' }, [
        el('div', { class: 'sidebar-footer-icon' }, [icon('shield', 16)]),
        el('div', { class: 'sidebar-footer-title' }, 'Рабочее пространство'),
        el('div', {}, 'Все источники под контролем.'),
        el('div', { class: 'version' }, 'Версия 1.0.0')
    ]));
}

function initials(name) {
    return (name || '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

let clockInterval = null;

const SOURCE_LABELS = { site: 'Сайт', ilvo: 'ILVO', kufar: 'Kufar' };
const SOURCE_KEYS = Object.keys(SOURCE_LABELS);
const FRESHNESS_LIMIT_MS = 24 * 60 * 60 * 1000;

function formatTime(iso) {
    const date = new Date(iso);
    return Number.isNaN(date.getTime())
        ? '—'
        : date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function formatCheckSubtitle(iso) {
    if (!iso) return 'Проверка ещё не запускалась';

    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return 'Время проверки неизвестно';

    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const dateLabel = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
    return isToday
        ? `Последняя проверка сегодня в ${formatTime(iso)}`
        : `Последняя проверка ${dateLabel} в ${formatTime(iso)}`;
}

function getSourceHealth() {
    const now = Date.now();
    const details = SOURCE_KEYS.map((key) => {
        const meta = store.sources?.[key]?.meta || {};
        const importedAt = meta.importedAt ? new Date(meta.importedAt) : null;
        const importedTime = importedAt && !Number.isNaN(importedAt.getTime()) ? importedAt.getTime() : null;
        const state = importedTime === null
            ? 'missing'
            : now - importedTime <= FRESHNESS_LIMIT_MS ? 'fresh' : 'stale';
        return { key, state, label: SOURCE_LABELS[key], importedAt: meta.importedAt };
    });
    const freshCount = details.filter((source) => source.state === 'fresh').length;
    const staleCount = details.filter((source) => source.state === 'stale').length;
    const loadedCount = details.filter((source) => source.state !== 'missing').length;
    const level = loadedCount < SOURCE_KEYS.length ? 'missing' : staleCount > 0 ? 'stale' : 'fresh';
    const label = level === 'fresh'
        ? `${freshCount} источника актуальны`
        : level === 'stale'
            ? `${staleCount} ${staleCount === 1 ? 'источник требует' : 'источника требуют'} обновления`
            : `${loadedCount} из ${SOURCE_KEYS.length} источников загружены`;
    const tooltip = details
        .map((source) => `${source.label}: ${source.state === 'missing' ? 'нет данных' : source.importedAt ? formatCheckSubtitle(source.importedAt).replace('Последняя проверка ', '') : 'нет данных'}`)
        .join(' · ');

    return { level, label, tooltip };
}

function getPageSubtitle(activeRoute, report) {
    const stats = report?.stats;
    if (activeRoute === 'dashboard') return formatCheckSubtitle(report?.checkedAt);
    if (!stats) {
        return activeRoute === 'settings'
            ? 'Профиль, источники и хранение данных'
            : 'Проверка ещё не запускалась';
    }

    const subtitles = {
        objects: `${stats.totalUnique} объектов · ${stats.problemsCount} требуют внимания`,
        contracts: `${stats.withContract} с договором · ${stats.withoutContract} без договора`,
        comparison: `${stats.matchPercent}% объектов совпадают на всех площадках`,
        errors: `${stats.errorsCount} записей · ${stats.criticalCount} критических`,
        analytics: `Данные по ${stats.totalUnique} уникальным объектам`,
        reports: formatCheckSubtitle(report.checkedAt),
        settings: 'Профиль, источники и хранение данных'
    };
    return subtitles[activeRoute] || formatCheckSubtitle(report.checkedAt);
}

function renderHeaderSummary(report) {
    const sourceHealth = getSourceHealth();
    const healthIcon = sourceHealth.level === 'fresh'
        ? 'check'
        : sourceHealth.level === 'stale' ? 'warningTriangle' : 'errorCircle';
    const nodes = [
        el('span', {
            class: `topbar-health topbar-health-${sourceHealth.level}`,
            title: sourceHealth.tooltip
        }, [icon(healthIcon, 14), sourceHealth.label])
    ];

    if (report?.stats) {
        nodes.push(
            el('span', { class: 'topbar-stat' }, `${report.stats.totalUnique} объектов`),
            el('span', { class: 'topbar-stat topbar-stat-danger' }, `${report.stats.problemsCount} объектов требуют внимания`)
        );
    } else {
        nodes.push(el('span', { class: 'topbar-stat' }, 'Проверка не запускалась'));
    }

    return el('div', { class: 'topbar-summary' }, nodes);
}

function renderTopbar(activeRoute) {
    topbarEl.innerHTML = '';
    const item = NAV_ITEMS.find((i) => i.key === activeRoute);
    const now = new Date();
    const pageTitle = activeRoute === 'dashboard' ? 'Центр контроля' : item ? item.label : '';

    topbarEl.appendChild(el('div', { class: 'topbar-titles' }, [
        el('h2', {}, pageTitle),
        el('p', {}, getPageSubtitle(activeRoute, store.report)),
        renderHeaderSummary(store.report)
    ]));

    const actions = el('div', { class: 'topbar-actions' }, [
        el('button', { class: 'btn btn-secondary', onclick: () => openImportModal() }, [
            icon('upload', 16),
            'Загрузить данные'
        ]),
        el('button', {
            class: 'btn btn-primary',
            onclick: () => runCheckWithProgress(() => rerenderCurrent())
        }, [icon('play', 15), 'Запустить проверку']),
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
    if (scheduledRenderFrame !== null) {
        window.cancelAnimationFrame(scheduledRenderFrame);
        scheduledRenderFrame = null;
    }
    const route = getCurrentRoute();
    renderSidebar(route);
    renderTopbar(route);
    const renderFn = VIEWS[route] || renderDashboard;
    renderFn(viewRoot);
}

function scheduleRerender() {
    if (scheduledRenderFrame !== null) return;
    scheduledRenderFrame = window.requestAnimationFrame(() => {
        scheduledRenderFrame = null;
        rerenderCurrent();
    });
}

async function bootstrap() {
    const initialRoute = initRouter();
    await loadState();
    rerenderCurrent();

    onRouteChange(() => rerenderCurrent());
    subscribe(scheduleRerender);
    document.addEventListener('app:refresh-chrome', () => rerenderCurrent());
    document.addEventListener('app:refresh-view', () => rerenderCurrent());
}

bootstrap();
