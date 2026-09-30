/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        primary: "var(--primary)",
        ink: "var(--text)",
        muted: "var(--muted-text)",
        line: "var(--border)",
        surface: "var(--surface-muted)",
        selected: "var(--selected-background)",
      },
      borderRadius: {
        card: "16px",
        control: "10px",
      },
    },
  },
  plugins: [],
};
