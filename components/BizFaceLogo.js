import { useState, useEffect } from "react";

export default function BizFaceLogo({ size = 40, className = "", isTalking = false }) {
  const [blinking, setBlinking] = useState(false);
  const [mouthOpen, setMouthOpen] = useState(false);

  // Eye blink: first at 2s, then every 4s, each blink lasts 180ms
  useEffect(() => {
    const blink = () => {
      setBlinking(true);
      setTimeout(() => setBlinking(false), 180);
    };
    const interval = setInterval(blink, 4000);
    const first = setTimeout(blink, 2000);
    return () => {
      clearInterval(interval);
      clearTimeout(first);
    };
  }, []);

  // Mouth movement when talking (system is responding)
  useEffect(() => {
    if (!isTalking) {
      setMouthOpen(false);
      return;
    }
    const interval = setInterval(() => {
      setMouthOpen((prev) => !prev);
    }, 200);
    return () => clearInterval(interval);
  }, [isTalking]);

  return (
    <svg
      viewBox="0 0 318.34 318.34"
      width={size}
      height={size}
      className={`transition-transform duration-300 hover:scale-110 ${className}`}
    >
      <defs>
        <linearGradient id="bfl-grad" x1="109.22" y1="58.65" x2="235.04" y2="311.86" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#5398d2" />
          <stop offset="1" stopColor="#4c63ae" />
        </linearGradient>
      </defs>

      {/* Rounded Rectangle Background */}
      <rect fill="url(#bfl-grad)" width="318.34" height="318.34" rx="83.83" ry="83.83" />

      {/* Left Eye */}
      <g style={{
        transformOrigin: "125px 140px",
        transform: blinking ? "scaleY(0.08)" : "scaleY(1)",
        transition: "transform 0.15s ease-in-out",
      }}>
        <path fill="#fff" d="M147.28,130.83l-41.66-36.95c-5.73-5.08-14.74-.75-14.35,6.89l3.8,75.81c.38,7.53,9.55,10.99,14.81,5.59l37.86-38.85c3.44-3.53,3.23-9.22-.45-12.49l-41.66-36.95c-5.73-5.08-14.74-.75-14.35,6.89l3.8,75.81c.38,7.53,9.55,10.99,14.81,5.59l37.86-38.85c3.44-3.53,3.23-9.22-.45-12.49Z" />
      </g>

      {/* Right Eye */}
      <g style={{
        transformOrigin: "193px 140px",
        transform: blinking ? "scaleY(0.08)" : "scaleY(1)",
        transition: "transform 0.15s ease-in-out",
      }}>
        <path fill="#fff" d="M171.06,130.83l41.66-36.95c5.73-5.08,14.74-.75,14.35,6.89l-3.8,75.81c-.38,7.53-9.55,10.99-14.81,5.59l-37.86-38.85c-3.44-3.53-3.23-9.22.45-12.49l41.66-36.95c5.73-5.08,14.74-.75,14.35,6.89l-3.8,75.81c-.38,7.53-9.55,10.99-14.81,5.59l-37.86-38.85c-3.44-3.53-3.23-9.22.45-12.49Z" />
      </g>

      {/* Mouth */}
      <g style={{
        transformOrigin: "159px 205px",
        transform: mouthOpen ? "scaleY(1.3)" : "scaleY(1)",
        transition: "transform 0.12s ease-in-out",
      }}>
        <path fill="#fff" d="M165.87,183.43l13.66,35.39c1.75,4.53-1.62,9.4-6.48,9.37l-27.85-.21c-4.86-.04-8.15-4.96-6.34-9.46l14.19-35.18c2.34-5.8,10.56-5.73,12.81.1l13.66,35.39c1.75,4.53-1.62,9.4-6.48,9.37l-27.85-.21c-4.86-.04-8.15-4.96-6.34-9.46l14.19-35.18c2.34-5.8,10.56-5.73,12.81.1Z" />
      </g>
    </svg>
  );
}
