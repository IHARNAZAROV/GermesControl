import { el, formatShortDate } from '../format.js';
import { store } from '../state.js';
import { renderLineChart } from '../components/lineChart.js';
import { renderDonut } from '../components/donutChart.js';
import { renderDataTable } from '../components/table.js';

const SOURCE_LABELS = {
    site: 'Сайт',
    ilvo: 'ILVO',
    kufar: 'Kufar'
};

const SOURCE_COLORS = {
    site: '#155945',
    ilvo: '#6A7FDB',
    kufar: '#D18A32'
};

const STATUS_COLORS = {
    ok: '#155945',
    missing: '#D97706',
    mismatch: '#DC2626'
};

function percent(value, total) {
    return total > 0 ? Math.round((value / total) * 100) : 0;
}

function tile(value, label, context = '') {
    return el('div', { class: 'card stat-tile analytics-stat-tile' }, [
        el('div', { class: 'v' }, String(value)),
        el('div', { class: 'l' }, label),
        context ? el('div', { class: 'analytics-tile-context' }, context) : null
    ]);
}

function cardHeading(title, subtitle) {
    return el('div', { class: 'analytics-card-heading' }, [
        el('div', { class: 'card-title' }, title),
        subtitle ? el('div', { class: 'card-subtitle' }, subtitle) : null
    ]);
}

function analyticsCard(title, subtitle, content) {
    return el('div', { class: 'card card-pad analytics-card' }, [
        cardHeading(title, subtitle),
        content
    ]);
}

function barList(items, emptyText = 'Нет данных для отображения') {
    const nonEmptyItems = items.filter((item) => item.value > 0);
    if (!nonEmptyItems.length) return el('div', { class: 'analytics-empty' }, emptyText);

    const max = Math.max(...nonEmptyItems.map((item) => item.value), 1);
    return el('div', { class: 'analytics-bars' }, nonEmptyItems.map((item) => {
        const width = Math.max(4, Math.round((item.value / max) * 100));
        return el('div', { class: 'analytics-bar-row' }, [
            el('div', { class: 'analytics-bar-header' }, [
                el('span', { class: 'analytics-bar-label' }, [
                    item.color ? el('span', { class: 'analytics-bar-dot', style: `background:${item.color}` }) : null,
                    item.label
                ]),
                el('span', { class: 'analytics-bar-value' }, item.valueLabel || String(item.value))
            ]),
            el('div', { class: 'analytics-bar-track' }, [
                el('div', {
                    class: 'analytics-bar-fill',
                    style: `width:${width}%;${item.color ? `background:${item.color};` : ''}`
                })
            ])
        ]);
    }));
}

function donutLegend(segments, total) {
    return el('div', { class: 'donut-legend analytics-donut-legend' }, segments.map((segment) =>
        el('div', { class: 'donut-legend-row' }, [
            el('span', { class: 'dot', style: `background:${segment.color}` }),
            el('span', { class: 'label' }, segment.label),
            el('span', { class: 'count' }, String(segment.value)),
            el('span', { class: 'pct' }, `${percent(segment.value, total)}%`)
        ])
    ));
}

function countBy(items, getKey) {
    const counts = new Map();
    items.forEach((item) => {
        const key = getKey(item) || 'Не указано';
        counts.set(key, (counts.get(key) || 0) + 1);
    });
    return [...counts.entries()]
        .map(([label, value]) => ({ label, value }))
        .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, 'ru'));
}

function formatCoverage(object) {
    const present = Object.values(object.presence || {}).filter(Boolean).length;
    return `${present} из 3`;
}

function getObjectErrorCounts(report) {
    const counts = new Map();
    (report.errors || []).forEach((error) => {
        if (error.targetType !== 'contract') {
            const key = String(error.target);
            counts.set(key, (counts.get(key) || 0) + 1);
        }
    });
    return counts;
}

function renderStatusCard(report) {
    const objects = report.objects || [];
    const segments = [
        { label: 'Без расхождений', value: objects.filter((object) => object.status === 'ok').length, color: STATUS_COLORS.ok },
        { label: 'Отсутствует источник', value: objects.filter((object) => object.status === 'missing').length, color: STATUS_COLORS.missing },
        { label: 'Есть расхождение', value: objects.filter((object) => object.status === 'mismatch').length, color: STATUS_COLORS.mismatch }
    ];
    const total = objects.length;
    const cleanCount = segments[0].value;

    return analyticsCard(
        'Состояние реестра',
        'Результат сопоставления карточек между источниками',
        el('div', { class: 'analytics-donut-layout' }, [
            renderDonut(segments, {
                value: `${percent(cleanCount, total)}%`,
                caption: 'без проблем'
            }),
            donutLegend(segments, total)
        ])
    );
}

function renderSourceCard(report) {
    const stats = report.stats;
    const categories = report.categories || {};
    const total = stats.totalUnique || 0;
    const active = stats.activeCount || 0;
    const sourceItems = ['site', 'ilvo', 'kufar'].map((key) => ({
        label: SOURCE_LABELS[key],
        value: stats[`${key}Count`] || 0,
        valueLabel: `${stats[`${key}Count`] || 0} · ${percent(stats[`${key}Count`] || 0, total)}%`,
        color: SOURCE_COLORS[key]
    }));
    const categoryItems = [
        { label: 'Нет на сайте', value: categories.missingSite || 0, color: '#DC2626' },
        { label: 'Нет в ILVO', value: categories.missingIlvo || 0, color: '#6A7FDB' },
        { label: 'Нет в Kufar', value: categories.missingKufar || 0, color: '#D18A32' }
    ];

    return analyticsCard(
        'Покрытие источников',
        'Количество записей и доля от уникального реестра',
        el('div', {}, [
            barList(sourceItems),
            el('div', { class: 'analytics-subheading' }, 'Активные объекты без записи'),
            barList(categoryItems, 'Все активные объекты присутствуют во всех источниках'),
            el('div', { class: 'analytics-insight' }, [
                el('strong', {}, `${categories.everywhere || 0} из ${active}`),
                ` активных объектов есть на всех трёх площадках`
            ])
        ])
    );
}

function renderErrorCard(report) {
    const errors = report.errors || [];
    const items = countBy(errors, (error) => error.type).map((item) => ({
        ...item,
        valueLabel: String(item.value)
    }));
    const severityItems = [
        { label: 'Критические', value: report.stats.criticalCount || 0, color: '#DC2626' },
        { label: 'Предупреждения', value: report.stats.warningCount || 0, color: '#D97706' },
        { label: 'Информационные', value: report.stats.infoCount || 0, color: '#6A7FDB' }
    ];

    return analyticsCard(
        'Структура ошибок',
        `${errors.length} записей · сначала показаны самые частые типы`,
        el('div', {}, [
            barList(severityItems),
            el('div', { class: 'analytics-subheading' }, 'По типу несоответствия'),
            barList(items)
        ])
    );
}

function renderContractCard(report) {
    const stats = report.stats;
    const totalObjects = stats.totalUnique || 0;
    const contractSegments = [
        { label: 'С договором', value: stats.withContract || 0, color: '#155945' },
        { label: 'Без договора', value: stats.withoutContract || 0, color: '#D97706' }
    ];
    const contracts = report.contracts || [];
    const duplicateCount = contracts.filter((contract) => contract.duplicate).length;
    const orphanCount = contracts.filter((contract) => !contract.objectId).length;
    const formatCount = (report.errors || []).filter((error) => error.type === 'Разные разделители номера договора').length;

    return analyticsCard(
        'Качество договоров',
        'Полнота, привязка и корректность реестра',
        el('div', {}, [
            el('div', { class: 'analytics-donut-layout analytics-contract-layout' }, [
                renderDonut(contractSegments, {
                    value: `${percent(stats.withContract || 0, totalObjects)}%`,
                    caption: 'с договором'
                }),
                donutLegend(contractSegments, totalObjects)
            ]),
            barList([
                { label: 'Дубли номеров', value: duplicateCount, color: '#DC2626' },
                { label: 'Без объекта', value: orphanCount, color: '#D97706' },
                { label: 'Разный формат номера', value: formatCount, color: '#6A7FDB' }
            ])
        ])
    );
}

function renderProfileCard(objects) {
    const activeObjects = objects.filter((object) => object.listingStatus !== 'sold');
    const typeItems = countBy(activeObjects, (object) => object.type);
    const dealItems = countBy(activeObjects, (object) => object.dealType);
    const cityItems = countBy(activeObjects, (object) => object.city).slice(0, 6);

    return analyticsCard(
        'Профиль активной базы',
        'Какие объекты сейчас находятся в работе',
        el('div', {}, [
            el('div', { class: 'analytics-subheading' }, 'По типу объекта'),
            barList(typeItems),
            el('div', { class: 'analytics-subheading' }, 'По типу сделки'),
            barList(dealItems),
            el('div', { class: 'analytics-subheading' }, 'Топ городов'),
            barList(cityItems)
        ])
    );
}

function renderAttentionTable(report) {
    const errorCounts = getObjectErrorCounts(report);
    const rows = (report.objects || [])
        .filter((object) => object.status !== 'ok')
        .map((object) => ({
            ...object,
            issueCount: errorCounts.get(String(object.objectNumber)) || 0,
            coverage: formatCoverage(object)
        }))
        .sort((a, b) => b.issueCount - a.issueCount
            || Object.values(b.presence || {}).filter(Boolean).length - Object.values(a.presence || {}).filter(Boolean).length
            || a.objectNumber - b.objectNumber)
        .slice(0, 10);

    return el('div', { class: 'card card-pad analytics-attention-card' }, [
        cardHeading('Объекты, требующие внимания', 'Первые 10 карточек с расхождениями или неполным покрытием источников'),
        renderDataTable({
            columns: [
                { key: 'objectNumber', label: '№', nowrap: true },
                { key: 'title', label: 'Объект', render: (object) => object.title || '—' },
                { key: 'issueCount', label: 'Записей ошибок', nowrap: true },
                { key: 'coverage', label: 'Источники', nowrap: true },
                {
                    key: 'status',
                    label: 'Состояние',
                    render: (object) => object.status === 'missing' ? 'Неполное покрытие' : 'Расхождение'
                }
            ],
            rows,
            searchFields: ['objectNumber', 'title', 'city', 'address', 'contractNumber'],
            emptyText: 'Проблемных объектов нет',
            pageSize: 10,
            initialSortKey: 'issueCount',
            initialSortDir: -1
        })
    ]);
}

function renderDynamics(report) {
    const metrics = [
        { key: 'matchPercent', label: 'Покрытие площадок', color: '#155945', suffix: '%' },
        { key: 'problemsCount', label: 'Объекты требуют внимания', color: '#D97706' },
        { key: 'errorsCount', label: 'Записи ошибок', color: '#DC2626' },
        { key: 'criticalCount', label: 'Критические ошибки', color: '#8B1E3F' },
        { key: 'withoutContract', label: 'Без договора', color: '#6A7FDB' }
    ];
    const history = (store.history || []).length
        ? store.history
        : [{ checkedAt: report.checkedAt, stats: report.stats }];
    const availableMetrics = metrics.filter((metric) => history.some((entry) => (
        entry.stats && entry.stats[metric.key] !== undefined
    )));
    const activeMetrics = availableMetrics.length ? availableMetrics : [metrics[0]];
    let rangeDays = 30;
    let activeMetric = activeMetrics[0].key;
    const now = Date.now();

    const chartCard = el('div', { class: 'card card-pad analytics-dynamics-card' });
    const rangeTabs = el('div', { class: 'chart-tabs' }, [7, 30, 90].map((days) =>
        el('span', {
            class: `filter-chip${days === rangeDays ? ' active' : ''}`,
            onclick: (event) => setRange(days, event)
        }, `${days} дней`)
    ));
    const metricTabs = el('div', { class: 'chart-tabs' }, activeMetrics.map((metric, index) =>
        el('span', {
            class: `filter-chip${index === 0 ? ' active' : ''}`,
            onclick: (event) => setMetric(metric.key, event)
        }, metric.label)
    ));
    const chartHolder = el('div', { class: 'filter-animated-content' });

    chartCard.append(
        cardHeading('Динамика проверок', 'Как меняется качество данных между запусками проверки'),
        rangeTabs,
        metricTabs,
        chartHolder
    );

    function setRange(days, event) {
        rangeDays = days;
        rangeTabs.querySelectorAll('.filter-chip').forEach((chip) => chip.classList.remove('active'));
        event.currentTarget.classList.add('active');
        draw();
    }

    function setMetric(key, event) {
        activeMetric = key;
        metricTabs.querySelectorAll('.filter-chip').forEach((chip) => chip.classList.remove('active'));
        event.currentTarget.classList.add('active');
        draw();
    }

    function draw() {
        const cutoff = now - rangeDays * 86400000;
        let points = history.filter((entry) => new Date(entry.checkedAt).getTime() >= cutoff);
        if (!points.length) points = history.slice(-Math.max(2, history.length));
        const metric = activeMetrics.find((item) => item.key === activeMetric) || activeMetrics[0];
        const series = points.map((entry) => ({
            date: entry.checkedAt,
            value: entry.stats?.[metric.key] ?? 0
        }));
        chartHolder.innerHTML = '';
        chartHolder.appendChild(renderLineChart(series, {
            color: metric.color,
            formatValue: (value) => `${value}${metric.suffix || ''}`
        }));
        if (series.length) {
            const last = series[series.length - 1];
            chartHolder.appendChild(el('div', {
                class: 'analytics-chart-summary'
            }, `Сейчас: ${last.value}${metric.suffix || ''} · ${formatShortDate(last.date)}`));
            chartHolder.appendChild(el('div', {
                class: 'text-secondary',
                style: 'font-size:11.5px;margin-top:4px;text-align:right;'
            }, `${formatShortDate(series[0].date)} — ${formatShortDate(last.date)}`));
        }
        chartHolder.classList.remove('filter-content-enter');
        void chartHolder.offsetWidth;
        chartHolder.classList.add('filter-content-enter');
    }

    draw();
    return chartCard;
}

export function renderAnalytics(container) {
    container.innerHTML = '';
    container.appendChild(el('div', { class: 'page-title' }, 'Аналитика'));
    container.appendChild(el('div', { class: 'page-subtitle' }, 'Состояние базы, качество источников и структура активных объектов'));

    const report = store.report;
    if (!report) {
        container.appendChild(el('div', { class: 'card card-pad table-empty' }, 'Запустите проверку на главной странице, чтобы увидеть аналитику'));
        return;
    }

    const stats = report.stats;
    const allObjectsCount = stats.totalUnique || 0;
    const allPlatformsCount = report.categories?.everywhere || 0;

    container.appendChild(el('div', { class: 'analytics-section-title' }, 'Ключевые показатели'));
    container.appendChild(el('div', { class: 'stat-grid analytics-kpi-grid' }, [
        tile(stats.totalUnique, 'Уникальных объектов', 'единый реестр'),
        tile(stats.activeCount, 'Активных', 'в работе сейчас'),
        tile(allPlatformsCount, 'На всех площадках', `${percent(allPlatformsCount, stats.activeCount || 0)}% активной базы`),
        tile(stats.problemsCount, 'Требуют внимания', `${percent(stats.problemsCount, allObjectsCount)}% реестра`),
        tile(stats.errorsCount, 'Записей ошибок', `${stats.criticalCount || 0} критических`),
        tile(`${percent(stats.withContract || 0, allObjectsCount)}%`, 'Договоры заполнены', `${stats.withoutContract || 0} без договора`)
    ]));

    container.appendChild(el('div', { class: 'analytics-grid' }, [
        renderStatusCard(report),
        renderSourceCard(report)
    ]));

    container.appendChild(el('div', { class: 'analytics-grid' }, [
        renderProfileCard(report.objects || []),
        renderErrorCard(report)
    ]));

    container.appendChild(el('div', { class: 'analytics-grid' }, [
        renderContractCard(report),
        renderDynamics(report)
    ]));

    container.appendChild(renderAttentionTable(report));
}