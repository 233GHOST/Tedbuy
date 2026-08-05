declare module 'motion-dom' {
  export type AnyResolvedKeyframe = any;
  export type OnKeyframesResolved<T> = any;
  export type KeyframeResolver<T> = any;
  export type MotionValue<T = any> = any;
  export type TransformProperties = any;
  export type SVGPathProperties = any;
  export type Transition = any;
  export type PresenceContextProps = any;
  export type ResolvedValues = any;
  export type VisualElement = any;
  export type Feature = any;
  export type UnresolvedValueKeyframe = any;
  export type AnimationOptions = any;
  export type ElementOrSelector = any;
  export type DOMKeyframesDefinition = any;
  export type AnimationPlaybackOptions = any;
  export type AnimationPlaybackControlsWithThen = any;
  export type ValueAnimationTransition = any;
  export type AnimationScope = any;
  export type AnimationPlaybackControls = any;
  export type EventInfo = any;
  export type MotionValueEventCallbacks = any;
  export type FollowValueOptions = any;
  export type SpringOptions = any;
  export type TransformOptions = any;
  export type WillChange = any;
  export type LegacyAnimationControls = any;
  export type NodeGroup = any;
  export type IProjectionNode = any;

  export interface MotionNodeOptions {
    initial?: any;
    animate?: any;
    exit?: any;
    whileHover?: any;
    whileTap?: any;
    whileDrag?: any;
    whileFocus?: any;
    whileInView?: any;
    onAnimationStart?: any;
    onAnimationComplete?: any;
    onUpdate?: any;
    variants?: any;
    custom?: any;
    transition?: any;
    layout?: boolean | string;
    layoutId?: string;
    style?: any;
    className?: string;
    children?: any;
  }

  export const animate: any;
  export const motionValue: any;
  export const useMotionValue: any;
  export const isValidMotionProp: any;
  export const motion: any;
  export const m: any;
}
