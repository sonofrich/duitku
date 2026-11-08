import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import { db } from '../db';
import { ASSETS, label, latest, usdIdr, isIDR } from '../market';
import { addDays } from '../util';
import { runAll } from '../dca';
import { idr, num, today } from '../util';
import { Ic } from '../icons';

const PRESET = [1000, 10000, 100000, 1000000, 100000000, 1000000000];
const short = (n: number) => (n >= 1e9 ? n / 1e9 + ' M' : n >= 1e6 ? n / 1e6 + ' jt' : n / 1e3 + ' rb');

// sparkline mini 7 hari per kartu watchlist — cache per simbol di module scope biar gak refetch tiap render
const sparkCache: Record<string, number[]> = {};
function WatchSpark({ id }: { id: string }) {
  const [pts, setPts] = useState<number[]>(sparkCache[id] || []);
  useEffect(() => {
    if (sparkCache[id]) return;
    (async () => {
      try {
        const { series, usdIdr, isIDR } = await import('../market');
        const ser = await series(id, addDays(today(), -7));
        const ks = Object.keys(ser).sort();
        const rate = await usdIdr();
        const arr = ks.map(k => (isIDR(id) ? ser[k] : ser[k] * rate));
        if (arr.length > 1) { sparkCache[id] = arr; setPts(arr); }
      } catch { /* offline */ }
    })();
  }, [id]);
  if (pts.length < 2) return null;
  const min = Math.min(...pts), max = Math.max(...pts);
  const W = 76, H = 22;
  const path = pts.map((v, i) => `${i ? 'L' : 'M'}${(i / (pts.length - 1)) * W},${H - 2 - ((v - min) / (max - min || 1)) * (H - 4)}`).join(' ');
  const up = pts[pts.length - 1] >= pts[0];
  const col = up ? '#22c55e' : '#ef4444';
  return (
    <svg width={W} height={H} style={{ display: 'block', margin: '2px 0' }} aria-hidden>
      <path d={path} fill="none" stroke={col} strokeWidth={1.6} strokeLinecap="round" opacity={0.9} />
    </svg>
  );
}

// Terinspirasi Wealthfolio: kartu nilai portofolio + sparkline, holdings dengan bar alokasi
export default function Invest() {
  const plans = useLiveQuery(() => db.plans.toArray(), []) || [];
  const trades = useLiveQuery(() => db.trades.toArray(), []) || [];
  const [px, setPx] = useState<Record<string, number>>({});
  const [watch, setWatch] = useState<Record<string, { p: number; prev: number; t: string }>>({});
  const [watchLoading, setWatchLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [sheet, setSheet] = useState(false);
  const [detailPlan, setDetailPlan] = useState<number | null>(null);
  const [name, setName] = useState('DCA harian');
  const [daily, setDaily] = useState('10000');
  const [start, setStart] = useState(today());
  const [pct, setPct] = useState<Record<string, string>>({ 'bn:BTCUSDT': '50', 'bn:PAXGUSDT': '30', 'yf:BBCA.JK': '20' });
  const [custom, setCustom] = useState('');

  const syms = [...new Set(trades.map(t => t.symbol))];
  const [syncedAt, setSyncedAt] = useState('');
  useEffect(() => { (async () => { const o: Record<string, number> = {}; for (const s of syms) o[s] = await latest(s); setPx(o); setSyncedAt(new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })); })(); }, [syms.join(',')]);

  // ── Watchlist pasar: crypto, emas, saham — pantau harga langsung tanpa buka broker ──
  const WATCH = ['bn:BTCUSDT', 'bn:ETHUSDT', 'bn:SOLUSDT', 'bn:PAXGUSDT', 'yf:BBCA.JK', 'yf:BBRI.JK', 'yf:TLKM.JK', 'yf:AAPL', 'yf:GC=F'];
  const [watchIds, setWatchIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('ivwatch') || '') || WATCH; } catch { return WATCH; }
  });
  const refreshWatch = async (ids: string[]) => {
    setWatchLoading(true);
    const out: Record<string, { p: number; prev: number; t: string }> = {};
    const { series, usdIdr } = await import('../market');
    const rate = await usdIdr();
    for (const id of ids) {
      try {
        const ser = await series(id, addDays(today(), -8));
        const ks = Object.keys(ser).sort();
        if (ks.length) {
          const p = ser[ks[ks.length - 1]];
          const prev = ser[ks[Math.max(0, ks.length - 2)]];
          out[id] = { p: isIDR(id) ? p : p * rate, prev: isIDR(id) ? prev : prev * rate, t: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) };
        }
      } catch { /* offline → biarkan */ }
      if (ids.indexOf(id) < ids.length - 1) await new Promise(r => setTimeout(r, 250));
    }
    setWatch(w => ({ ...w, ...out }));
    setWatchLoading(false);
  };
  useEffect(() => { refreshWatch(watchIds); localStorage.setItem('ivwatch', JSON.stringify(watchIds)); }, []);
  // auto-refresh watchlist tiap 60 detik selama halaman terbuka
  useEffect(() => {
    const t = setInterval(() => { if (!watchLoading) refreshWatch(watchIds); }, 60000);
    return () => clearInterval(t);
  }, [watchIds.join(','), watchLoading]);

  const total = Object.values(pct).reduce((s, v) => s + num(v), 0);
  const d = Math.min(1e9, Math.max(1000, num(daily)));

  const create = async () => {
    if (total !== 100) return setMsg('Total alokasi harus 100%.');
    const alloc: Record<string, number> = {};
    Object.entries(pct).forEach(([k, v]) => { if (num(v) > 0) alloc[k] = num(v); });
    await db.plans.add({ name, daily: d, startDate: start, lastRun: '', alloc, active: true });
    setMsg('Menyinkronkan harga…');
    const r = await runAll();
    setMsg(r);
    setSheet(false);
  };
  const remove = async (id: number) => { await db.trades.where('planId').equals(id).delete(); await db.plans.delete(id); };

  // agregat semua plan utk hero
  const invAll = trades.reduce((s, t) => s + t.amount, 0);
  const qtyAll: Record<string, number> = {};
  trades.forEach(t => (qtyAll[t.symbol] = (qtyAll[t.symbol] || 0) + t.qty));
  const pxReady = syms.every(k => px[k] > 0); // harga semua aset sudah termuat
  const valAll = Object.entries(qtyAll).reduce((s, [k, q]) => s + q * (px[k] || 0), 0);
  const plAll = pxReady ? valAll - invAll : 0;
  const plPct = pxReady && invAll ? (plAll / invAll) * 100 : 0;
  // sparkline akumulasi modal (cost basis) — BUKAN performance; nilai kini ada di hero
  // sparkline: nilai portofolio historis — unit kumulatif per tanggal x harga beli transaksi tsb
  // (harga beli nyata per transaksi, bukan sekadar tumpukan modal)
  const spark = (() => {
    const sorted = [...trades].sort((a, b) => a.date.localeCompare(b.date));
    const qty: Record<string, number> = {}; let c = 0;
    const byDate: Record<string, number> = {};
    sorted.forEach(t => {
      qty[t.symbol] = (qty[t.symbol] || 0) + t.qty;
      c += t.amount;
      byDate[t.date] = c; // cost basis kumulatif
    });
    // tambahkan titik terakhir = nilai kini (harga terkini)
    const dates = Object.keys(byDate).sort();
    const pts = dates.map(dd => ({ d: dd, v: byDate[dd] }));
    if (dates.length) pts.push({ d: 'kini', v: valAll });
    return pts;
  })();

  return (
    <>
      <section className="heroCard">
        <div className="ivLabel">{pxReady || !invAll ? 'Total Nilai Portofolio' : 'Memuat harga…'}</div>
        <div className="ivTotal">{idr(valAll)}</div>
        <div className={'big ' + (plAll >= 0 ? 'pos' : 'neg')} style={{ fontSize: 15 }}>
          {plAll >= 0 ? <Ic.up size={14} style={{ verticalAlign: '-2px' }} /> : <Ic.down size={14} style={{ verticalAlign: '-2px' }} />} {plAll >= 0 ? '+' : ''}{idr(plAll)} ({plPct.toFixed(2)}%)
        </div>
        <div className="mute" style={{ fontSize: 12 }}>Modal {idr(invAll)}</div>
        {spark.length > 1 && (
          <div style={{ marginTop: 8 }}>
            <ResponsiveContainer width="100%" height={56}>
              <AreaChart data={spark}>
                <defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--ac)" stopOpacity={0.5} /><stop offset="100%" stopColor="var(--ac)" stopOpacity={0} />
                </linearGradient></defs>
                <Area type="monotone" dataKey="v" stroke="var(--ac)" strokeWidth={2} fill="url(#sg)" />
              </AreaChart>
            </ResponsiveContainer>
            <div className="tag" style={{ textAlign: 'center' }}>Modal terpakai → titik terakhir: nilai kini</div>
          </div>
        )}
        <div className="tag" style={{ textAlign: 'center' }}>Simulasi harga pasar sungguhan — tanpa uang asli.{syncedAt && <> Harga terakhir disinkron {syncedAt}.</>}</div>
      </section>

      {msg && <div className="tag" style={{ textAlign: 'center' }}>{msg}</div>}

      {/* ── Pasar: pantau harga aset digital langsung — tanpa buka broker ── */}
      <section>
        <div className="row" style={{ border: 0 }}>
          <h2 style={{ margin: 0 }}>📈 Pasar Hari Ini</h2>
          <button className="link" onClick={() => refreshWatch(watchIds)} disabled={watchLoading}>{watchLoading ? 'Memuat…' : '⟳ Muat ulang'}</button>
        </div>
        {watchIds.length === 0 && <div className="tag">Semua aset disembunyikan — tambahkan lewat tombol di bawah.</div>}
        <div className="watchGrid">
          {watchIds.map(id => {
            const w = watch[id];
            const chg = w && w.prev ? ((w.p - w.prev) / w.prev) * 100 : null;
            return (
              <div key={id} className="watchCard" title={id}>
                <b>{label(id)}</b>
                {w ? <>
                  <div className="watchPx">{idr(w.p)}</div>
                  <div className={chg! >= 0 ? 'pos' : 'neg'} style={{ fontSize: 12, fontWeight: 700 }}>
                    {chg! >= 0 ? '▲' : '▼'} {chg! >= 0 ? '+' : ''}{chg!.toFixed(2)}%
                  </div>
                  <WatchSpark id={id} />
                  <div className="tag">{w.t}</div>
                </> : <div className="tag">{watchLoading ? 'Memuat harga…' : 'Gagal memuat'}</div>}
                <button className="watchX" onClick={() => setWatchIds(v => v.filter(x => x !== id))} aria-label="Sembunyikan">×</button>
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {WATCH.filter(id => !watchIds.includes(id)).map(id => (
            <button key={id} className="chip" onClick={() => { setWatchIds(v => [...v, id]); setTimeout(() => refreshWatch([id]), 50); }}>+ {label(id)}</button>
          ))}
        </div>
      </section>

      <div className="qaGrid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <button className="qaBtn" onClick={async () => { setMsg('Menyinkronkan…'); setMsg(await runAll()); setSyncedAt(new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })); }}>
          <span className="qaIco" style={{ background: 'rgba(34,197,94,.15)', color: '#22c55e' }}><Ic.up size={20} strokeWidth={2.2} /></span><span>Sinkron harga</span>
        </button>
        <button className="qaBtn" onClick={() => setSheet(true)}>
          <span className="qaIco" style={{ background: 'rgba(59,130,246,.15)', color: '#3b82f6' }}><Ic.plus size={20} strokeWidth={2.2} /></span><span>Rencana baru</span>
        </button>
      </div>
      {plans.length === 0 && (
        <section className="ivEmpty">
          <div className="ivEmptyIco">🌱</div>
          <b>Belum ada rencana investasi</b>
          <span>Yuk mulai nabung aset, Bos! Ketuk <b>Rencana baru</b> di atas — pilih nominal harian & alokasi (BTC, Emas, Saham), nanti DCA jalan otomatis tiap hari dengan harga pasar beneran (simulasi, tanpa uang asli).</span>
        </section>
      )}

      {plans.map(p => {
        const tr = trades.filter(t => t.planId === p.id);
        const by: Record<string, { q: number; c: number }> = {};
        tr.forEach(t => { by[t.symbol] = { q: (by[t.symbol]?.q || 0) + t.qty, c: (by[t.symbol]?.c || 0) + t.amount }; });
        const inv = tr.reduce((s, t) => s + t.amount, 0);
        const val = Object.entries(by).reduce((s, [k, v]) => s + v.q * (px[k] || 0), 0);
        const pl = val - inv;
        return (
          <section key={p.id}>
            <div className="row" style={{ border: 0 }}>
              <h2 style={{ margin: 0 }}>{p.name}</h2>
              <span className={'pillSm ' + (p.active ? 'pos' : 'mute')}>{p.active ? '● Aktif' : '⏸ Jeda'}</span>
            </div>
            <div className="mute" style={{ fontSize: 11, marginBottom: 6 }}>{idr(p.daily)}/hari · sejak {p.startDate}</div>
            <div className="big">{idr(val)}</div>
            <div className={pl >= 0 ? 'pos' : 'neg'} style={{ fontWeight: 700 }}>{pl >= 0 ? '+' : ''}{idr(pl)} ({inv ? ((pl / inv) * 100).toFixed(2) : '0.00'}%)</div>
            <div className="mute" style={{ fontSize: 12, marginBottom: 6 }}>Modal {idr(inv)} · {tr.length} pembelian</div>
            {Object.entries(by).map(([k, v]) => {
              const vv = v.q * (px[k] || 0);
              const share = val ? (vv / val) * 100 : 0;
              return (
                <div key={k} style={{ marginBottom: 8 }}>
                  <div className="row" style={{ border: 0, padding: '2px 0' }}>
                    <span>{label(k)}<span className="tag" style={{ display: 'block' }}>rata-rata {idr(v.c / v.q)} · {v.q.toPrecision(5)} unit</span></span>
                    <div style={{ textAlign: 'right' }}><b>{idr(vv)}</b><div className="tag">{share.toFixed(0)}%</div></div>
                  </div>
                  <div className="bar"><i style={{ width: share + '%' }} /></div>
                </div>
              );
            })}
            <div className="g2">
              <button className="btn alt" onClick={() => setDetailPlan(detailPlan === p.id ? null : p.id!)}>{detailPlan === p.id ? 'Tutup riwayat' : 'Riwayat pembelian'}</button>
              <button className="btn alt" onClick={() => db.plans.update(p.id!, { active: !p.active })}>{p.active ? 'Jeda' : 'Lanjutkan'}</button>
              <button className="btn alt" onClick={() => remove(p.id!)}>Hapus</button>
            </div>
            {detailPlan === p.id && (
              <div style={{ marginTop: 8, maxHeight: 220, overflowY: 'auto' }}>
                {[...tr].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30).map(t => (
                  <div key={t.id} className="row" style={{ border: 0, padding: '4px 0' }}>
                    <span>{t.date} · {label(t.symbol)}</span>
                    <div style={{ textAlign: 'right' }}><b>{idr(t.amount)}</b><div className="tag">{t.qty.toPrecision(5)} unit @ {idr(t.amount / t.qty)}</div></div>
                  </div>
                ))}
                {tr.length === 0 && <div className="tag">Belum ada pembelian — klik Sinkron harga.</div>}
              </div>
            )}
          </section>
        );
      })}

      {sheet && (
        <>
          <div className="sheetBk" onClick={() => setSheet(false)} />
          <div className="sheet">
            <div className="row" style={{ border: 0 }}>
              <h2 style={{ margin: 0 }}>Rencana DCA baru</h2>
              <button className="icobtn" onClick={() => setSheet(false)} aria-label="Kembali"><Ic.x size={18} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Nama rencana" />
              <div className="tag">Dana per hari: <b style={{ color: 'var(--ac)' }}>{idr(d)}</b></div>
              <input type="range" min={1000} max={100000000} step={1000} value={d} onChange={e => setDaily(e.target.value)} style={{ padding: 0, accentColor: 'var(--ac)' }} />
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {PRESET.map(n => <button key={n} className={'chip' + (num(daily) === n ? ' on' : '')} onClick={() => setDaily(String(n))}>{short(n)}</button>)}
              </div>
              <input inputMode="numeric" value={daily} onChange={e => setDaily(e.target.value)} placeholder="Atau ketik nominal…" />
              <div className="tag">Mulai dari tanggal (pilih tanggal lampau untuk backtest)</div>
              <input type="date" value={start} max={today()} onChange={e => setStart(e.target.value)} />
              <h2 style={{ margin: '4px 0 0' }}>Alokasi (%)</h2>
              {[...ASSETS.map(a => a.id), ...Object.keys(pct).filter(k => !ASSETS.some(a => a.id === k))].map(id => (
                <div className="row" key={id} style={{ border: 0, padding: '3px 0' }}><span>{label(id)}</span><input style={{ width: 80, textAlign: 'right' }} inputMode="numeric" value={pct[id] || ''} onChange={e => setPct({ ...pct, [id]: e.target.value })} /></div>
              ))}
              <div className="g2">
                <input placeholder="Aset lain, mis. bn:XRPUSDT" value={custom} onChange={e => setCustom(e.target.value)} />
                <button className="btn alt" onClick={() => { if (/^(bn|yf):.+/.test(custom)) { setPct({ ...pct, [custom]: '0' }); setCustom(''); } }}>Tambah</button>
              </div>
              <div className={total === 100 ? 'pos' : 'neg'} style={{ fontWeight: 700 }}>Total {total}% · {idr(d)} per hari</div>
              {total === 100 && (
                <div className="tag">
                  Estimasi 30 hari (harga kini): {Object.entries(pct).filter(([,v]) => num(v) > 0).map(([k, v]) => {
                    const w = watch[k]; const pxk = w?.p || px[k] || 0;
                    const budget = d * num(v) / 100;
                    return `${label(k)} ${(budget && pxk ? (budget / pxk).toFixed(6) : '…')} unit/hari`;
                  }).join(' · ')}
                </div>
              )}
              <button className="btn" onClick={create}>Mulai simulasi</button>
              <div className="tag">bn: = Binance (USDT), yf: = Yahoo Finance (saham IDX .JK). Akhir pekan/libur bursa dilewati.</div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
