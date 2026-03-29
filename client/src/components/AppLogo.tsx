import React from "react";

interface AppLogoProps {
  size?: number;
  animated?: boolean;
}

export function AppLogoSparkle({ size = 32, animated = false }: AppLogoProps) {
  const uid = React.useId().replace(/:/g, "");
  const clipId = `alClip${uid}`;
  const maskGrpId = `alMaskGrp${uid}`;
  const grad1Id = `alGrad1${uid}`;
  const grad2Id = `alGrad2${uid}`;
  const maskId = `alMask${uid}`;

  const stops = (
    <>
      <stop offset="0%" stopColor="#a04e28" />
      <stop offset="22%" stopColor="#bf7040" />
      <stop offset="45%" stopColor="#d88763" />
      <stop offset="72%" stopColor="#e29f7e" />
      <stop offset="99%" stopColor="#eeb898" />
    </>
  );

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={animated ? "app-logo app-logo--animated" : "app-logo"}
      aria-hidden="true"
    >
      <defs>
        <clipPath id={clipId}>
          <rect width="32" height="32" x="0" y="0" />
        </clipPath>
        <g id={maskGrpId}>
          <g
            style={{ display: "block" }}
            transform="matrix(0.12479999661445618,0,0,0.12479999661445618,4.9864,4.9864)"
            opacity="1"
          >
            <g opacity="1" transform="matrix(1,0,0,1,88.25,88.25)">
              <path
                fill={`url(#${grad1Id})`}
                fillOpacity="1"
                d="M-3.9,-84.95 C-5.28,-79.47 -7.08,-74.14 -9.32,-68.93 C-15.16,-55.37 -23.16,-43.5 -33.33,-33.33 C-43.5,-23.17 -55.37,-15.16 -68.93,-9.32 C-74.13,-7.08 -79.47,-5.28 -84.95,-3.9 C-86.74,-3.45 -88,-1.85 -88,0 C-88,1.85 -86.74,3.45 -84.95,3.9 C-79.47,5.28 -74.14,7.08 -68.93,9.32 C-55.37,15.16 -43.51,23.16 -33.33,33.33 C-23.16,43.5 -15.15,55.37 -9.32,68.93 C-7.08,74.13 -5.28,79.47 -3.9,84.95 C-3.45,86.74 -1.84,88 0,88 C1.85,88 3.45,86.74 3.9,84.95 C5.28,79.47 7.08,74.14 9.32,68.93 C15.16,55.37 23.16,43.51 33.33,33.33 C43.5,23.16 55.37,15.15 68.93,9.32 C74.13,7.08 79.47,5.28 84.95,3.9 C86.74,3.45 88,1.84 88,0 C88,-1.85 86.74,-3.45 84.95,-3.9 C79.47,-5.28 74.14,-7.08 68.93,-9.32 C55.37,-15.16 43.51,-23.16 33.33,-33.33 C23.16,-43.5 15.15,-55.37 9.32,-68.93 C7.08,-74.13 5.28,-79.47 3.9,-84.95 C3.45,-86.74 1.85,-88 0,-88 C-1.85,-88 -3.45,-86.74 -3.9,-84.95z"
              />
            </g>
          </g>
        </g>
        <linearGradient
          id={grad1Id}
          spreadMethod="pad"
          gradientUnits="userSpaceOnUse"
          x1="-33"
          y1="26"
          x2="31"
          y2="-28"
        >
          {stops}
        </linearGradient>
        <linearGradient
          id={grad2Id}
          spreadMethod="pad"
          gradientUnits="userSpaceOnUse"
          x1="-33"
          y1="26"
          x2="31"
          y2="-28"
        >
          {stops}
        </linearGradient>
        <mask id={maskId}>
          <use href={`#${maskGrpId}`} />
        </mask>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <g style={{ display: "block" }} mask={`url(#${maskId})`}>
          <g
            transform="matrix(0.12479999661445618,0,0,0.12479999661445618,4.9864,4.9864)"
            opacity="1"
          >
            <g opacity="1" transform="matrix(1,0,0,1,88.25,88.25)">
              <path
                fill={`url(#${grad2Id})`}
                fillOpacity="1"
                d="M-14.654,174.771 C-14.654,174.771 174.771,14.654 174.771,14.654 C174.771,14.654 14.654,-174.771 14.654,-174.771 C14.654,-174.771 -174.771,-14.654 -174.771,-14.654 C-174.771,-14.654 -14.654,174.771 -14.654,174.771z"
              />
            </g>
          </g>
        </g>
      </g>
    </svg>
  );
}

export function AppLogo({ size = 32, animated = false }: AppLogoProps) {
  return (
    <img
      width={size}
      height={size}
      src="/mascotte.png"
      alt="Thinking"
      style={{ borderRadius: "8px" }}
    />
  );
}
