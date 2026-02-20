import { useState, useEffect } from "react";

export type Theme = "dark" | "light";

function getTheme(): Theme {
  return document.documentElement.classList.contains("light") ? "light" : "dark";
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getTheme);

  useEffect(() => {
    const sync = () => setTheme(getTheme());
    window.addEventListener("theme-change", sync);
    return () => window.removeEventListener("theme-change", sync);
  }, []);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    localStorage.setItem("theme", next);
    if (next === "light") {
      document.documentElement.classList.add("light");
    } else {
      document.documentElement.classList.remove("light");
    }
    window.dispatchEvent(new Event("theme-change"));
  };

  return { theme, toggle };
}
