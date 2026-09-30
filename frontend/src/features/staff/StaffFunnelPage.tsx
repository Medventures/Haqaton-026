import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { ApiClientError, api } from "@/api/client";
import type { AnalyticsOverview } from "@/api/types";
import { useActor } from "@/app/actor";
import { serifHeading } from "@/components/app/AppShell";
import { StaffLayout } from "@/features/staff/StaffLayout";
import { StaffPageHeader } from "@/features/staff/dark";
import {
  ChartCard,
  ColumnChart,
  Donut,
  GREEN,
  HBars,
  Heatmap,
  LIME,
  MoneyCard,
  RadialGauge,
  SegmentedBar,
  SegmentRateBars,
  Sparkline,
  formatCount,
  formatMoney,
  formatPercent,
} from "@/features/staff/charts";

export function StaffFunnelPage() {
  // Route /staff/funnel — the clinic business-analytics dashboard.
  return (
    <StaffLayout>
      <StaffAnalyticsInner />
    </StaffLayout>
  );
}

const WEEKDAY_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

function formatGeneratedAt(iso: string): string {
  try {
    return format(parseISO(iso), "dd.MM.yyyy HH:mm");
  } catch {
    return iso;
  }
}

/** Week-start date → 'с 01.09' style label. */
function formatWeekLabel(iso: string): string {
  try {
    return `с ${format(parseISO(`${iso}T00:00:00Z`), "dd.MM")}`;
  } catch {
    return iso;
  }
}

/** Big KPI card with an optional radial gauge on the right. */
function KpiCard({
  caption,
  value,
  gauge,
}: {
  caption: string;
  value: string;
  gauge?: number | null;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-2xl border border-white/[0.07] bg-[#18201C] px-4 py-4">
      <div className="min-w-0">
        <div className="text-[27px] font-semibold leading-none tabular-nums text-[#E8EFEA]">{value}</div>
        <div className="mt-2 text-[12.5px] leading-tight text-[#9AABA2]">{caption}</div>
      </div>
      {gauge !== undefined ? (
        <div className="relative shrink-0">
          <RadialGauge value={gauge} />
        </div>
      ) : null}
    </div>
  );
}

export function StaffAnalyticsInner() {
  const actor = useActor();
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [questionFilter, setQuestionFilter] = useState<"all" | "high_drop">("all");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void api
      .analyticsOverview()
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiClientError ? err.message : "Не удалось загрузить аналитику");
        setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [actor.ownerSession]);

  const kpis = data?.kpis;

  // Funnel percentages and the single biggest step-to-step drop.
  const funnelRows = useMemo(() => {
    if (!data) return [];
    const first = data.funnel[0]?.count || 0;
    return data.funnel.map((step, i) => {
      const prev = i === 0 ? null : data.funnel[i - 1].count;
      const ofPrev = prev && prev > 0 ? step.count / prev : null;
      const ofFirst = first > 0 ? step.count / first : null;
      const drop = prev !== null && prev > 0 ? (prev - step.count) / prev : 0;
      return { ...step, ofPrev, ofFirst, drop, index: i };
    });
  }, [data]);

  const worstDropIndex = useMemo(() => {
    let idx = -1;
    let worst = 0;
    funnelRows.forEach((r) => {
      if (r.index > 0 && r.drop > worst) {
        worst = r.drop;
        idx = r.index;
      }
    });
    return idx;
  }, [funnelRows]);

  const questions = useMemo(() => {
    if (!data) return [];
    if (questionFilter === "high_drop") return data.questions.filter((q) => (q.drop_off ?? 0) > 0.05);
    return data.questions;
  }, [data, questionFilter]);

  const highDropCount = useMemo(
    () => (data ? data.questions.filter((q) => (q.drop_off ?? 0) > 0.05).length : 0),
    [data],
  );

  if (loading) return <DashboardSkeleton />;

  if (error) {
    return (
      <div>
        <StaffPageHeader title="Аналитика" />
        <div className="rounded-2xl border border-[#F07167]/30 bg-[#F07167]/[0.08] p-5 text-[14px] text-[#F07167]">
          {error}
        </div>
      </div>
    );
  }

  if (!data || !kpis) return null;

  return (
    <div className="pb-4">
      {/* a. Header */}
      <StaffPageHeader
        title="Аналитика"
        subtitle={`Как клиенты проходят путь от сайта до записи. Данные на ${formatGeneratedAt(data.generated_at)}.`}
      />

      {kpis.pending_requests > 0 ? (
        <div className="inline-flex items-center gap-2 rounded-xl border border-[#F2B84B]/30 bg-[#F2B84B]/[0.12] px-3.5 py-2 text-[13.5px] text-[#F2C97A]">
          <span className="h-2 w-2 rounded-full bg-[#F2B84B]" aria-hidden />
          Заявок ждут подтверждения: <span className="font-semibold tabular-nums">{kpis.pending_requests}</span>
        </div>
      ) : null}

      {/* b. KPI grid */}
      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard caption="Клиентов" value={formatCount(kpis.clients)} />
        <KpiCard caption="Визитов на сайт" value={formatCount(kpis.sessions)} />
        <KpiCard caption="Завершили анкету" value={formatPercent(kpis.completion_rate)} />
        <KpiCard caption="Записались после анкеты" value={formatPercent(kpis.booking_rate)} />
        <KpiCard caption="Конверсия визит → запись" value={formatPercent(kpis.visit_conversion)} />
        <KpiCard caption="Приёмов на 7 дней" value={formatCount(kpis.upcoming_7d)} />
        <KpiCard caption="Загрузка терапевта, 14 дней" value={formatPercent(kpis.utilisation_14d)} gauge={kpis.utilisation_14d} />
        <KpiCard caption="Выбирают «Максимальный»" value={formatPercent(kpis.maximum_share)} />
      </div>

      <p className="mt-3 text-[12.5px] text-[#9AABA2]">
        Средний возраст клиента: <span className="font-medium tabular-nums text-[#E8EFEA]">{kpis.avg_age ?? "—"}</span>
        {typeof kpis.avg_age === "number" ? " лет" : ""}.
      </p>

      {/* Выручка */}
      <section className="mt-6">
        <h2 className={`${serifHeading} text-[22px] text-[#E8EFEA]`}>Выручка</h2>
        <p className="mt-1 text-[13.5px] text-[#9AABA2]">
          Оценка по прейскуранту программ на каждом этапе воронки.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MoneyCard
            caption="Потенциал всех заявок"
            value={formatMoney(data.revenue.pipeline, data.revenue.currency)}
            hint="Все, кто прошёл анкету"
            accent
          />
          <MoneyCard
            caption="Записаны на приём"
            value={formatMoney(data.revenue.booked, data.revenue.currency)}
            hint="Подтверждённые записи"
          />
          <MoneyCard
            caption="Уже в работе"
            value={formatMoney(data.revenue.realised, data.revenue.currency)}
            hint="Приём состоялся или идёт"
          />
          <MoneyCard
            caption="Средний чек"
            value={formatMoney(data.revenue.avg_check, data.revenue.currency)}
            hint="На одну программу"
          />
        </div>
        <ChartCard className="mt-4" title="Выручка по программам" subtitle="Сумма по прейскуранту и число клиентов.">
          <div className="grid gap-2.5">
            {(() => {
              const maxAmount = Math.max(1, ...data.revenue.by_program.map((p) => p.amount));
              return data.revenue.by_program.map((p) => {
                const width = Math.round((p.amount / maxAmount) * 100);
                return (
                  <div key={p.package_id}>
                    <div className="mb-1 flex items-baseline justify-between gap-3">
                      <span className="min-w-0 flex-1 truncate text-[13px] text-[#9AABA2]" title={p.name}>
                        {p.name}
                      </span>
                      <span className="shrink-0 text-[12.5px] tabular-nums text-[#9AABA2]">
                        <span className="font-semibold text-[#E8EFEA]">{formatMoney(p.amount, data.revenue.currency)}</span>
                        <span className="ml-2">{p.count} чел.</span>
                      </span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[#3FA37A] to-[#8BC53F]"
                        style={{ width: `${Math.max(width > 0 ? 2 : 0, width)}%`, transition: "width .8s cubic-bezier(.22,.61,.36,1)" }}
                      />
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </ChartCard>
      </section>

      {/* Воронка */}
      <ChartCard
        className="mt-6"
        title="Путь клиента"
        subtitle="Доля от предыдущего шага и от первого шага. Отмечен самый большой отток."
      >
        <div className="grid gap-3">
          {funnelRows.map((row) => {
            const first = data.funnel[0]?.count || 1;
            const width = Math.max(row.count > 0 ? 6 : 2, Math.round((row.count / first) * 100));
            const isWorst = row.index === worstDropIndex;
            return (
              <div key={row.key}>
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[13.5px] text-[#9AABA2]">{row.label}</span>
                  <span className="text-[12.5px] tabular-nums text-[#9AABA2]">
                    <span className="font-semibold text-[#E8EFEA]">{formatCount(row.count)}</span>
                    {row.ofPrev !== null ? <span className="ml-2 text-[#8BC53F]">{formatPercent(row.ofPrev)} от пред.</span> : null}
                    {row.ofFirst !== null ? <span className="ml-2 text-[#9AABA2]">{formatPercent(row.ofFirst)} от старта</span> : null}
                  </span>
                </div>
                <div className="relative h-9 w-full overflow-hidden rounded-xl bg-white/[0.06]">
                  <div
                    className="flex h-full items-center rounded-xl bg-gradient-to-r from-[#3FA37A] to-[#8BC53F]"
                    style={{ width: `${width}%`, transition: "width .8s cubic-bezier(.22,.61,.36,1)" }}
                  />
                  {isWorst ? (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-[#F2B84B]/15 px-2 py-0.5 text-[11px] font-medium text-[#F2C97A]">
                      −{formatPercent(row.drop)} — крупнейший отток
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </ChartCard>

      {/* Конверсия в запись по сегментам */}
      <section className="mt-6">
        <h2 className={`${serifHeading} text-[22px] text-[#E8EFEA]`}>Конверсия в запись по сегментам</h2>
        <p className="mt-1 text-[13.5px] text-[#9AABA2]">
          Доля клиентов, дошедших до записи. Лучший сегмент выделен.
        </p>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <ChartCard title="Возраст">
            <SegmentRateBars data={data.segments.age} />
          </ChartCard>
          <ChartCard title="Пол">
            <SegmentRateBars data={data.segments.sex} />
          </ChartCard>
          <ChartCard title="Цель визита">
            <SegmentRateBars data={data.segments.reason} />
          </ChartCard>
        </div>
      </section>

      {/* Программы + факторы */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <ChartCard title="Популярные программы">
          <HBars
            data={data.programs.map((p) => ({ label: p.name, count: p.count }))}
            color={GREEN}
            denominator={data.programs.reduce((sum, p) => sum + p.count, 0)}
            showShare
          />
        </ChartCard>
        <ChartCard title="Что чаще всего влияет на подбор">
          <HBars
            data={data.factors.map((f) => ({ label: f.label, count: f.count }))}
            color="#2f7f5f"
          />
        </ChartCard>
      </div>

      {/* Когда записываются / Новые по неделям */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <ChartCard title="Когда записываются" subtitle="Приёмы по дням недели и часам, Пн–Пт, 09–17.">
          <Heatmap data={data.heatmap} />
        </ChartCard>
        <ChartCard title="Новые клиенты по неделям" subtitle="Сколько клиентов появлялось каждую неделю.">
          <ColumnChart
            data={data.weekly_clients.map((w) => ({
              label: formatWeekLabel(w.week),
              count: w.count,
              title: `${formatWeekLabel(w.week)}: ${w.count}`,
            }))}
            color={LIME}
          />
        </ChartCard>
      </div>

      {/* Этапы клиентов */}
      <ChartCard className="mt-6" title="Этапы клиентов" subtitle="Сколько клиентов сейчас на каждом этапе пути.">
        <SegmentedBar data={data.stages.filter((s) => s.count > 0).map((s) => ({ label: s.label, count: s.count }))} />
      </ChartCard>

      {/* Записи по дням */}
      <ChartCard className="mt-6" title="Записи по дням" subtitle="Приёмы терапевта на ближайший месяц.">
        <ColumnChart
          data={data.bookings_by_day.map((d) => {
            const dt = parseISO(`${d.date}T00:00:00Z`);
            const day = dt.getUTCDate();
            const wd = WEEKDAY_SHORT[dt.getUTCDay()];
            return { label: `${day}`, count: d.count, title: `${format(dt, "dd.MM.yyyy")} (${wd}): ${d.count}` };
          })}
          color={LIME}
          formatLabel={(label, i) => {
            const dt = parseISO(`${data.bookings_by_day[i].date}T00:00:00Z`);
            return (
              <span>
                {label}
                <span className="block text-[9px] text-[#9AABA2]">{WEEKDAY_SHORT[dt.getUTCDay()]}</span>
              </span>
            );
          }}
        />
      </ChartCard>

      {/* Демография */}
      <section className="mt-6">
        <h2 className={`${serifHeading} text-[22px] text-[#E8EFEA]`}>Демография и предпочтения</h2>
        <div className="mt-4 grid gap-4 lg:grid-cols-4">
          <ChartCard title="Какую программу рекомендуем">
            <Donut
              data={data.tiers.filter((t) => t.count > 0).map((t) => ({ label: t.label, count: t.count }))}
              centerValue={formatPercent(kpis.maximum_share)}
              centerLabel="«Максимальный»"
            />
          </ChartCard>
          <ChartCard title="Пол">
            <Donut
              data={data.sex.filter((s) => s.count > 0).map((s) => ({ label: s.label, count: s.count }))}
              centerValue={formatCount(data.sex.reduce((sum, s) => sum + s.count, 0))}
              centerLabel="ответов"
            />
          </ChartCard>
          <ChartCard title="Возраст">
            <ColumnChart data={data.age_groups.map((g) => ({ label: g.label, count: g.count }))} color={LIME} />
          </ChartCard>
          <ChartCard title="Язык">
            <Donut
              data={data.languages.filter((l) => l.count > 0).map((l) => ({ label: l.label, count: l.count }))}
              centerValue={formatCount(data.languages.reduce((sum, l) => sum + l.count, 0))}
              centerLabel="клиентов"
              size={140}
            />
          </ChartCard>
        </div>
      </section>

      {/* Per-question analytics */}
      <section className="mt-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className={`${serifHeading} text-[22px] text-[#E8EFEA]`}>Аналитика по вопросам</h2>
            <p className="mt-1 text-[13.5px] text-[#9AABA2]">
              Сколько людей видели каждый вопрос, отвечали и на каком уходили из анкеты.
            </p>
          </div>
          <div className="inline-flex rounded-xl border border-white/10 bg-[#0F1412] p-0.5">
            <button
              type="button"
              onClick={() => setQuestionFilter("all")}
              aria-pressed={questionFilter === "all"}
              className={`h-9 rounded-lg px-3 text-[13px] font-medium transition ${
                questionFilter === "all" ? "bg-white/[0.06] text-[#E8EFEA]" : "text-[#9AABA2] hover:text-[#E8EFEA]"
              }`}
            >
              Все
            </button>
            <button
              type="button"
              onClick={() => setQuestionFilter("high_drop")}
              aria-pressed={questionFilter === "high_drop"}
              className={`h-9 rounded-lg px-3 text-[13px] font-medium transition ${
                questionFilter === "high_drop" ? "bg-white/[0.06] text-[#E8EFEA]" : "text-[#9AABA2] hover:text-[#E8EFEA]"
              }`}
            >
              С большим уходом{highDropCount > 0 ? ` · ${highDropCount}` : ""}
            </button>
          </div>
        </div>

        {/* Reach sparkline across questions in order */}
        <ChartCard className="mt-4" title="Показы по вопросам" subtitle="Как падает охват от первого вопроса к последним.">
          <Sparkline
            points={data.questions.map((q) => q.views)}
            labels={data.questions.map((q) => q.label)}
          />
        </ChartCard>

        <div className="mt-4 grid gap-3">
          {questions.length === 0 ? (
            <p className="text-[14px] text-[#9AABA2]">Вопросов с большим уходом нет.</p>
          ) : (
            questions.map((q) => {
              const order = data.questions.findIndex((x) => x.id === q.id);
              const highDrop = (q.drop_off ?? 0) > 0.05;
              const isMulti = q.type === "multi";
              const sorted = [...q.options].sort((a, b) => b.count - a.count);
              return (
                <article key={q.id} className="rounded-2xl border border-white/[0.07] bg-[#18201C] p-5">
                  <div className="flex items-start gap-3">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#8BC53F]/15 text-[13px] font-semibold tabular-nums text-[#B9E07F]">
                      {order + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-[15px] font-semibold leading-snug text-[#E8EFEA]">{q.label}</h3>
                      {isMulti ? <p className="mt-0.5 text-[12px] text-[#9AABA2]">можно было выбрать несколько</p> : null}
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-2">
                    <MiniStat label="Показан" value={formatCount(q.views)} />
                    <MiniStat label="Ответили" value={formatCount(q.answered)} />
                    <MiniStat
                      label="Уход на вопросе"
                      value={formatPercent(q.drop_off)}
                      amber={highDrop}
                    />
                  </div>

                  {sorted.length ? (
                    <div className="mt-4">
                      <HBars
                        data={sorted.map((o) => ({ label: o.label, count: o.count, share: o.share }))}
                        color={GREEN}
                        showShare
                      />
                      <p className="mt-2 text-[11.5px] text-[#9AABA2]">Доля — от {q.respondents} ответивших.</p>
                    </div>
                  ) : null}
                </article>
              );
            })
          )}
        </div>
      </section>

      {/* i. Footer note */}
      <p className="mt-6 text-[12px] leading-relaxed text-[#9AABA2]">{data.note}</p>
    </div>
  );
}

function MiniStat({ label, value, amber = false }: { label: string; value: string; amber?: boolean }) {
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${amber ? "border-[#F2B84B]/30 bg-[#F2B84B]/[0.1]" : "border-white/[0.07] bg-white/[0.03]"}`}>
      <div className={`text-[17px] font-semibold tabular-nums ${amber ? "text-[#F2C97A]" : "text-[#E8EFEA]"}`}>{value}</div>
      <div className="mt-0.5 text-[11.5px] text-[#9AABA2]">{label}</div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-8 w-40 rounded-lg bg-white/[0.06]" />
      <div className="mt-2 h-4 w-72 rounded bg-white/[0.04]" />
      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-[86px] rounded-2xl border border-white/[0.07] bg-[#18201C]" />
        ))}
      </div>
      <div className="mt-6 h-56 rounded-2xl border border-white/[0.07] bg-[#18201C]" />
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-52 rounded-2xl border border-white/[0.07] bg-[#18201C]" />
        ))}
      </div>
      <div className="mt-4 h-64 rounded-2xl border border-white/[0.07] bg-[#18201C]" />
    </div>
  );
}
