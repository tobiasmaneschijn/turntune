import { lazy, Suspense, type MouseEvent } from "react";
import { Trans, useTranslation } from "react-i18next";
import { ArrowDown, ArrowRight, ArrowUpRight, Check, Cloud, Server } from "lucide-react";

import { cn } from "@/lib/utils";
import { AppHeader } from "@/app/components/AppHeader";
import { Brand } from "@/components/app-primitives";
import { ThemeToggle } from "@/components/ThemeToggle";
import { buttonVariants } from "@/components/ui/button";

const LandingRoomDemo = lazy(() => import("./LandingRoomDemo").then(module => ({ default: module.LandingRoomDemo })));
const SELF_HOST_GUIDE = "https://github.com/tobiasmaneschijn/turntune#production";

interface LandingPageProps {
  onNavigate: (path: string) => void;
}

function navigateInsideApp(event: MouseEvent<HTMLAnchorElement>, path: string, onNavigate: (path: string) => void) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  onNavigate(path);
}

export function LandingPage({ onNavigate }: LandingPageProps) {
  const { t } = useTranslation("public");
  const cloudLink = (className?: string) => <a
    href="/login"
    className={cn(buttonVariants(), className)}
    onClick={event => navigateInsideApp(event, "/login", onNavigate)}
  >{t("landing.openCloud")} <ArrowRight data-icon="inline-end" /></a>;

  return <main className="landing-page">
    <AppHeader
      onHome={() => onNavigate("/")}
      navigation={<div className="landing-nav-links">
        <a href="#how-it-works">{t("howItWorks")}</a>
        <a href="#hosting">{t("landing.hostingNav")}</a>
        <a href="#faq">{t("landing.faqNav")}</a>
      </div>}
      publicActions={<>
        <ThemeToggle compact />
        <a href="/login" className={buttonVariants({ variant: "outline", size: "sm" })}
          onClick={event => navigateInsideApp(event, "/login", onNavigate)}>{t("signIn")}</a>
      </>}
    />

    <section className="landing-hero landing-width" id="main-content" tabIndex={-1} aria-labelledby="landing-title">
      <h1 id="landing-title"><span>{t("landing.mottoFirst")}</span><span><Trans t={t} i18nKey="landing.mottoSecond" components={{ emphasis: <em /> }} /></span></h1>
      <div className="landing-hero-copy">
        <p>{t("landing.intro")}</p>
        <div className="landing-hero-actions">
          {cloudLink()}
          <a href="#hosting" className={buttonVariants({ variant: "outline" })}>{t("landing.selfHost")} <ArrowDown data-icon="inline-end" /></a>
        </div>
        <a className="landing-demo-link" href="#how-it-works">{t("landing.watchDemo")} <ArrowDown size={16} aria-hidden="true" /></a>
      </div>
    </section>

    <section className="landing-demonstration landing-width" id="how-it-works" aria-label={t("landing.demoLabel")}>
      <Suspense fallback={<div className="landing-demo-loading" role="status">{t("landing.loadingDemo")}</div>}>
        <LandingRoomDemo />
      </Suspense>
    </section>

    <section className="landing-together landing-width" aria-labelledby="landing-together-title">
      <div className="landing-section-intro">
        <h2 id="landing-together-title"><Trans t={t} i18nKey="landing.togetherTitle" components={{ break: <br /> }} /></h2>
        <p>{t("landing.togetherIntro")}</p>
      </div>
      <dl className="landing-social-features">
        <div><dt>{t("landing.queueTitle")}</dt><dd>{t("landing.queueDescription")}</dd></div>
        <div><dt>{t("landing.chatTitle")}</dt><dd>{t("landing.chatDescription")}</dd></div>
        <div><dt>{t("landing.savedTitle")}</dt><dd>{t("landing.savedDescription")}</dd></div>
      </dl>
    </section>

    <section className="landing-hosting landing-width" id="hosting" aria-labelledby="landing-hosting-title">
      <div className="landing-section-intro"><h2 id="landing-hosting-title"><Trans t={t} i18nKey="landing.hostingTitle" components={{ break: <br /> }} /></h2></div>
      <div className="landing-hosting-options">
        <article className="landing-hosting-option">
          <h3><Cloud aria-hidden="true" /> {t("landing.cloudTitle")}</h3>
          <p>{t("landing.cloudDescription")}</p>
          <ul><li><Check aria-hidden="true" /> {t("landing.noServer")}</li><li><Check aria-hidden="true" /> {t("landing.cloudRooms")}</li></ul>
          <div className="landing-hosting-action">{cloudLink()}<span>{t("landing.haveInvite")} <a href="/sign-up" onClick={event => navigateInsideApp(event, "/sign-up", onNavigate)}>{t("signUpWithInvite")}</a></span></div>
        </article>
        <article className="landing-hosting-option">
          <h3><Server aria-hidden="true" /> {t("landing.selfHost")}</h3>
          <p>{t("landing.selfHostDescription")}</p>
          <ul><li><Check aria-hidden="true" /> {t("landing.dockerCompose")}</li><li><Check aria-hidden="true" /> {t("landing.manageServer")}</li></ul>
          <div className="landing-hosting-action"><a href={SELF_HOST_GUIDE} className={buttonVariants({ variant: "outline" })}>{t("landing.selfHostGuide")} <ArrowUpRight data-icon="inline-end" /></a><span>{t("landing.selfHostRequirements")}</span></div>
        </article>
      </div>
    </section>

    <section className="landing-faq landing-width" id="faq" aria-labelledby="landing-faq-title">
      <h2 id="landing-faq-title">{t("landing.faqTitle")}</h2>
      <div className="landing-faq-items">
        <details><summary>{t("landing.accountQuestion")}</summary><p>{t("landing.accountAnswer")}</p></details>
        <details><summary>{t("landing.turnQuestion")}</summary><p>{t("landing.turnAnswer")}</p></details>
        <details><summary>{t("landing.servicesQuestion")}</summary><p>{t("landing.servicesAnswer")}</p><p>{t("landing.matchingNote")}</p></details>
        <details><summary>{t("landing.selfHostQuestion")}</summary><p>{t("landing.selfHostAnswer")}</p><a href={SELF_HOST_GUIDE}>{t("landing.readSetup")} <ArrowUpRight size={14} aria-hidden="true" /></a></details>
      </div>
    </section>

    <section className="landing-close landing-width" aria-labelledby="landing-close-title">
      <h2 id="landing-close-title"><Trans t={t} i18nKey="landing.closeTitle" components={{ break: <br /> }} /></h2>
      <div className="landing-close-actions">{cloudLink()}<a href="#hosting">{t("landing.hostYourself")} <ArrowUpRight size={16} aria-hidden="true" /></a></div>
    </section>

    <footer className="landing-footer landing-width">
      <Brand />
      <div><a href={SELF_HOST_GUIDE}>{t("landing.selfHosting")}</a><a href="https://github.com/tobiasmaneschijn/turntune">{t("landing.github")}</a><small>{t("copyright", { year: new Date().getFullYear() })}</small></div>
    </footer>
  </main>;
}
