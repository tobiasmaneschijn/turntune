import assert from "node:assert/strict";
import test from "node:test";
import { GiphyApi } from "./giphy.js";

test("GiphyApi loads trending GIFs through the server", async () => {
  let requestedUrl = "";
  const api = new GiphyApi("test-key", async (input) => {
    requestedUrl = String(input);
    return Response.json({
      data: [{
        id: "gif-1",
        title: "Dancing",
        images: {
          fixed_width: { url: "https://media.giphy.com/full.gif" },
          fixed_width_small: { url: "https://media.giphy.com/preview.gif" }
        }
      }]
    });
  });

  assert.deepEqual(await api.gifs(), [{
    id: "gif-1",
    title: "Dancing",
    url: "https://media.giphy.com/full.gif",
    preview: "https://media.giphy.com/preview.gif"
  }]);
  const url = new URL(requestedUrl);
  assert.equal(url.pathname, "/v1/gifs/trending");
  assert.equal(url.searchParams.get("api_key"), "test-key");
  assert.equal(url.searchParams.get("limit"), "18");
});

test("GiphyApi searches trimmed queries and reports upstream errors", async () => {
  let requestedUrl = "";
  const api = new GiphyApi("test-key", async (input) => {
    requestedUrl = String(input);
    return Response.json({ meta: { msg: "Invalid authentication credentials" } }, { status: 403 });
  });

  await assert.rejects(() => api.gifs("  party time  "), /Invalid authentication credentials/);
  const url = new URL(requestedUrl);
  assert.equal(url.pathname, "/v1/gifs/search");
  assert.equal(url.searchParams.get("q"), "party time");
});

test("GiphyApi is disabled without a server key", async () => {
  const api = new GiphyApi("");
  assert.equal(api.configured, false);
  await assert.rejects(() => api.gifs(), /not configured/);
});
