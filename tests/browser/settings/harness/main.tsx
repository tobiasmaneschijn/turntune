import { createRoot } from "react-dom/client";
import { useState } from "react";
import "@fontsource-variable/inter";
import "../../../../src/styles/shadcn.css";
import "../../../../src/styles/index.css";
import { ThemeProvider } from "../../../../src/components/theme-provider";
import { TooltipProvider } from "../../../../src/components/ui/tooltip";
import { Button } from "../../../../src/components/ui/button";
import { UserSettingsDialog } from "../../../../src/features/settings/UserSettingsDialog";
import { readUserSettings, saveUserSettings } from "../../../../src/features/settings/user-settings";

const parameters = new URLSearchParams(location.search);
const accountRequests: unknown[] = [];
Object.assign(window, { settingsAccountTest: { requests: accountRequests } });
globalThis.fetch = async (input, init) => {
  if (String(input).includes("/api/account/deletion-request")) {
    accountRequests.push(JSON.parse(String(init?.body)));
    return Response.json({ request: { id: "11111111-1111-4111-8111-111111111111" } }, { status: 202 });
  }
  return parameters.has("deviceError") ? Response.json({ error: "Could not load Spotify devices." }, { status: 503 }) : Response.json({ devices: [] });
};

function Harness() {
  const [settings, setSettings] = useState(readUserSettings);
  const [open, setOpen] = useState(true);
  return <main>
    <Button onClick={() => setOpen(true)}>Open settings</Button>
    <output className="sr-only" aria-label="Current settings">{JSON.stringify(settings)}</output>
    {open && <UserSettingsDialog spotifyEnabled={parameters.has("spotify")} roomSlug="fixture-room" settings={settings} connections={{ loaded: true, spotifyConfigured: true, spotifyConnected: true, appleConfigured: true }} accessToken="fixture"
      onSettingsChange={(value) => { setSettings(value); saveUserSettings(value); }} onConnectSpotify={() => {}} onDisconnectSpotify={() => {}} onClose={() => setOpen(false)} />}
  </main>;
}

createRoot(document.getElementById("root")!).render(<ThemeProvider><TooltipProvider><Harness /></TooltipProvider></ThemeProvider>);
