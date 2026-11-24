import { AbsoluteFill, Composition, interpolate, useCurrentFrame } from "remotion";

const Smoke = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: "#2f6fd1", justifyContent: "center", alignItems: "center" }}>
      <div style={{ color: "#fff", fontSize: 96, fontFamily: "sans-serif", fontWeight: 700, opacity: interpolate(frame, [0, 20], [0, 1]) }}>Greenlight</div>
    </AbsoluteFill>
  );
};

export const Root = () => <Composition id="Smoke" component={Smoke} durationInFrames={45} fps={30} width={1280} height={720} />;
