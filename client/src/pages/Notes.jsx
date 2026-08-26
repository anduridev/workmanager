import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Notes as NotesApi } from '../lib/api';
import { dayjs, today, fmtDate, fmtDateTime } from '../lib/date';
import { Empty, Tag } from '../components/ui';
import { useToast } from '../components/Toast';
import Modal from '../components/Modal';

export default function Notes() {
  const [notes, setNotes] = useState([]);
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [draft, setDraft] = useState({ title: '', content: '', date: today(), tags: '' });
  const [editing, setEditing] = useState(null);
  const toast = useToast();
  const composerRef = useRef(null);
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get('new')) {
      composerRef.current?.focus();
      composerRef.current?.scrollIntoView({ block: 'center' });
      const next = new URLSearchParams(params);
      next.delete('new');
      setParams(next, { replace: true });
    }
  }, [params]);

  const load = () => NotesApi.list({ q: q || undefined, tag: tag || undefined }).then(setNotes);
  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [q, tag]);

  const allTags = useMemo(() => [...new Set(notes.flatMap((n) => n.tags || []))].sort(), [notes]);

  const grouped = useMemo(() => {
    const pinned = notes.filter((n) => n.pinned);
    const rest = notes.filter((n) => !n.pinned);
    const byDate = {};
    rest.forEach((n) => (byDate[n.date] = byDate[n.date] || []).push(n));
    return { pinned, byDate: Object.entries(byDate).sort((a, b) => (a[0] < b[0] ? 1 : -1)) };
  }, [notes]);

  const create = async (e) => {
    e?.preventDefault();
    if (!draft.content.trim()) return;
    await NotesApi.create(draft);
    setDraft({ title: '', content: '', date: today(), tags: '' });
    toast.success('Note saved');
    load();
  };
  const save = async () => {
    await NotesApi.update(editing._id, editing);
    setEditing(null);
    toast.success('Note updated');
    load();
  };
  const togglePin = async (n) => {
    await NotesApi.update(n._id, { pinned: !n.pinned });
    load();
  };
  const remove = async (n) => {
    if (!window.confirm('Delete this note?')) return;
    await NotesApi.remove(n._id);
    load();
  };

  const dateLabel = (d) => {
    if (d === today()) return 'Today';
    if (d === dayjs().subtract(1, 'day').format('YYYY-MM-DD')) return 'Yesterday';
    return fmtDate(d, 'dddd, DD MMM YYYY');
  };

  const NoteCard = ({ n }) => (
    <div className={`note-card ${n.pinned ? 'pinned' : ''}`}>
      <div className="nh">
        <h3>
          {n.pinned && '📌 '}
          {n.title || <span className="muted">Untitled</span>}
        </h3>
        <span className="muted xs">{fmtDateTime(n.createdAt)}</span>
      </div>
      <div className="content">{n.content}</div>
      <div className="nf">
        {n.tags?.map((t) => (
          <span key={t} className="clickable" onClick={() => setTag(t)}>
            <Tag>{t}</Tag>
          </span>
        ))}
        {n.updatedAt !== n.createdAt && <span className="xs">edited {dayjs(n.updatedAt).fromNow()}</span>}
        <div className="actions">
          <button className="btn btn-xs btn-ghost" onClick={() => togglePin(n)}>
            {n.pinned ? 'Unpin' : 'Pin'}
          </button>
          <button className="btn btn-xs btn-ghost" onClick={() => setEditing({ ...n, tags: (n.tags || []).join(', ') })}>
            Edit
          </button>
          <button className="btn btn-xs btn-ghost btn-danger" onClick={() => remove(n)}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Notes</h1>
          <div className="sub">Meeting notes, decisions, ideas — everything dated.</div>
        </div>
        <div className="page-actions">
          <input className="input input-sm w-240" type="search" placeholder="Search notes…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <form className="composer mb" onSubmit={create}>
        <input className="input" placeholder="Title (optional)" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        <textarea
          ref={composerRef}
          className="textarea"
          placeholder="Write a note… (Ctrl+Enter to save)"
          value={draft.content}
          onChange={(e) => setDraft({ ...draft, content: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && create(e)}
        />
        <div className="bar">
          <input className="input input-sm" type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
          <input className="input input-sm w-220" placeholder="tags, comma separated" value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} />
          <div className="grow" />
          <button className="btn btn-primary btn-sm" disabled={!draft.content.trim()}>
            Save note
          </button>
        </div>
      </form>

      {allTags.length > 0 && (
        <div className="chips mb">
          <button type="button" className={`chip ${!tag ? 'active' : ''}`} onClick={() => setTag('')}>
            All
          </button>
          {allTags.map((t) => (
            <button type="button" key={t} className={`chip ${tag === t ? 'active' : ''}`} onClick={() => setTag(tag === t ? '' : t)}>
              #{t}
            </button>
          ))}
        </div>
      )}

      {notes.length === 0 && <Empty icon="🗒" text={q || tag ? 'No notes match.' : 'No notes yet. Write your first one above.'} />}

      <div className="notes-layout">
        {grouped.pinned.length > 0 && (
          <>
            <div className="date-group">Pinned</div>
            {grouped.pinned.map((n) => (
              <NoteCard key={n._id} n={n} />
            ))}
          </>
        )}
        {grouped.byDate.map(([d, list]) => (
          <div key={d}>
            <div className="date-group">{dateLabel(d)}</div>
            <div className="col">
              {list.map((n) => (
                <NoteCard key={n._id} n={n} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <Modal
          title="Edit note"
          onClose={() => setEditing(null)}
          footer={
            <>
              <button className="btn" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={save} disabled={!editing.content.trim()}>
                Save
              </button>
            </>
          }
        >
          <label className="field">
            Title
            <input className="input" value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
          </label>
          <label className="field">
            Content
            <textarea className="textarea" style={{ minHeight: 160 }} value={editing.content} onChange={(e) => setEditing({ ...editing, content: e.target.value })} />
          </label>
          <div className="form-grid">
            <label className="field">
              Date
              <input className="input" type="date" value={editing.date} onChange={(e) => setEditing({ ...editing, date: e.target.value })} />
            </label>
            <label className="field">
              Tags
              <input className="input" value={editing.tags} onChange={(e) => setEditing({ ...editing, tags: e.target.value })} />
            </label>
          </div>
        </Modal>
      )}
    </>
  );
}
