import React from 'react';
import {Composition} from 'remotion';
import {HotIssueReelPhoto} from './HotIssueReelPhoto.jsx';
import {totalFrames} from './timing.js';
import {defaultInputProps} from './defaultProps.js';

export const Root = () => {
  return (
    <Composition
      id="HotIssueReelPhoto"
      component={HotIssueReelPhoto}
      width={1080}
      height={1920}
      fps={30}
      defaultProps={defaultInputProps}
      // durationInFrames = 90 + 114*이슈수 + 84 (이슈 수에 따라 동적 계산)
      calculateMetadata={({props}) => ({
        durationInFrames: totalFrames((props.issues || []).length),
      })}
    />
  );
};
