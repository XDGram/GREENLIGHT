import { continueRender, delayRender, staticFile } from "remotion";

if (typeof document !== "undefined") {
  const handle = delayRender("Loading Inter");
  Promise.all(
    ["400", "500", "600", "700", "800"].map((w) => {
      const f = new FontFace("Inter", `url(${staticFile(`fonts/inter-${w}.woff2`)}) format("woff2")`, { weight: w });
      (document.fonts as any).add(f);
      return f.load();
    }),
  ).then(() => continueRender(handle), () => continueRender(handle));
}
