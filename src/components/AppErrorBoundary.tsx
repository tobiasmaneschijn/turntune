import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./ui/card";

export class AppErrorBoundary extends Component<{ children: ReactNode; onRetry?: () => void }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Lydman UI crashed", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="app-error-screen">
        <Card className="app-error-card">
          <CardHeader>
            <span className="app-error-icon"><AlertTriangle /></span>
            <CardTitle><h1>Something interrupted the session</h1></CardTitle>
            <CardDescription>The room is still safe. Reload the interface to reconnect.</CardDescription>
          </CardHeader>
          <CardContent>
            <code>{this.state.error.message}</code>
          </CardContent>
          <CardFooter className="gap-2">
            <Button onClick={() => { this.props.onRetry?.(); this.setState({ error: null }); }}><RefreshCw data-icon="inline-start" />Retry</Button>
            <Button variant="outline" onClick={() => location.assign("/")}><ArrowLeft data-icon="inline-start" />Back to rooms</Button>
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
          <CardTitle><h2>{this.props.panelName} needs reconnecting</h2></CardTitle>
          <CardDescription>The rest of the room is still available.</CardDescription>
        </CardHeader>
        <CardContent><code>{this.state.error.message}</code></CardContent>
        <CardFooter className="gap-2">
          <Button onClick={() => this.setState({ error: null })}><RefreshCw data-icon="inline-start" />Retry</Button>
          <Button variant="outline" onClick={() => location.assign("/")}>Back to rooms</Button>
        </CardFooter>
      </Card>
    );
  }
}
