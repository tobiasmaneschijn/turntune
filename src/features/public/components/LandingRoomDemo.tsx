import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { Pause, Play, RotateCcw, Users, VolumeX } from "lucide-react";

import type { ChatMessage } from "@/features/chat/model";
import { useEffectiveMotion, readEffectiveReducedMotion } from "@/hooks/use-effective-motion";
import type { SoundSpinUserSettings } from "@/features/settings/user-settings";
import type { RoomSnapshot, Track, User } from "@/types";
import type { SocketReply } from "@/lib/socket-request";
import { Avatar } from "@/components/Avatar";
import { ChatMessageItem } from "@/features/chat/components/chat-message";
import { MusicRail } from "@/features/music/components/MusicRail";
import { NowPlaying } from "@/features/playback/components/NowPlaying";
import { OpenRoomWorkspace } from "@/features/rooms/components/OpenRoomWorkspace";
import type { SoundCloudPlayer } from "@/features/playback/providers/SoundCloudPlayer";
import type { RoomPane } from "@/features/rooms/components/RoomPaneTabs";
import { Button } from "@/components/ui/button";

const YOU: User = { id: "landing-you", name: "You", avatarSeed: "landing-you", avatarKey: "sunset" };
const MIRA: User = { id: "landing-mira", name: "Mira", avatarSeed: "landing-mira", avatarKey: "orbit" };
const JONAS: User = { id: "landing-jonas", name: "Jonas", avatarSeed: "landing-jonas", avatarKey: "prism" };

// Illustrative metadata stays local: the demo never loads a catalog or music SDK.
const YOUR_TRACKS: Track[] = [
  { id: "landing-sunset", provider: "soundcloud", providerId: "landing-sunset", title: "Sunset Lover", artist: "Petit Biscuit", durationMs: 237000, addedBy: YOU, addedAt: 1 },
  { id: "landing-walk", provider: "soundcloud", providerId: "landing-walk", title: "A Walk", artist: "Tycho", durationMs: 317000, addedBy: YOU, addedAt: 2 },
];
const MIRA_TRACK: Track = { id: "landing-midnight", provider: "soundcloud", providerId: "landing-midnight", title: "Midnight City", artist: "M83", durationMs: 244000, addedBy: MIRA, addedAt: 0 };

const silentAction = (_event: string, _payload: unknown, reply: (result: SocketReply) => void) => reply({ ok: true });
const noop = () => {};

function demoSnapshot(step: number, you: User, roomName: string): RoomSnapshot {
  const yourTracks = YOUR_TRACKS.map(track => ({ ...track, addedBy: you }));
  const onAir = step >= 2;
  const track = onAir ? yourTracks[0] : MIRA_TRACK;
  const now = Date.now();
  return {
    room: {
      id: "landing-example-room", name: roomName, ownerUserId: MIRA.id,
      moderatorUserIds: [], djRoleUserIds: [], isPublic: false, passwordProtected: false,
      settings: { djAccess: "everyone", allowedProviders: ["soundcloud"], spotifyEnabled: false, songsPerTurn: 1, accessMode: "unlisted" },
      djUserId: onAir ? you.id : MIRA.id,
      djQueueUserIds: step === 0 ? [MIRA.id] : onAir ? [MIRA.id, you.id] : [you.id, MIRA.id],
      queue: onAir ? yourTracks.slice(1) : yourTracks,
      history: onAir ? [MIRA_TRACK] : [],
      playback: { track, playing: true, position: step === 0 ? 234 : step === 1 ? 239 : step === 2 ? 0 : 6, updatedAt: now, revision: onAir ? 2 : 1, origin: "dj" },
      vibe: { trackId: track.id, votes: step === 3 ? { [MIRA.id]: 1, [JONAS.id]: 1 } : {} },
      createdAt: 1,
    },
    users: [you, MIRA, JONAS],
    djUsers: step === 0 ? [MIRA] : [MIRA, you],
    serverTime: now,
  };
}

/** The production player receives measured local status, without loading audio. */
function SilentDemoPlayer({ playback, onStatus, syncRevision }: ComponentProps<typeof SoundCloudPlayer>) {
  useEffect(() => {
    onStatus({ ready: true, buffering: false, playing: playback.playing, currentTime: playback.position, duration: (playback.track?.durationMs || 0) / 1000, trackId: playback.track?.id });
  }, [playback, onStatus, syncRevision]);

  return null;
}
const DEMO_PLAYERS = { soundcloud: SilentDemoPlayer };

function DemoChat({ step, you }: { step: number; you: User }) {
  const { t } = useTranslation("public");
  const messages: ChatMessage[] = [
    { id: "landing-chat-1", user: MIRA, type: "text", content: t("landing.demo.chatNext"), createdAt: "2026-10-19T19:42:00Z" },
    ...(step >= 1 ? [{ id: "landing-chat-2", user: you, type: "text" as const, content: t("landing.demo.chatYou"), createdAt: "2026-10-19T19:43:00Z" }] : []),
    ...(step >= 3 ? [{ id: "landing-chat-3", user: JONAS, type: "text" as const, content: t("landing.demo.chatReaction"), createdAt: "2026-10-19T19:44:00Z" }] : []),
  ];

  return <aside className="chat panel landing-demo-chat" aria-label={t("roomChat")}>
    <div className="chat-header"><h2>{t("roomChat")}</h2><small>{t("listeners", { count: 3 })}</small></div>
    <div className="landing-demo-chat-messages chat-message-list">
      {messages.map(message => <ChatMessageItem key={message.id} message={message} currentUserId={YOU.id}
        isOwnMessage={message.user.id === YOU.id} showHeader isAuthorAppAdmin={false} isReplyAuthorAppAdmin={false}
        isHidden={false} isReplyHidden={false} participationDisabled
        onHiddenChange={noop} onReply={noop} onReact={noop} onJumpToMessage={noop} />)}
    </div>
  </aside>;
}

/** A guided example composed from the app's actual room components. */
export function LandingRoomDemo() {
  const { t } = useTranslation("public");
  const you = useMemo(() => ({ ...YOU, name: t("landing.demo.you") }), [t]);
  const steps = [
    { id: "queue", label: t("landing.demo.queueLabel"), pane: "radio", description: t("landing.demo.queueDescription") },
    { id: "join", label: t("landing.demo.joinLabel"), pane: "radio", description: t("landing.demo.joinDescription") },
    { id: "turn", label: t("landing.demo.turnLabel"), pane: "player", description: t("landing.demo.turnDescription") },
    { id: "reaction", label: t("landing.demo.reactionLabel"), pane: "player", description: t("landing.demo.reactionDescription") },
  ] as const;
  const reducedMotion = useEffectiveMotion();
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(() => !readEffectiveReducedMotion());
  const [replay, setReplay] = useState(0);
  const [inView, setInView] = useState(false);
  const [foreground, setForeground] = useState(() => document.visibilityState === "visible");
  const [activityContainer, setActivityContainer] = useState<HTMLDivElement | null>(null);
  const demoRef = useRef<HTMLElement>(null);
  const running = playing && inView && foreground;
  const snapshot = useMemo(() => demoSnapshot(step, you, t("sampleRoomName")), [step, replay, t, you]);
  const settings = useMemo<SoundSpinUserSettings>(() => ({
    playback: { preference: "source", defaultVolume: 80, spotifyDeviceId: "", fallback: "source", resumeAfterReconnect: false, compactPlayer: false },
    notifications: { backgroundOnly: true, djTurn: false, unavailableTrack: false, chatMentions: false, playbackErrors: false },
    appearance: { theme: "system", reducedMotion, artworkBlur: 0 },
  }), [reducedMotion]);

  useEffect(() => {
    if (reducedMotion) setPlaying(false);
  }, [reducedMotion]);

  useEffect(() => {
    const update = () => setForeground(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return () => document.removeEventListener("visibilitychange", update);
    }
    const observer = new IntersectionObserver(entries => setInView(entries[0]?.isIntersecting ?? false), { threshold: .15 });
    if (demoRef.current) observer.observe(demoRef.current);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", update); };
  }, []);

  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => {
      if (step === steps.length - 1) setPlaying(false);
      else setStep(current => current + 1);
    }, 5200);
    return () => window.clearTimeout(timer);
  }, [running, step, replay]);

  const chooseStep = (next: number) => { setPlaying(false); setStep(next); };
  const replayDemo = () => { setStep(0); setReplay(current => current + 1); setPlaying(!reducedMotion); };
  const togglePlayback = () => {
    if (!playing && step === steps.length - 1) { setStep(0); setReplay(current => current + 1); }
    setPlaying(current => !current);
  };

  return <section ref={demoRef} className="landing-room-demo" aria-label={t("exampleRoom")}
    data-step={steps[step].id} data-running={running}>
    <div className="landing-demo-toolbar">
      <div className="landing-demo-room"><strong>{t("sampleRoomName")}</strong><span>{t("landing.demo.noAudio")}</span></div>
      <div className="landing-demo-listeners" aria-label={t("listeners", { count: 3 })}>
        <Users size={15} aria-hidden="true" /><span>3</span>
        <div className="landing-demo-avatars">{snapshot.users.map(user => <Avatar key={user.id} user={user} size={26} />)}</div>
      </div>
      <div className="landing-demo-playback-controls">
        <Button type="button" variant="ghost" size="icon" aria-label={playing ? t("landing.demo.pause") : t("landing.demo.play")} onClick={togglePlayback}>
          {playing ? <Pause size={17} /> : <Play size={17} />}
        </Button>
        <Button type="button" variant="ghost" size="icon" aria-label={t("landing.demo.replay")} onClick={replayDemo}><RotateCcw size={17} /></Button>
      </div>
    </div>

    <div className="landing-demo-viewport open-room" inert>
      <OpenRoomWorkspace embedded value={steps[step].pane as RoomPane} onValueChange={noop}
        activityContainerRef={setActivityContainer} defaultLayout={{ activity: 22, chat: 51, radio: 27 }}
        radio={<MusicRail snapshot={snapshot} currentUserId={YOU.id} connected setNotice={noop} requestAction={silentAction}
          activityContainer={activityContainer} inlineAddMusic />}
        player={<div className="player-column"><NowPlaying snapshot={snapshot} currentUserId={YOU.id} isDj={step >= 2}
          canControlPlayback={step >= 2} roomConnected compact={false} onToggleCompact={noop}
          settingsOpen={false} onCloseSettings={noop} userSettings={settings} onUserSettingsChange={noop}
          isolatedPreview previewReactions={step === 3} onOpenQueue={noop} presentation="dock" requestAction={silentAction} providerPlayers={DEMO_PLAYERS} /></div>}
        chat={<DemoChat step={step} you={you} />} />
    </div>

    <div className="landing-demo-steps" role="group" aria-label={t("landing.demo.stepsLabel")}>
      {steps.map((item, index) => <button key={item.id} type="button" aria-pressed={step === index}
        onClick={() => chooseStep(index)}><span aria-hidden="true">{index + 1}</span>{item.label}</button>)}
    </div>
    <p className="landing-demo-caption" aria-live={playing ? "off" : "polite"} aria-atomic="true">
      <VolumeX size={14} aria-hidden="true" /><span>{steps[step].description}</span>
    </p>
  </section>;
}
