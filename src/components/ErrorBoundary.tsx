import i18n from "../i18n";
import { Component, type ReactNode } from "react";
import { telemetry } from "../../shared/observability";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  private updateLanguage = () => this.forceUpdate();
  componentDidMount() { i18n.on("languageChanged", this.updateLanguage); }
  componentWillUnmount() { i18n.off("languageChanged", this.updateLanguage); }

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(error: Error) {
    telemetry.captureError(error, { operation: "browser.render.screen" });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="room-access-screen">
        <Card className="room-access-error">
          <CardHeader>
            <CardTitle>{i18n.t("public:screenLoadError")}</CardTitle>
          </CardHeader>
          <CardContent><Button onClick={() => location.reload()}>{i18n.t("public:reloadApp")}</Button></CardContent>
        </Card>
      </main>
    );
  }
}
