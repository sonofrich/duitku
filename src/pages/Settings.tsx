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
    if (!confirm('Pulihkan backup ini akan MENGGANTI SEMUA data saat ini (transaksi, tugas, catatan). Lanjut?')) return;
    try {
      const o = JSON.parse(await f.text());
      const all = [...TABLES, 'kv'] as any[];
      await db.transaction('rw', all.map(t => (db as any)[t]), async () => {
        for (const t of all) { await (db as any)[t].clear(); if (o[t]?.length) await (db as any)[t].bulkAdd(o[t]); }
      });
      setMsg('Data dipulihkan.');
    } catch { setMsg('File backup tidak valid.'); }
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
