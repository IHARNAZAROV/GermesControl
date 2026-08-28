import { el, formatMoney, pluralize, icon, sourceLogo } from '../format.js';
import { store, runCheck } from '../state.js';
import { renderDonut } from '../components/donutChart.js';
import { showToast } from '../components/toast.js';
import { navigate } from '../router.js';

function kpiCard({ icon: iconName, logo, value, label, delta, danger, featured, tone }) {
    let deltaNode = null;
    if (delta !== undefined && delta !== null) {
        const dir = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
        const arrow = delta > 0 ? '\u2191' : delta < 0 ? '\u2193' : '\u2192';
        deltaNode = el('span', { class: `kpi-delta ${dir}` }, `${arrow} ${delta > 0 ? '+' : ''}${delta} с прошлой проверки`);
    }
    return el('div', { class: `kpi-card${danger ? ' is-danger' : ''}${featured ? ' is-featured' : ''}${tone ? ` is-${tone}` : ''}` }, [
        el('div', { class: 'kpi-top' }, [
            el('div', { class: 'kpi-icon' }, [logo ? sourceLogo(logo) : icon(iconName, 18)]),
            featured ? el('span', { class: 'kpi-overline' }, 'В ФОКУСЕ') : null
        ]),
        el('div', { class: 'kpi-value' }, String(value)),
        el('div', { class: 'kpi-label' }, label),
        deltaNode
    ]);
}

function issuesTable(errors) {
    const rows = errors.slice(0, 6);
    const targetLabel = (error) => error.targetType === 'contract'
        ? `Договор ${error.target || '—'}`
        : `№${error.target || '—'}`;
    const head = el('div', { class: 'issues-row head' }, [
        el('div', {}, 'Объект / Договор'), el('div', {}, 'Проблема'), el('div', {}, 'Источник'), el('div', {}, 'Дата')
    ]);
    const body = rows.map((e) => el('div', { class: 'issues-row' }, [
        el('div', {}, targetLabel(e)),
        el('div', { class: 'issue-description' }, [
            el('span', { class: `issue-severity ${e.severity === 'critical' ? 'critical' : 'warning'}` }, [
                icon(e.severity === 'critical' ? 'errorCircle' : 'warningTriangle', 15)
            ]),
            el('span', {}, e.type)
        ]),
        el('div', {}, e.source || '—'),
        el('div', {}, e.date)
    ]));
    if (rows.length === 0) {
        body.push(el('div', { class: 'table-empty' }, 'Проблем не найдено'));
    }
    return el('div', { class: 'issues-list' }, [head, ...body]);
}

export function renderDashboard(container) {
    const { report, stats } = store.report ? { report: store.report, stats: store.report.stats } : { report: null, stats: null };
    const hour = new Date();

    container.innerHTML = '';

    container.appendChild(
        el('div', { class: 'dash-hero' }, [
            el('div', {}, [
                el('h1', {}, `Добро пожаловать, ${(store.settings.userName || 'Ольга').split(' ')[0]}!`),
                el('p', { class: 'lead' }, 'Контроль объектов, договоров и рекламных площадок в одном месте')
            ])
        ])
    );

    if (!report) {
        container.appendChild(
            el('div', { class: 'card card-pad' }, [
                el('div', { class: 'card-title' }, 'Проверка ещё не запускалась'),
                el('p', { class: 'card-subtitle', style: 'margin-top:8px;margin-bottom:14px;' }, 'Загрузите данные и нажмите «Запустить проверку», чтобы увидеть сводку.'),
                el('button', {
                    class: 'btn btn-primary',
                    onclick: async () => { showToast('Проверка запущена'); await runCheck(); renderDashboard(container); }
                }, 'Запустить проверку')
            ])
        );
        return;
    }

    const deltas = report.deltas || {};
    const kpis = el('div', { class: 'kpi-grid' }, [
        kpiCard({ logo: 'site', value: stats.siteCount, label: 'Объекты на сайте', delta: deltas.site, tone: 'site' }),
        kpiCard({ logo: 'ilvo', value: stats.ilvoCount, label: 'Объекты в ILVO', delta: deltas.ilvo, tone: 'ilvo' }),
        kpiCard({ logo: 'kufar', value: stats.kufarCount, label: 'Объекты в Kufar', delta: deltas.kufar, tone: 'kufar' }),
        kpiCard({ icon: 'alert', value: stats.problemsCount, label: 'Проблемы', danger: true, delta: deltas.problems })
    ]);
    container.appendChild(kpis);

    const cat = report.categories;
    const segments = [
        { label: 'На всех площадках', value: cat.everywhere, color: '#155945' },
        { label: 'Отсутствуют на сайте', value: cat.missingSite, color: '#D97706' },
        { label: 'Отсутствуют в Kufar', value: cat.missingKufar, color: '#DC2626' },
        { label: 'Отсутствуют в ILVO', value: cat.missingIlvo, color: '#6B7280' }
    ];
    const total = segments.reduce((s, x) => s + x.value, 0) || 1;
    const sources = [
        { key: 'ilvo', label: 'ILVO CRM', count: stats.ilvoCount },
        { key: 'site', label: 'Сайт ГермесГарант', count: stats.siteCount },
        { key: 'kufar', label: 'Kufar', count: stats.kufarCount }
    ];

    const donutCard = el('div', { class: 'card card-pad' }, [
        el('div', { class: 'card-title' }, 'Соответствие объектов по площадкам'),
        el('div', { class: 'donut-wrap', style: 'margin-top:16px;' }, [
            renderDonut(segments, { value: stats.matchPercent + '%', caption: 'объектов совпадают' }),
            el('div', { class: 'donut-legend' }, segments.map((s) =>
                el('div', { class: 'donut-legend-row' }, [
                    el('span', { class: 'dot', style: `background:${s.color}` }),
                    el('span', { class: 'label' }, s.label),
                    el('span', { class: 'count' }, String(s.value)),
                    el('span', { class: 'pct' }, Math.round((s.value / total) * 100) + '%')
                ])
            ))
        ]),
        el('div', { class: 'source-summary' }, sources.map((source) =>
            el('div', { class: `source-summary-row source-${source.key}` }, [
                el('div', { class: 'source-summary-main' }, [
                    el('span', { class: 'source-icon' }, [sourceLogo(source.key)]),
                    el('span', {}, source.label)
                ]),
                el('span', { class: 'source-summary-count' }, String(source.count)),
                el('span', { class: 'source-summary-unit' }, 'объектов')
            ])
        ))
    ]);

    const issuesCard = el('div', { class: 'card card-pad' }, [
        el('div', { class: 'card-title' }, 'Последние выявленные проблемы'),
        el('div', { style: 'margin-top:14px;' }, [issuesTable(report.errors)]),
        el('div', { class: 'issues-link', onclick: () => navigate('errors') }, [
            'Все проблемы',
            icon('arrowRight', 15)
        ])
    ]);

    container.appendChild(el('div', { class: 'grid-2' }, [donutCard, issuesCard]));

}
