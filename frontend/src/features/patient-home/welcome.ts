import { useSyncExternalStore } from "react";

export type UiLang = "ru" | "kz";

type WelcomeProfile = {
  name: string;
  phone: string;
  lang: UiLang;
};

const LANG_KEY = "gc.lang";

/** Russian by default; a language the user picked in this tab wins. */
export function detectUiLang(): UiLang {
  if (typeof window !== "undefined") {
    const saved = window.sessionStorage.getItem(LANG_KEY);
    if (saved === "ru" || saved === "kz") return saved;
  }
  return "ru";
}

export function applyDocumentLang(lang: UiLang) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = lang === "kz" ? "kk" : "ru";
  document.documentElement.setAttribute("translate", "no");
}

let profile: WelcomeProfile = {
  name: "",
  phone: "",
  lang: detectUiLang(),
};

const langListeners = new Set<() => void>();

export function setWelcomeProfile(next: WelcomeProfile) {
  const langChanged = next.lang !== profile.lang;
  profile = next;
  if (langChanged) langListeners.forEach((l) => l());
}

export function getWelcomeProfile(): WelcomeProfile {
  return profile;
}

/** Shared UI language: survives navigation and refresh (sessionStorage, no medical data). */
export function setUiLang(lang: UiLang) {
  if (lang === profile.lang) return;
  profile = { ...profile, lang };
  if (typeof window !== "undefined") window.sessionStorage.setItem(LANG_KEY, lang);
  applyDocumentLang(lang);
  langListeners.forEach((l) => l());
}

export function useUiLang(): UiLang {
  return useSyncExternalStore(
    (listener) => {
      langListeners.add(listener);
      return () => langListeners.delete(listener);
    },
    () => profile.lang,
    () => profile.lang,
  );
}

export const welcomeCopy = {
  ru: {
    helloTop: "Здравствуйте,",
    helloBottom: "с вами Green Clinic!",
    sub: "Подберём программу чек-ап и запишем к терапевту в удобное время.",
    book: "Записаться на чек-ап",
    login: "Войти в кабинет",
    staff: "Для сотрудников клиники",
    cabinet: "Мой кабинет",
    progress: (answered: number, total: number) => `${answered} из ${total}`,
    back: "Назад",
    next: "Далее",
    // login
    loginTitle: "Вход в кабинет",
    loginSub: "Введите номер, который указывали при записи.",
    phone: "Телефон",
    getCode: "Получить код",
    codeTitle: "Код из СМС",
    codeSub: (phone: string) => `Отправили на ${phone}`,
    enter: "Войти",
    changePhone: "Изменить номер",
    close: "Закрыть",
    guest: "Гость",
    logout: "Выйти",
    toCabinet: "Кабинет",
    toLogin: "Войти",
    errPhone: "Проверьте номер телефона",
    errCode: "Неверный код",
    errCodeExpired: "Код устарел",
    errAttempts: "Слишком много попыток. Запросите новый код",
    errCooldown: "Слишком часто. Подождите немного",
    errLimit: "Много запросов. Попробуйте позже",
    errNotFound: "Номер не найден. Запишитесь на чек-ап — кабинет создастся автоматически",
    errGeneric: "Не удалось войти. Попробуйте ещё раз",
    toIntake: "Записаться на чек-ап",
    resendIn: (mmss: string) => `Повторный код через ${mmss}`,
    resend: "Отправить код ещё раз",
  },
  kz: {
    helloTop: "Сәлеметсіз бе,",
    helloBottom: "Green Clinic-ке қош келдіңіз!",
    sub: "Чек-ап бағдарламасын таңдап, терапевтке ыңғайлы уақытқа жазамыз.",
    book: "Чек-апқа жазылу",
    login: "Кабинетке кіру",
    staff: "Клиника қызметкерлеріне",
    cabinet: "Менің кабинетім",
    progress: (answered: number, total: number) => `${answered} / ${total}`,
    back: "Артқа",
    next: "Әрі қарай",
    loginTitle: "Кабинетке кіру",
    loginSub: "Жазылу кезінде көрсеткен нөміріңізді енгізіңіз.",
    phone: "Телефон",
    getCode: "Код алу",
    codeTitle: "СМС коды",
    codeSub: (phone: string) => `${phone} нөміріне жібердік`,
    enter: "Кіру",
    changePhone: "Нөмірді өзгерту",
    close: "Жабу",
    guest: "Қонақ",
    logout: "Шығу",
    toCabinet: "Кабинет",
    toLogin: "Кіру",
    errPhone: "Телефон нөмірін тексеріңіз",
    errCode: "Код қате",
    errCodeExpired: "Кодтың мерзімі өтті",
    errAttempts: "Тым көп әрекет. Жаңа код сұраңыз",
    errCooldown: "Тым жиі. Сәл күте тұрыңыз",
    errLimit: "Сұраныс көп. Кейінірек көріңіз",
    errNotFound: "Нөмір табылмады. Чек-апқа жазылыңыз — кабинет автоматты түрде ашылады",
    errGeneric: "Кіру мүмкін болмады. Қайталап көріңіз",
    toIntake: "Чек-апқа жазылу",
    resendIn: (mmss: string) => `Қайта код ${mmss} кейін`,
    resend: "Кодты қайта жіберу",
  },
} as const;
