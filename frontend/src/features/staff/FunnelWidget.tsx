import { useEffect, useState } from "react";
import { ApiClientError, api } from "@/api/client";
import type { Funnel } from "@/api/types";
import { formatRate } from "@/features/staff/format";

const STEPS: Array<{ key: string; label: string }> = [
  { key: "intake_started", label: "Старт анкеты" },
  { key: "intake_submitted", label: "Анкета отправлена" },
  { key: "recommendations_viewed", label: "Просмотр рекомендаций" },
  { key: "booking_opened", label: "Открыта запись" },
  { key: "appointment_requested", label: "Заявка на приём" },
  { key: "appointment_confirmed", label: "Подтверждённый приём" },
];

export function FunnelBars({ data }: { data: Funnel }) {
  const top = Math.max(1, ...STEPS.map((s) => data.counts[s.key] ?? 0));
  return (
    <div className="grid gap-3">
      {STEPS.map((step, index) => {
        const value = data.counts[step.key] ?? 0;
        const prev = index === 0 ? null : data.counts[STEPS[index - 1].key] ?? 0;
        const conversion = prev && prev > 0 ? value / prev : null;
        const width = Math.max(2, Math.round((value / top) * 100));
        return (
          <div key={step.key}>
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="text-[13.5px] text-[#9AABA2]">{step.label}</span>
              <span className="text-[13px] tabular-nums text-[#9AABA2]">
                <span className="font-semibold text-[#E8EFEA]">{value}</span> сессий
                {conversion !== null ? <span className="ml-2 text-[#8BC53F]">↳ {formatRate(conversion)}</span> : null}
              </span>
            </div>
            <div className="h-8 w-full overflow-hidden rounded-lg bg-white/[0.06]">
              <div
                className="h-full rounded-lg bg-gradient-to-r from-[#3FA37A] to-[#8BC53F] transition-[width]"
                style={{ width: `${width}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Compact funnel card retained for reuse; unit is sessions. */
export function FunnelWidget() {
  const [data, setData] = useState<Funnel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void api
      .funnel()
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiClientError ? err.message : "Не удалось загрузить воронку");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <p className="text-[14px] text-[#9AABA2]">Загрузка воронки…</p>;
  if (error) return <p className="text-[14px] text-[#F07167]">{error}</p>;
  if (!data) return null;
  return <FunnelBars data={data} />;
}
