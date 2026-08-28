import { el } from '../format.js';
import { store } from '../state.js';
import { renderLineChart } from '../components/lineChart.js';
import { formatShortDate } from '../format.js';

function tile(value, label) {
    return el('div', { class: 'card stat-tile' }, [
        el('div', { class: 'v' }, String(value)),
        el('div', { class: 'l' }, label)
    ]);
}

export function renderAnalytics(container) {
    container.innerHTML = '';
    container.appendChild(el('div', { class: 'page-title' }, 'Аналитика'));
    container.appendChild(el('div', { class: 'page-subtitle' }, 'Расширенная статистика и динамика проверок'));

    const report = store.report;
    if (!report) {
        container.appendChild(el('div', { class: 'card card-pad table-empty' }, 'Запустите проверку на главной странице, чтобы увидеть аналитику'));
        return;
    }

    const stats = report.stats;

    container.appendChild(el('div', { class: 'card-title', style: 'margin-bottom:10px;' }, 'Общая статистика'));
    container.appendChild(el('div', { class: 'stat-grid', style: 'margin-bottom:22px;' }, [
        tile(stats.totalUnique, 'Всего объектов'),
        tile(stats.activeCount, 'Активных объектов'),
        tile(stats.soldCount, 'Проданных объектов'),
        tile(stats.withContract, 'Объектов с договорами'),
        tile(stats.withoutContract, 'Объектов без договоров')
    ]));

    container.appendChild(el('div', { class: 'card-title', style: 'margin-bottom:10px;' }, 'Состояние выгрузки'));
    container.appendChild(el('div', { class: 'stat-grid', style: 'grid-template-columns: repeat(3, 1fr); margin-bottom:22px;' }, [
        tile(stats.siteCount, 'Сайт'),
        tile(stats.ilvoCount, 'ILVO'),
        tile(stats.kufarCount, 'Kufar')
    ]));

    container.appendChild(el('div', { class: 'card-title', style: 'margin-bottom:10px;' }, 'Ошибки'));
    container.appendChild(el('div', { class: 'stat-grid', style: 'margin-bottom:22px;' }, [
        tile(stats.criticalCount, 'Критические'),
        tile(stats.warningCount, 'Предупреждения'),
        tile(0, 'Исправленные'),
        tile(stats.errorsCount, 'Новые')
    ]));

    const history = store.history || [];
    let rangeDays = 30;
    const now = Date.now();

    const chartCard = el('div', { class: 'card card-pad' });
    const tabs = el('div', { class: 'chart-tabs' }, [7, 30, 90].map((d) =>
        el('span', { class: `filter-chip${d === 30 ? ' active' : ''}`, onclick: (e) => setRange(d, e) }, `${d} дней`)
    ));
    const metricTabs = el('div', { class: 'chart-tabs' });
    const metrics = [
        { key: 'siteCount', label: 'Объекты (сайт)' },
        { key: 'problemsCount', label: 'Ошибки' },
        { key: 'errorsCount', label: 'Записи ошибок' }
    ];
    let activeMetric = metrics[0].key;
    metrics.forEach((m, i) => metricTabs.appendChild(
        el('span', { class: `filter-chip${i === 0 ? ' active' : ''}`, onclick: (e) => setMetric(m.key, e) }, m.label)
    ));
    const chartHolder = el('div');
    chartCard.appendChild(el('div', { class: 'card-title' }, 'Динамика'));
    chartCard.appendChild(tabs);
    chartCard.appendChild(metricTabs);
    chartCard.appendChild(chartHolder);
    container.appendChild(chartCard);

    function setRange(d, e) {
        rangeDays = d;
        tabs.querySelectorAll('.filter-chip').forEach((c) => c.classList.remove('active'));
        e.target.classList.add('active');
        draw();
    }
    function setMetric(key, e) {
        activeMetric = key;
        metricTabs.querySelectorAll('.filter-chip').forEach((c) => c.classList.remove('active'));
        e.target.classList.add('active');
        draw();
    }

    function draw() {
        const cutoff = now - rangeDays * 86400000;
        let points = history.filter((h) => new Date(h.checkedAt).getTime() >= cutoff);
        if (points.length < 2) points = history.slice(-Math.max(2, history.length));
        const series = points.map((h) => ({ date: h.checkedAt, value: h.stats[activeMetric] ?? 0 }));
        chartHolder.innerHTML = '';
        chartHolder.appendChild(renderLineChart(series, { color: activeMetric === 'siteCount' ? '#155945' : '#D97706' }));
        if (series.length) {
            chartHolder.appendChild(el('div', { class: 'text-secondary', style: 'font-size:11.5px;margin-top:6px;text-align:right;' },
                `${formatShortDate(series[0].date)} — ${formatShortDate(series[series.length - 1].date)}`));
        }
    }

    draw();
}
