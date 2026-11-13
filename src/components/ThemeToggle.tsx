import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

export type Theme = "dark" | "light";
export const THEME_KEY = "churnhound-theme";
/** Runs before paint so the page never flashes the wrong theme. */
export const themeInitScript = `try{var t=localStorage.getItem("${THEME_KEY}");document.documentElement.classList.toggle("dark",t!=="light")}catch(e){}`;

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>("dark");
  useEffect(() => {
    setThemeState(document.documentElement.classList.contains("dark") ? "dark" : "light");
    const onChange = () =>
      setThemeState(document.documentElement.classList.contains("dark") ? "dark" : "light");
    window.addEventListener("themechange", onChange);
    return () => window.removeEventListener("themechange", onChange);
  }, []);
  const setTheme = (t: Theme) => {
    document.documentElement.classList.toggle("dark", t === "dark");
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch {
      /* private mode */
    }
    window.dispatchEvent(new Event("themechange"));
  };
  return [theme, setTheme];
}

export function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
