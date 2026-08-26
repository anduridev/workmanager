export const STATUS_LABEL = { todo: 'To Do', inprogress: 'In Progress', hold: 'On Hold', done: 'Done' };
export const TARGET_STATUS_LABEL = { pending: 'Pending', inprogress: 'In Progress', hold: 'On Hold', achieved: 'Achieved', missed: 'Missed' };
export const PRIORITY_LABEL = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };
export const OUTCOME_LABEL = { ontrack: 'On track', atrisk: 'At risk', blocked: 'Blocked', info: 'Update' };

export function StatusBadge({ status, labels = STATUS_LABEL }) {
  return <span className={`badge badge-${status}`}>{labels[status] || status}</span>;
}

export function PriorityBadge({ priority }) {
  return <span className={`badge badge-${priority}`}>{PRIORITY_LABEL[priority] || priority}</span>;
}

export function Tag({ children }) {
  return <span className="badge badge-tag">#{children}</span>;
}

export function Empty({ icon = '✨', text, children }) {
  return (
    <div className="empty">
      <div className="big">{icon}</div>
      <div>{text}</div>
      {children}
    </div>
  );
}

const COLORS = ['#4f46e5', '#7c3aed', '#db2777', '#ea580c', '#16a34a', '#0891b2', '#2563eb', '#b45309'];
export function colorFor(name = '') {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}
export function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0].toUpperCase())
    .join('');
}
export function Avatar({ name, size }) {
  return (
    <span className="avatar" style={{ background: colorFor(name), ...(size && { width: size, height: size, fontSize: size * 0.4 }) }} title={name}>
      {initials(name)}
    </span>
  );
}

/** Azure DevOps sync badge for a project (PBI) or task. */
export function AzdoBadge({ azdo, kind = 'Task', onRetry }) {
  if (!azdo) return null;
  if (azdo.error) {
    return (
      <span
        className="badge badge-overdue clickable"
        title={`Azure DevOps sync failed: ${azdo.error}${onRetry ? ' — click to retry' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          onRetry?.();
        }}
      >
        ⚠ ADO {azdo.id ? `#${azdo.id}` : 'sync failed'}
      </span>
    );
  }
  if (!azdo.id) return null;
  return (
    <a
      className="badge badge-azdo"
      href={azdo.url}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      title={`Open ${kind} #${azdo.id} in Azure DevOps${azdo.state ? ` · ${azdo.state}` : ''}${azdo.iterationPath ? ` · ${azdo.iterationPath.split('\\').pop()}` : ''}`}
    >
      ⧉ {kind === 'Task' ? 'ADO' : 'PBI'} #{azdo.id}
    </a>
  );
}

export function Segmented({ value, onChange, options }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o.value} className={value === o.value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
