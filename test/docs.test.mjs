import test from "node:test";
import assert from "node:assert/strict";
import { helpPages } from "../dist/tools/docs.js";

// Two platform sets share one index; Android slugs carry their directory,
// which is what lets helpPage() fetch them without any path logic.
const INDEX = {
  base_url: "https://atimelogger.pro/docs/",
  note: "two platform sets",
  pages: [
    { slug: "pomodoro", title: "Pomodoro", summary: "p", platform: "ios" },
    { slug: "sync", title: "Sync", summary: "s", platform: "ios" },
    { slug: "android/pomodoro", title: "Pomodoro (Android)", summary: "p", platform: "android" },
    { slug: "android/sync", title: "Sync (Android)", summary: "s", platform: "android" },
  ],
};

const PAGE = [
  "# Pomodoro",
  "",
  "See [Sync](sync.md) and [one section](sync.md#setting-up).",
  "Also [the site](https://atimelogger.pro/), [an anchor](#here) and ![shot](images/a.png).",
].join("\n");

function stubFetch() {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    text: async () =>
      String(url).endsWith("help-index.json") ? JSON.stringify(INDEX) : PAGE,
  });
  return () => { globalThis.fetch = real; };
}

test("a cross-reference inside an Android page resolves to the Android page", async () => {
  const restore = stubFetch();
  try {
    const md = await helpPages(["android/pomodoro"]);
    assert.match(md, /\]\(android\/sync\.md\)/, "bare .md link gains the platform directory");
    assert.match(md, /\]\(android\/sync\.md#setting-up\)/, "the #fragment survives");
    assert.match(md, /\]\(https:\/\/atimelogger\.pro\/\)/, "absolute links untouched");
    assert.match(md, /\]\(#here\)/, "pure anchors untouched");
    assert.match(md, /\]\(images\/a\.png\)/, "non-markdown targets untouched");
  } finally { restore(); }
});

test("an iOS page keeps its bare cross-references", async () => {
  const restore = stubFetch();
  try {
    const md = await helpPages(["pomodoro"]);
    assert.match(md, /\]\(sync\.md\)/);
    assert.doesNotMatch(md, /android\//, "no directory is invented for the unprefixed set");
  } finally { restore(); }
});
