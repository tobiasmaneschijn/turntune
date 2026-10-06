import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(error: Error, details: ErrorInfo) {
    console.error("The app could not render this screen.", error, details.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="room-access-screen">
        <Card className="room-access-error">
          <CardHeader>
            <CardTitle>This screen could not be loaded</CardTitle>
            <CardDescription>Reload the app to reconnect to your room.</CardDescription>
          </CardHeader>
          <CardContent><Button onClick={() => location.reload()}>Reload app</Button></CardContent>
        </Card>
      </main>
    );
  }
}
