import i18n from "../../i18n";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "../../components/ui/card";

export class AppErrorBoundary extends Component<{ children: ReactNode; onRetry?: () => void }, { error: Error | null }> {
  state = { error: null as Error | null };

  private updateLanguage = () => this.forceUpdate();
  componentDidMount() { i18n.on("languageChanged", this.updateLanguage); }
  componentWillUnmount() { i18n.off("languageChanged", this.updateLanguage); }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("turntune UI crashed", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="app-error-screen">
        <Card className="app-error-card">
          <CardHeader>
            <span className="app-error-icon"><AlertTriangle /></span>
            <CardTitle><h1>{i18n.t("public:appLoadError")}</h1></CardTitle>
          </CardHeader>
          <CardContent>
            <code>{this.state.error.message}</code>
          </CardContent>
          <CardFooter className="gap-2">
            <Button onClick={() => { this.props.onRetry?.(); this.setState({ error: null }); }}><RefreshCw data-icon="inline-start" />{i18n.t("public:retry")}</Button>
            <Button variant="outline" onClick={() => location.assign("/")}><ArrowLeft data-icon="inline-start" />{i18n.t("public:backToRooms")}</Button>
          </CardFooter>
        </Card>
      </main>
    );
  }
}

export class PanelErrorBoundary extends Component<
  { children: ReactNode; panelName: string },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  private updateLanguage = () => this.forceUpdate();
  componentDidMount() { i18n.on("languageChanged", this.updateLanguage); }
  componentWillUnmount() { i18n.off("languageChanged", this.updateLanguage); }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`${this.props.panelName} panel crashed`, error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <Card className="panel-error-card">
        <CardHeader>
          <span className="app-error-icon"><AlertTriangle /></span>
          <CardTitle><h2>{i18n.t("public:panelLoadError", { panel: this.props.panelName })}</h2></CardTitle>
        </CardHeader>
        <CardContent><code>{this.state.error.message}</code></CardContent>
        <CardFooter className="gap-2">
          <Button onClick={() => this.setState({ error: null })}><RefreshCw data-icon="inline-start" />{i18n.t("public:retry")}</Button>
          <Button variant="outline" onClick={() => location.assign("/")}>{i18n.t("public:backToRooms")}</Button>
        </CardFooter>
      </Card>
    );
  }
}
