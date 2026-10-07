// Child-process integration instrumentation; production never imports this file.
const actualFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.origin === "https://www.youtube.com" && url.pathname === "/oembed") {
    const recording = new URL(url.searchParams.get("url")!).searchParams.get("v");
    if (recording === "unavailable") return Response.json({}, { status: 404 });
    return Response.json({ title: `Verified ${recording}`, author_name: "Fixture artist" });
  }
  return actualFetch(input, init);
};
