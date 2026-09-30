import { setUiLang, useUiLang, type UiLang } from "@/features/patient-home/welcome";

const OPTIONS: Array<{ value: UiLang; label: string; aria: string }> = [
  { value: "kz", label: "KZ", aria: "Қазақша" },
  { value: "ru", label: "RU", aria: "Русский" },
];

/** iOS-style segmented control with a sliding thumb. Changes copy only, never the URL. */
export function LangSegment() {
  const lang = useUiLang();
  const index = OPTIONS.findIndex((o) => o.value === lang);
  return (
    <div
      role="radiogroup"
      aria-label="Язык / Тіл"
      className="relative grid h-11 grid-cols-2 rounded-full border border-[#03392D]/10 bg-white/70 p-1 backdrop-blur-xl"
    >
      <span
        aria-hidden
        className="absolute bottom-1 left-1 top-1 w-[calc(50%-4px)] rounded-full bg-[#03392D] shadow-[0_4px_12px_rgba(3,57,45,.25)] transition-transform duration-[240ms] ease-[cubic-bezier(.32,.72,0,1)] motion-reduce:transition-none"
        style={{ transform: `translateX(${index * 100}%)` }}
      />
      {OPTIONS.map((option) => {
        const active = option.value === lang;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.aria}
            onClick={() => setUiLang(option.value)}
            className={`relative z-10 w-12 rounded-full text-[13px] font-semibold tracking-[0.06em] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8BC53F] ${
              active ? "text-white" : "text-[#03392D]/55 hover:text-[#03392D]"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
