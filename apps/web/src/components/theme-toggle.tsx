"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
    setReady(true);
  }, []);

  function toggleTheme() {
    const nextTheme: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", nextTheme === "dark" ? "#030303" : "#f6f8ff");
    window.localStorage.setItem("bluefun-theme", nextTheme);
    window.dispatchEvent(new CustomEvent("bluefun-theme-change", { detail: nextTheme }));
    setTheme(nextTheme);
  }

  return (
    <button
      aria-label={ready ? `Switch to ${theme === "dark" ? "light" : "dark"} mode` : "Toggle color theme"}
      className="theme-toggle"
      data-theme-ready={ready ? "true" : "false"}
      onClick={toggleTheme}
      title={theme === "dark" ? "Light mode" : "Dark mode"}
      type="button"
    >
      <Sun className="theme-icon-light" size={17} />
      <Moon className="theme-icon-dark" size={17} />
    </button>
  );
}
