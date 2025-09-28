interface ThemeToggleProps {
  theme: 'light' | 'dark';
  onToggle: () => void;
}

export function ThemeToggle({ theme, onToggle }: ThemeToggleProps) {
  return (
    <button className="button button--ghost" type="button" onClick={onToggle} aria-label="切换主题">
      {theme === 'light' ? '🌞 亮色' : '🌙 深色'}
    </button>
  );
}
