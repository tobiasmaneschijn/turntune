import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { useEffect, type ComponentProps } from "react";

export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
      storageKey="soundspin-theme"
      {...props}
    >
      <ThemeEffects />
      {children}
    </NextThemesProvider>
  );
}

function ThemeEffects() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    themeColor?.setAttribute("content", resolvedTheme === "light" ? "#ffffff" : "#18181b");
  }, [resolvedTheme]);

  return null;
}
