import { useTranslation } from "react-i18next";
import { Laptop, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "./ui/button";
import { readUserSettings, saveUserSettings, type ThemeMode } from "../playback-settings";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "./ui/dropdown-menu";

const modes = [
  { value: "dark", label: "themeDark", icon: Moon },
  { value: "light", label: "themeLight", icon: Sun },
  { value: "system", label: "themeSystem", icon: Laptop }
] as const;

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation("public");
  const { theme = "dark" } = useTheme();
  const active = modes.find((mode) => mode.value === theme) || modes[0];
  const ActiveIcon = active.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size={compact ? "icon" : "sm"} aria-label={t("changeTheme")} />
        }
      >
        <ActiveIcon data-icon={compact ? undefined : "inline-start"} />
        {!compact && <span>{t("theme")}</span>}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("appearance")}</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <ThemeMenuItems />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ThemeMenuItems() {
  const { t } = useTranslation("public");
  const { theme = "dark", setTheme } = useTheme();
  const changeTheme = (value: string) => {
    if (!modes.some(mode => mode.value === value)) return;
    const nextTheme = value as ThemeMode;
    setTheme(nextTheme);
    const settings = readUserSettings();
    saveUserSettings({ ...settings, appearance: { ...settings.appearance, theme: nextTheme } });
    window.dispatchEvent(new CustomEvent("soundspin:theme-change", { detail: nextTheme }));
  };
  return <DropdownMenuRadioGroup value={theme} onValueChange={changeTheme}>{modes.map(mode => {
    const Icon = mode.icon;
    return <DropdownMenuRadioItem key={mode.value} value={mode.value} closeOnClick><Icon />{t(mode.label)}</DropdownMenuRadioItem>;
  })}</DropdownMenuRadioGroup>;
}
