import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, Task } from '../db';
import { parse, today, ymd } from '../util';
import { cancel, schedule } from '../notif';
import { Ic, Deco } from '../icons';

const occurs = (t: Task, d: string) => {
  if (d < t.date) return false;
  if (t.repeat === 'none') return t.date === d;
  if (t.repeat === 'daily') return true;
  const a = parse(t.date), b = parse(d);
  if (t.repeat === 'weekly') return a.getDay() === b.getDay();
  // monthly: tgl 29-31 tetap muncul di bulan pendek (hari terakhir bulan)
  if (a.getDate() === b.getDate()) return true;
  return a.getDate() >= 29 && b.getDate() === new Date(b.getFullYear(), b.getMonth() + 1, 0).getDate() && a.getDate() > b.getDate();
};
const isDone = (t: Task, d: string) => (t.repeat === 'none' ? t.done : t.doneOn.includes(d));
const PRI = ['', 'Tinggi', 'Sedang', 'Rendah'];
const PRI_C = ['', '#ef4444', '#f59e0b', '#22c55e'];

// Terinspirasi Todoist/Things 3: progress hari ini, checkbox bulat prioritas, sheet tambah
export default function Todo({ go }: { go?: (t: string) => void }) {
  const tasks = useLiveQuery(() => db.tasks.toArray(), []) || [];
  const [sel, setSel] = useState(today());
  const [cur, setCur] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [sheet, setSheet] = useState(false);
  const [edit, setEdit] = useState<Task | null>(null);
  const [f, setF] = useState({ title: '', time: '', repeat: 'none', priority: 2 });

  const y = cur.getFullYear(), mo = cur.getMonth();
  const lead = cur.getDay(), days = new Date(y, mo + 1, 0).getDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => ymd(new Date(y, mo, i + 1)))];
  const list = tasks.filter(t => occurs(t, sel)).sort((a, b) => +isDone(a, sel) - +isDone(b, sel) || a.priority - b.priority || (a.time || '99').localeCompare(b.time || '99'));

  // progress hari ini (ring)
  const td = tasks.filter(t => occurs(t, today()));
  const tdDone = td.filter(t => isDone(t, today())).length;
  const pct = td.length ? Math.round((tdDone / td.length) * 100) : 0;

  const add = async () => {
    if (!f.title.trim()) return;
    const t: Task = { title: f.title.trim(), date: sel, time: f.time, repeat: f.repeat as any, priority: f.priority as any, done: false, doneOn: [] };
    t.id = await db.tasks.add(t);
    schedule(t);
    setF({ ...f, title: '', time: '' });
    setSheet(false);
  };
  const toggle = (t: Task) => t.repeat === 'none'
    ? db.tasks.update(t.id!, { done: !t.done })
    : db.tasks.update(t.id!, { doneOn: t.doneOn.includes(sel) ? t.doneOn.filter(x => x !== sel) : [...t.doneOn, sel] });

  const R = 26, C = 2 * Math.PI * R;

  return (
    <>
      {/* Progress hari ini ala Todoist */}
      <section className="tdHero">
        <div className="tdRing">
          <svg width="64" height="64" viewBox="0 0 64 64">
            <circle cx="32" cy="32" r={R} fill="none" stroke="var(--line)" strokeWidth="6" />
            <circle cx="32" cy="32" r={R} fill="none" stroke="var(--ac)" strokeWidth="6" strokeLinecap="round"
              strokeDasharray={C} strokeDashoffset={C * (1 - pct / 100)} transform="rotate(-90 32 32)" style={{ transition: 'stroke-dashoffset .5s' }} />
          </svg>
          <b className="tdPct">{pct}%</b>
        </div>
        <div className="tdHeroTxt">
          <b>{tdDone} dari {td.length} tugas selesai</b>
          <span className="mute">{pct === 100 && td.length ? 'Semua beres, keren Bos! 🎉' : pct > 50 ? 'Setengah jalan, gas terus!' : 'Satu per satu, pasti kelar.'}</span>
        </div>
      </section>

      {/* Kalender glass */}
      <section>
        <div className="row" style={{ border: 0 }}>
          <button className="btn alt" style={{ width: 'auto' }} onClick={() => setCur(new Date(y, mo - 1, 1))}>‹</button>
          <b style={{ flex: 1, textAlign: 'center' }}>{cur.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}</b>
          <button className="btn alt" style={{ width: 'auto' }} onClick={() => setCur(new Date(y, mo + 1, 1))}>›</button>
        </div>
        <div className="cal">
          {['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'].map(h => <span key={h}>{h}</span>)}
          {cells.map((d, i) => d ? (
            <button key={d} className={[d === sel && 'sel', d === today() && 'now', tasks.some(t => occurs(t, d)) && 'dot'].filter(Boolean).join(' ')} onClick={() => setSel(d)}>{+d.slice(8)}</button>
          ) : <i key={'e' + i} />)}
        </div>
      </section>

      {/* Daftar tugas: checkbox bulat + warna prioritas */}
      <section>
        <h2>{parse(sel).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
        {list.length === 0 && <div className="tdEmpty"><Deco.memo width={34} /><div><b>Nggak ada tugas</b><span>Tanggal ini bebas, nikmatin aja.</span></div></div>}
        {list.map(t => (
          <div className="tdRow" key={t.id}>
            <button className={'tdCheck' + (isDone(t, sel) ? ' ok' : '')} style={{ borderColor: isDone(t, sel) ? 'var(--pos)' : PRI_C[t.priority] + '66' }}
              onClick={() => toggle(t)}>{isDone(t, sel) && <Ic.star size={13} fill="#fff" color="#fff" />}</button>
            <span className={'tdTxt' + (isDone(t, sel) ? ' done' : '')}>
              {t.title}
              <div className="tag">
                {t.time && <><Ic.calendar size={10} style={{ verticalAlign: '-1px' }} /> {t.time} · </>}
                <span style={{ color: PRI_C[t.priority], fontWeight: 700 }}>{PRI[t.priority]}</span>
                {t.repeat !== 'none' && ` · ${({ daily: 'tiap hari', weekly: 'tiap minggu', monthly: 'tiap bulan' } as any)[t.repeat]}`}
              </div>
            </span>
            <button className="link" title="Edit tugas" onClick={() => setEdit(t)}><Ic.pencil size={13} /></button>
            <button className="link" title="Catatan tugas" onClick={() => {
              go && go('notes');
              setTimeout(() => window.dispatchEvent(new CustomEvent('notefor', { detail: { taskId: t.id, date: sel, title: t.title } })), 350);
            }}><Ic.note size={13} /></button>
            <button className="link" onClick={() => { cancel(t.id!); db.tasks.delete(t.id!); }}>Hapus</button>
          </div>
        ))}
      </section>

      {/* Sheet edit tugas */}
      {edit && (
        <>
          <div className="sheetBk" onClick={() => setEdit(null)} />
          <div className="sheet">
            <div className="sheetBar" />
            <div className="row" style={{ border: 0 }}>
              <h2 style={{ margin: 0 }}>Edit tugas</h2>
              <button className="icobtn" onClick={() => setEdit(null)} aria-label="Tutup"><Ic.x size={18} /></button>
            </div>
            <form onSubmit={e => { e.preventDefault(); if (!edit.title.trim()) return; (async () => { const upd = { title: edit.title.trim(), time: edit.time, priority: edit.priority, repeat: edit.repeat, date: edit.date }; await db.tasks.update(edit.id!, upd); cancel(edit.id!); schedule({ ...edit, ...upd } as Task); })(); setEdit(null); }} style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <input value={edit.title} onChange={e => setEdit({ ...edit, title: e.target.value })} />
              <input type="date" value={edit.date} onChange={e => setEdit({ ...edit, date: e.target.value })} />
              <div className="g2">
                <input type="time" value={edit.time} onChange={e => setEdit({ ...edit, time: e.target.value })} />
                <select value={edit.priority} onChange={e => setEdit({ ...edit, priority: +e.target.value as 1 | 2 | 3 })}><option value={1}>Prioritas tinggi</option><option value={2}>Sedang</option><option value={3}>Rendah</option></select>
              </div>
              <select value={edit.repeat} onChange={e => setEdit({ ...edit, repeat: e.target.value as any })}>
                <option value="none">Sekali</option><option value="daily">Tiap hari</option><option value="weekly">Tiap minggu</option><option value="monthly">Tiap bulan</option>
              </select>
              <button className="btn" type="submit">Simpan perubahan</button>
            </form>
          </div>
        </>
      )}

      {/* FAB + sheet tambah */}
      <button className="fab" onClick={() => setSheet(true)} aria-label="Tambah tugas"><Ic.plus size={24} strokeWidth={2.5} /></button>
      {sheet && (
        <>
          <div className="sheetBk" onClick={() => setSheet(false)} />
          <div className="sheet">
            <div className="sheetBar" />
            <div className="row" style={{ border: 0 }}>
            <h2 style={{ margin: 0 }}>Tugas baru</h2>
            <button className="icobtn" onClick={() => setSheet(false)} aria-label="Tutup"><Ic.x size={18} /></button>
          </div>
            <form onSubmit={e => { e.preventDefault(); add(); }} style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <input placeholder="Apa yang perlu dilakukan?" autoFocus value={f.title} onChange={e => setF({ ...f, title: e.target.value })} />
              <div className="g2">
                <input type="time" value={f.time} onChange={e => setF({ ...f, time: e.target.value })} />
                <select value={f.priority} onChange={e => setF({ ...f, priority: +e.target.value })}><option value={1}>Prioritas tinggi</option><option value={2}>Sedang</option><option value={3}>Rendah</option></select>
              </div>
              <select value={f.repeat} onChange={e => setF({ ...f, repeat: e.target.value })}>
                <option value="none">Sekali</option><option value="daily">Tiap hari</option><option value="weekly">Tiap minggu</option><option value="monthly">Tiap bulan</option>
              </select>
              <button className="btn" type="submit">Tambah tugas</button>
              <div className="tag">Isi jam untuk mendapat pengingat notifikasi.</div>
            </form>
          </div>
        </>
      )}
    </>
  );
}
