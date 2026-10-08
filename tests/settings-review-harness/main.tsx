import { createRoot } from "react-dom/client";
import { useState } from "react";
import "@fontsource-variable/geist";
import "../../src/shadcn.css";
import "../../src/styles.css";
import { ThemeProvider } from "../../src/components/theme-provider";
import { TooltipProvider } from "../../src/components/ui/tooltip";
import { Button } from "../../src/components/ui/button";
import { UserSettingsDialog } from "../../src/components/UserSettingsDialog";
import { readUserSettings, saveUserSettings } from "../../src/playback-settings";

const parameters = new URLSearchParams(location.search);
globalThis.fetch = async () => parameters.has("deviceError")
  ? Response.json({ error: "Could not load Spotify devices." }, { status: 503 })
  : Response.json({ devices: [] });

function Harness() {
  const [settings, setSettings] = useState(readUserSettings);
  const [open, setOpen] = useState(true);
  return <main>
    <Button onClick={() => setOpen(true)}>Open settings</Button>
    <output className="sr-only" aria-label="Current settings">{JSON.stringify(settings)}</output>
    {open && <UserSettingsDialog settings={settings} connections={{ loaded: true, spotifyConfigured: true, spotifyConnected: true, appleConfigured: true }} accessToken="fixture"
      onSettingsChange={(value) => { setSettings(value); saveUserSettings(value); }} onConnectSpotify={() => {}} onDisconnectSpotify={() => {}} onClose={() => setOpen(false)} />}
  </main>;
}

createRoot(document.getElementById("root")!).render(<ThemeProvider><TooltipProvider><Harness /></TooltipProvider></ThemeProvider>);
