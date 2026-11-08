import { useState } from 'react';
import { db, TABLES } from '../db';
import { loadCfg, saveCfg, Cfg } from '../ai';
import { saveFile } from '../util';
import { THEMES, getTheme, setTheme, applyWallpaper, wallOn, ThemeId } from '../theme';
import { Ic, Deco } from '../icons';

// PIN: salt acak + 50k iterasi SHA-256 (stretching ringan, cukup utk PIN 4-6 digit lokal)
const sha = async (s: string) => {
  const enc = new TextEncoder();
  let data = enc.encode(s + ':' + (localStorage.getItem('pinsalt') || (() => { const x = crypto.getRandomValues(new Uint8Array(16)); localStorage.setItem('pinsalt', [...x].map(b => b.toString(16).padStart(2, '0')).join('')); return [...x].map(b => b.toString(16).padStart(2, '0')).join(''); })()));
  for (let i = 0; i < 50000; i++) data = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return [...data].map(b => b.toString(16).padStart(2, '0')).join('');
};

// Settings rapi: section berkelompok dengan ikon + deskripsi
export default function Settings() {
  const [c, setC] = useState<Cfg>(loadCfg());
  const [wp, setWp] = useState(wallOn());
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState('');
  const [theme, setT] = useState<ThemeId>(getTheme());
  const set = (p: Partial<typeof c>) => { const n = { ...c, ...p }; setC(n); saveCfg(n); };
  const pick = (t: ThemeId) => { setTheme(t); setT(t); };

  const backup = async () => {
    const o: any = {};
    for (const t of [...TABLES, 'kv'] as any[]) o[t] = await (db as any)[t].toArray();
    await saveFile(`duitku-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(o));
  };
  const restore = async (f?: File) => {
    if (!f) return;
    try {
      const o = JSON.parse(await f.text());
      const all = [...TABLES, 'kv'] as any[];
      const isObj = (v: any) => !!v && typeof v === 'object' && !Array.isArray(v);
      const isDate = (v: any) => {
        if (typeof v !== 'string' || !/^\\d{4}-\\d{2}-\\d{2}$/.test(v)) return false;
        const [y, m, d] = v.split('-').map(Number);
        const x = new Date(Date.UTC(y, m - 1, d));
        return x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d;
      };
      const isTime = (v: any) => v === '' || (typeof v === 'string' && /^(?:[01]\\d|2[0-3]):[0-5]\\d$/.test(v));
      if (!isObj(o) || all.some(t => !Array.isArray(o[t]))) throw new Error('Struktur backup tidak lengkap');

      const valid = {
        accounts: o.accounts.every((x: any) => isObj(x) && typeof x.name === 'string' && x.name.trim() && Number.isFinite(x.balance0)),
        txs: o.txs.every((x: any) => isObj(x) && isDate(x.date) && ['in', 'out'].includes(x.type) &&
          Number.isFinite(x.amount) && x.amount > 0 && Number.isInteger(x.accountId) && typeof x.category === 'string' &&
          (x.transferId === undefined || typeof x.transferId === 'string')),
        budgets: o.budgets.every((x: any) => isObj(x) && typeof x.category === 'string' && Number.isFinite(x.limit) && x.limit > 0),
        tasks: o.tasks.every((x: any) => isObj(x) && typeof x.title === 'string' && x.title.trim() && isDate(x.date) &&
          isTime(x.time ?? '') && [1, 2, 3].includes(x.priority ?? 2) &&
          ['none', 'daily', 'weekly', 'monthly'].includes(x.repeat ?? 'none') &&
          (x.done === undefined || typeof x.done === 'boolean') &&
          (x.doneOn === undefined || (Array.isArray(x.doneOn) && x.doneOn.every(isDate)))),
        plans: o.plans.every((x: any) => isObj(x) && typeof x.name === 'string' && Number.isFinite(x.daily) && x.daily > 0 &&
          isDate(x.startDate) && (x.lastRun === '' || x.lastRun === undefined || isDate(x.lastRun)) &&
          isObj(x.alloc) && Object.values(x.alloc).every(v => Number.isFinite(v) && Number(v) >= 0) && typeof x.active === 'boolean'),
        trades: o.trades.every((x: any) => isObj(x) && Number.isInteger(x.planId) && isDate(x.date) &&
          typeof x.symbol === 'string' && Number.isFinite(x.price) && x.price > 0 &&
          Number.isFinite(x.amount) && x.amount > 0 && Number.isFinite(x.qty) && x.qty > 0),
        notes: o.notes.every((x: any) => isObj(x) && typeof x.title === 'string' && typeof x.body === 'string' &&
          ['umum', 'tugas'].includes(x.kind) && typeof x.secret === 'boolean' && isDate(x.date) &&
          typeof x.pinned === 'boolean' && typeof x.createdAt === 'string' && typeof x.updatedAt === 'string'),
        kv: o.kv.every((x: any) => isObj(x) && typeof x.key === 'string' && x.key.length > 0)
      };
      const invalid = Object.keys(valid).filter(k => !(valid as any)[k]);
      if (invalid.length) throw new Error('Data tidak valid: ' + invalid.join(', '));

      // Normalisasi field opsional dari backup versi lama sebelum menulis DB.
      const normalized = {
        ...o,
        tasks: o.tasks.map((t: any) => ({ ...t, time: t.time ?? '', priority: t.priority ?? 2, repeat: t.repeat ?? 'none', done: t.done ?? false, doneOn: Array.isArray(t.doneOn) ? t.doneOn : [] }))
      };
      await db.transaction('rw', all.map(t => (db as any)[t]), async () => {
        for (const t of all) {
          await (db as any)[t].clear();
          if (normalized[t].length) await (db as any)[t].bulkAdd(normalized[t]);
        }
      });
      setMsg('Data dipulihkan.');
    } catch (e: any) {
      setMsg('Backup ditolak: ' + (e?.message || 'format tidak valid') + '. Data lama tetap aman.');
    }
  };

  const Sec = ({ icon, title, desc, children }: { icon: any; title: string; desc?: string; children: any }) => (
    <section className="setSec">
      <div className="setHead">
        <span className="setIco">{icon}</span>
        <div><b>{title}</b>{desc && <span>{desc}</span>}</div>
      </div>
      {children}
    </section>
  );

  const Toggle = ({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) => (
    <button className={'setToggle' + (on ? ' on' : '')} onClick={() => onChange(!on)}>
      <span>{label}</span>
      <span className="tknob" />
    </button>
  );

  return (
    <>
      <Sec icon={<Ic.star size={17} />} title="Tema tampilan">
        <div className="themegrid">
          {THEMES.map(t => (
            <button key={t.id} className={'themecard' + (theme === t.id ? ' on' : '')} onClick={() => pick(t.id)}>
              <div className="tprev" style={{ background: t.swatch[0] }}>
                <span style={{ display: 'inline-block', width: '55%', height: 18, borderRadius: 6, background: t.swatch[1] }} />
              </div>
              <div className="tname">{t.name}</div>
              <div className="tdesc"><span className="tdot" style={{ background: t.swatch[1] }} />{t.desc}</div>
            </button>
          ))}
        </div>
        <div className="tag" style={{ marginTop: 8 }}>Langsung aktif & tersimpan di perangkat.</div>
      </Sec>

      <Sec icon={<Deco.moon width={16} />} title="Tampilan harian" desc="Jam, cuaca & wallpaper">
        <input value={c.city || ''} onChange={e => set({ city: e.target.value })} placeholder="Nama kota (mis. Jakarta)" />
        <div className="g2">
          <input inputMode="decimal" value={c.lat ?? ''} onChange={e => set({ lat: e.target.value === '' ? undefined : +e.target.value })} placeholder="Lat (mis. -6.2)" />
          <input inputMode="decimal" value={c.lon ?? ''} onChange={e => set({ lon: e.target.value === '' ? undefined : +e.target.value })} placeholder="Long (mis. 106.8)" />
        </div>
        <input inputMode="numeric" value={c.tzOffset ?? ''} onChange={e => set({ tzOffset: e.target.value === '' ? undefined : +e.target.value })} placeholder="Offset zona waktu menit (420 = WIB)" />
        <div className="tag">Cuaca open-meteo (gratis). Cari lat/long di latlong.net — Jakarta -6.2/106.8, Denpasar -8.65/115.22.</div>
        <Toggle on={wp} onChange={v => { setWp(v); applyWallpaper(v); }} label="Wallpaper anime (siang/malam otomatis)" />
      </Sec>

      <Sec icon={<Ic.ai size={17} />} title="Asisten AI" desc="Chat, baca & ubah data app">
        <select value={c.provider} onChange={e => set({ provider: e.target.value as any, model: e.target.value === 'gemini' ? 'gemini-2.0-flash' : 'openrouter/auto' })}>
          <option value="openrouter">OpenRouter</option><option value="gemini">Google Gemini</option>
        </select>
        <input value={c.model} onChange={e => set({ model: e.target.value })} placeholder="Nama model" />
        <input type="password" value={c.key} onChange={e => set({ key: e.target.value })} placeholder="API key" />
        <Toggle on={c.withData} onChange={v => set({ withData: v })} label="Beri AI akses data (jadwal & keuangan)" />
        <div className="tag">Key disimpan lokal di perangkat. Dengan akses data, AI bisa mencatat transaksi, membuat tugas, dan membaca angka langsung.</div>
      </Sec>

      <Sec icon={<Ic.invest size={17} />} title="Pasar & harga" desc="Binance (opsional)">
        <input type="password" value={c.binanceKey || ''} onChange={e => set({ binanceKey: e.target.value })} placeholder="API key Binance (opsional)" />
        <div className="tag">Tanpa key pun data publik tetap jalan; key hanya menaikkan batas rate. Hanya dipakai di APK.</div>
      </Sec>

      <Sec icon={<Ic.eye size={17} />} title="Keamanan">
        <input type="password" inputMode="numeric" value={pin} onChange={e => setPin(e.target.value)} placeholder="PIN baru (kosongkan untuk mematikan)" />
        <button className="btn alt" onClick={async () => {
  if (pin) {
    localStorage.setItem('pin', await sha(pin));
    sessionStorage.setItem('duitku-pin-session', pin); // vault notes langsung terikat PIN baru
  } else { localStorage.removeItem('pin'); sessionStorage.removeItem('duitku-pin-session'); }
  setPin(''); setMsg(pin ? 'PIN aktif.' : 'PIN dimatikan.');
}}>Simpan PIN</button>
      </Sec>

      <Sec icon={<Ic.wallet size={17} />} title="Data & backup">
        <div className="g2">
          <button className="btn alt" onClick={backup}>Ekspor JSON</button>
          <label className="btnRestore">
            Pulihkan JSON
            <input type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={e => restore(e.target.files?.[0])} />
          </label>
        </div>
        <div className="tag">Memulihkan mengganti semua data saat ini (termasuk catatan). API key tidak ikut di-backup.</div>
        {msg && <div className="pos">{msg}</div>}
      </Sec>
    </>
  );
}
