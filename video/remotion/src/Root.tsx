import React from "react";
import { Composition } from "remotion";
import { Demo, DEMO_FRAMES } from "./Demo";
import { Film, FILM_FRAMES } from "./Film";
import { Launch, LAUNCH_FRAMES } from "./launch/Launch";

export const Root: React.FC = () => (
  <>
    <Composition id="Launch" component={Launch} durationInFrames={LAUNCH_FRAMES} fps={30} width={1920} height={1080} />
    <Composition id="Film" component={Film} durationInFrames={FILM_FRAMES} fps={30} width={1920} height={1080} />
    <Composition id="Demo" component={Demo} durationInFrames={DEMO_FRAMES} fps={30} width={1920} height={1080} />
  </>
);
