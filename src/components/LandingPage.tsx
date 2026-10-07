import type { MouseEvent } from "react";
import {
  ArrowRight,
  Headphones,
  Link2,
  ListMusic,
  MessageCircle,
  Music2,
  Radio,
  Share2,
  Waves
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { User } from "@/types";
import { Avatar } from "@/components/Avatar";
import { Brand } from "@/components/app-primitives";
import { AppVersion } from "@/components/AppVersion";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";

interface LandingPageProps {
  onNavigate: (path: string) => void;
}

const SAMPLE_USERS: User[] = [
  { id: "maya", name: "Maya", avatarSeed: "maya", avatarKey: "sunset", isAppAdmin: false },
  { id: "noah", name: "Noah", avatarSeed: "noah", avatarKey: "orbit", isAppAdmin: false },
  { id: "liv", name: "Liv", avatarSeed: "liv", avatarKey: "prism", isAppAdmin: false },
  { id: "leo", name: "Leo", avatarSeed: "leo", avatarKey: "voltage", isAppAdmin: false }
];

const BENEFITS = [
  {
    icon: Waves,
    title: "Synchronized playback"
  },
  {
    icon: ListMusic,
    title: "DJ turns"
  },
  {
    icon: MessageCircle,
    title: "Room chat"
  }
];

const STEPS = [
  {
    icon: Headphones,
    title: "Create a room"
  },
  {
    icon: Share2,
    title: "Share the room link"
  },
  {
    icon: Radio,
    title: "Add songs and take turns"
  }
];

function navigateInsideApp(
  event: MouseEvent<HTMLAnchorElement>,
  path: string,
  onNavigate: (path: string) => void
) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) return;

  event.preventDefault();
  onNavigate(path);
}

export function LandingPage({ onNavigate }: LandingPageProps) {
  return (
    <main className="landing-page">
      <div className="landing-backdrop" aria-hidden="true">
        <span className="landing-glow landing-glow-violet" />
        <span className="landing-glow landing-glow-cyan" />
      </div>

      <header className="landing-header">
        <nav className="landing-nav" aria-label="Main navigation">
          <a
            className="landing-brand-link"
            href="/"
            aria-label="Lydman home"
            onClick={(event) => navigateInsideApp(event, "/", onNavigate)}
          >
            <Brand />
          </a>
          <div className="landing-nav-links">
            <a href="#features">Features</a>
            <a href="#how-it-works">How it works</a>
          </div>
          <div className="landing-nav-actions">
            <a
              href="/login"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "landing-nav-sign-in")}
              onClick={(event) => navigateInsideApp(event, "/login", onNavigate)}
            >
              Sign in
            </a>
            <a
              href="/sign-up"
              className={buttonVariants({ size: "sm" })}
              onClick={(event) => navigateInsideApp(event, "/sign-up", onNavigate)}
            >
              Sign up
            </a>
          </div>
        </nav>
      </header>

      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-hero-copy">
          <h1 id="landing-title">Listen together.</h1>
          <p>
            Share a room, queue songs, and take turns as DJ.
          </p>
          <div className="landing-hero-actions">
            <a
              href="/sign-up"
              className={buttonVariants({ size: "lg" })}
              onClick={(event) => navigateInsideApp(event, "/sign-up", onNavigate)}
            >
              Create a room <ArrowRight data-icon="inline-end" />
            </a>
            <a
              href="/login"
              className={buttonVariants({ variant: "outline", size: "lg" })}
              onClick={(event) => navigateInsideApp(event, "/login", onNavigate)}
            >
              Sign in
            </a>
          </div>
          <p className="landing-invite-note"><Link2 aria-hidden="true" /> Invite required to create an account.</p>
        </div>

        <div className="landing-preview-stage">
          <span className="landing-reaction landing-reaction-heart" aria-hidden="true">♥</span>
          <span className="landing-reaction landing-reaction-fire" aria-hidden="true">🔥</span>
          <Card className="landing-preview" aria-label="Preview of a Lydman listening room">
            <CardHeader className="landing-preview-header">
              <div>
                <CardTitle>Friday night radio</CardTitle>
                <CardDescription><span className="landing-live-dot" /> 6 listening now</CardDescription>
              </div>
              <div className="landing-avatar-stack" aria-label="Maya, Noah, Liv, and Leo are listening">
                {SAMPLE_USERS.map((user) => <Avatar key={user.id} user={user} size={30} />)}
                <span className="landing-avatar-more" aria-hidden="true">+2</span>
              </div>
            </CardHeader>
            <CardContent className="landing-preview-content">
              <section className="landing-now-playing" aria-label="Now playing Afterglow by Night Drive">
                <div className="landing-album-art" aria-hidden="true">
                  <Music2 />
                  <span className="landing-album-orbit" />
                </div>
                <div className="landing-track-copy">
                  <span className="landing-preview-label">Now playing</span>
                  <strong>Afterglow</strong>
                  <small>Night Drive</small>
                  <div className="landing-track-progress" aria-hidden="true"><span /></div>
                  <div className="landing-track-time" aria-hidden="true"><span>1:48</span><span>3:36</span></div>
                </div>
                <div className="landing-equalizer" aria-label="Playing">
                  <i /><i /><i /><i />
                </div>
              </section>

              <div className="landing-preview-columns">
                <section className="landing-preview-panel" aria-labelledby="landing-queue-title">
                  <div className="landing-preview-panel-heading">
                    <span id="landing-queue-title">Up next</span>
                    <Badge variant="secondary">Maya&apos;s turn</Badge>
                  </div>
                  <ol className="landing-queue">
                    <li><span>01</span><div><strong>Velvet Sky</strong><small>Solar Echo</small></div><Avatar user={SAMPLE_USERS[0]} size={24} /></li>
                    <li><span>02</span><div><strong>City Lights</strong><small>June Arcade</small></div><Avatar user={SAMPLE_USERS[1]} size={24} /></li>
                  </ol>
                </section>

                <section className="landing-preview-panel" aria-labelledby="landing-chat-title">
                  <div className="landing-preview-panel-heading">
                    <span id="landing-chat-title">Room chat</span>
                    <MessageCircle aria-hidden="true" />
                  </div>
                  <div className="landing-chat-preview">
                    <div><Avatar user={SAMPLE_USERS[2]} size={24} /><p><strong>Liv</strong><span>Love this intro</span></p></div>
                    <div><Avatar user={SAMPLE_USERS[3]} size={24} /><p><strong>Leo</strong><span>Wait for the drop</span></p></div>
                  </div>
                </section>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="landing-providers" aria-labelledby="landing-providers-title">
        <div>
          <h2 id="landing-providers-title">Music services</h2>
        </div>
        <div className="landing-provider-list" aria-label="Supported music services">
          {["YouTube", "SoundCloud", "Spotify", "Apple Music"].map((provider) => (
            <Badge variant="outline" key={provider}><Music2 data-icon="inline-start" /> {provider}</Badge>
          ))}
        </div>
      </section>

      <section className="landing-section landing-features" id="features" aria-labelledby="landing-features-title">
        <div className="landing-section-heading">
          <h2 id="landing-features-title">Features</h2>
        </div>
        <div className="landing-feature-grid">
          {BENEFITS.map(({ icon: Icon, title }) => (
            <Card className="landing-feature-card" key={title}>
              <CardHeader>
                <span className="landing-feature-icon"><Icon aria-hidden="true" /></span>
                <CardTitle>{title}</CardTitle>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      <section className="landing-section landing-how" id="how-it-works" aria-labelledby="landing-how-title">
        <div className="landing-section-heading">
          <h2 id="landing-how-title">How it works</h2>
        </div>
        <ol className="landing-step-grid">
          {STEPS.map(({ icon: Icon, title }, index) => (
            <li key={title}>
              <span className="landing-step-number">0{index + 1}</span>
              <span className="landing-step-icon"><Icon aria-hidden="true" /></span>
              <div><h3>{title}</h3></div>
            </li>
          ))}
        </ol>
      </section>

      <footer className="landing-footer">
        <Brand />
        <div className="landing-footer-meta">
          <AppVersion />
          <small>© {new Date().getFullYear()} Lydman</small>
        </div>
      </footer>
    </main>
  );
}
