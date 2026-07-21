import React from 'react';
import {Composition} from 'remotion';
import {HotIssueReel} from './HotIssueReel.jsx';
import {HotIssueReelPhoto} from './HotIssueReelPhoto.jsx';

export const Root = () => {
  return (
    <>
      <Composition
        id="HotIssueReel"
        component={HotIssueReel}
        width={1080}
        height={1920}
        fps={30}
        durationInFrames={744}
      />
      <Composition
        id="HotIssueReelPhoto"
        component={HotIssueReelPhoto}
        width={1080}
        height={1920}
        fps={30}
        durationInFrames={744}
      />
    </>
  );
};
