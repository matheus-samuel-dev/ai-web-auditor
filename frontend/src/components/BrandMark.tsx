type BrandMarkProps = {
  size?: number;
  className?: string;
  title?: string;
};

export function BrandMark({ size = 34, className, title }: BrandMarkProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <defs>
        <linearGradient id="aiwa-beam" x1="8" y1="8" x2="41" y2="41" gradientUnits="userSpaceOnUse">
          <stop stopColor="#67E8F9" />
          <stop offset="1" stopColor="#0EA5E9" />
        </linearGradient>
      </defs>
      <path
        d="M24 4.5 40.5 14v19L24 42.5 7.5 33V14L24 4.5Z"
        stroke="url(#aiwa-beam)"
        strokeWidth="2.4"
      />
      <circle cx="23" cy="23" r="9.25" stroke="#DFF8FF" strokeWidth="2.2" />
      <path d="m29.7 29.7 6.3 6.3" stroke="#67E8F9" strokeWidth="2.6" strokeLinecap="round" />
      <path
        d="M11.5 24h5l2.1-4.2 3.1 8.4 2.5-5.1h3.1"
        stroke="#34D399"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="23" cy="23" r="2.1" fill="#67E8F9" />
      <path d="m27.5 14.2 1.7 1.8 3.5-3.7" stroke="#34D399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
