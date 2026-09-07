import React from 'react';
import Svg, { Polygon, Rect } from 'react-native-svg';

interface HomeTabIconProps {
  size?: number;
  color: string;
  /** The door/window cutouts are punched out using this color rather than
   * true transparency — simplest correct result since this icon only ever
   * renders directly on the tab bar's own flat background, whose color is
   * already known at the call site (light grid bar vs. dark video-feed bar). */
  cutoutColor: string;
}

/** A solid pictogram-style house (wide roof, chunky body, a door and two
 * flanking windows) rather than lucide's thin-stroke House outline — matches
 * a reference the user provided for how the Home tab icon should look. */
export function HomeTabIcon({ size = 24, color, cutoutColor }: HomeTabIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Polygon points="1,12 12,2 23,12" fill={color} />
      <Rect x={3.5} y={12} width={17} height={9.5} fill={color} />
      <Rect x={6} y={14.5} width={2.8} height={2.8} fill={cutoutColor} />
      <Rect x={15.2} y={14.5} width={2.8} height={2.8} fill={cutoutColor} />
      <Rect x={10} y={15.5} width={4} height={6} fill={cutoutColor} />
    </Svg>
  );
}
