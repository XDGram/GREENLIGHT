import { continueRender, delayRender, staticFile } from "remotion";

const faces: [string, string, string][] = [
  ["Jakarta", "fonts/jakarta-400.woff2", "400"],
  ["Jakarta", "fonts/jakarta-500.woff2", "500"],
  ["Jakarta", "fonts/jakarta-600.woff2", "600"],
  ["Jakarta", "fonts/jakarta-700.woff2", "700"],
  ["Jakarta", "fonts/jakarta-800.woff2", "800"],
  ["Mono", "fonts/mono-400.woff2", "400"],
  ["Mono", "fonts/mono-500.woff2", "500"],
];

if (typeof document !== "undefined") {
  const handle = delayRender("Loading fonts");
  Promise.all(
    faces.map(([family, file, weight]) => {
      const f = new FontFace(family, `url(${staticFile(file)}) format("woff2")`, { weight });
      (document.fonts as any).add(f);
      return f.load();
    }),
  )
    .then(() => continueRender(handle))
    .catch((e) => {
      console.error(e);
      continueRender(handle);
    });
}
