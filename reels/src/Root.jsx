import React from 'react';
import {Composition} from 'remotion';
import {HotIssueReelPhoto} from './HotIssueReelPhoto.jsx';
import {CardNewsReel} from './CardNewsReel.jsx';
import {totalFrames} from './timing.js';
import {defaultInputProps} from './defaultProps.js';

export const Root = () => {
  return (
    <>
      <Composition
        id="HotIssueReelPhoto"
        component={HotIssueReelPhoto}
        width={1080}
        height={1920}
        fps={30}
        defaultProps={defaultInputProps}
        // durationInFrames = 159*이슈수 + 45 (이슈 수에 따라 동적 계산)
        calculateMetadata={({props}) => ({
          durationInFrames: totalFrames((props.issues || []).length),
        })}
      />
      {/* 오리 기자(aibrief) 전용 — 신문 에디토리얼 스타일. props 계약은 HotIssueReelPhoto와 동일. */}
      <Composition
        id="CardNewsReel"
        component={CardNewsReel}
        width={1080}
        height={1920}
        fps={30}
        defaultProps={defaultInputProps}
        calculateMetadata={({props}) => ({
          durationInFrames: totalFrames((props.issues || []).length),
        })}
      />
    </>
  );
};
