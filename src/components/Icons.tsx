type IconProps = { size?: number; className?: string };

function Icon({
  children,
  size = 20,
  className = ""
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const PlayIcon = (props: IconProps) => (
  <Icon {...props}><path d="m8 5 11 7-11 7Z" /></Icon>
);
export const PauseIcon = (props: IconProps) => (
  <Icon {...props}><path d="M9 5v14M15 5v14" /></Icon>
);
export const SkipIcon = (props: IconProps) => (
  <Icon {...props}><path d="m5 5 10 7L5 19ZM19 5v14" /></Icon>
);
export const PlusIcon = (props: IconProps) => (
  <Icon {...props}><path d="M12 5v14M5 12h14" /></Icon>
);
export const SendIcon = (props: IconProps) => (
  <Icon {...props}><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></Icon>
);
export const CopyIcon = (props: IconProps) => (
  <Icon {...props}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></Icon>
);
export const UsersIcon = (props: IconProps) => (
  <Icon {...props}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></Icon>
);
export const MessageIcon = (props: IconProps) => (
  <Icon {...props}><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" /></Icon>
);
