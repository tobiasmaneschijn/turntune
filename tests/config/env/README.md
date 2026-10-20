Browser fixture servers use this empty environment directory in Vite test mode.
They load public Auth configuration through mocked `/api/config` and never read
the developer's `.env` files or inherited `VITE_` application credentials.
Unmocked `/api` and `/socket.io` requests receive a local no-store 503 response;
test mode has no API proxy to another application running on localhost. The
Vite-isolation regression starts a controlled upstream and verifies zero calls.
Live staging suites use their explicit configuration and are a separate gate.

The fixture trace keeps test sources and API-call events; a screenshot is saved
only on failure. Continuous trace screenshots and large DOM snapshots are
disabled to avoid repeated paints of crowded chat timelines. Playwright also disables network
HAR when DOM snapshots are disabled. For a targeted investigation that needs
DOM/network snapshots, run the relevant fixture with `--trace=retain-on-failure`
and one worker; never include live credentials in those artifacts.
