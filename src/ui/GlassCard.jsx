export default function GlassCard({ className = "", children }) {
  return (
    <div className={`m3-card p-4 md:p-5 ${className}`}>
      {children}
    </div>
  );
}
