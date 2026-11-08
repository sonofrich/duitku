import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Cell, Pie, PieChart, Tooltip } from 'recharts';
import { db } from '../db';
import { idr, num, saveFile, today } from '../util';
import { Ic, Deco } from '../icons';

const OUT = ['Makan', 'Transport', 'Belanja', 'Tagihan', 'Hiburan', 'Kesehatan', 'Pendidikan', 'Lainnya'];
const IN = ['Gaji', 'Bonus', 'Usaha', 'Investasi', 'Lainnya'];
const COL = ['#0e6b5c', '#b8862b', '#3f7cac', '#b3392f', '#7a5195', '#5f9e6e', '#d08c60', '#6b7b8c'];
const CAT_ICON: Record<string, any> = {
  Makan: 'fluent-emoji:fork-and-knife-with-plate', Transport: 'fluent-emoji:bus', Belanja: 'fluent-emoji:shopping-bags',
  Tagihan: 'fluent-emoji:receipt', Hiburan: 'fluent-emoji:clapper-board', Kesehatan: 'fluent-emoji:pill',
  Pendidikan: 'fluent-emoji:graduation-cap', Gaji: 'fluent-emoji:money-bag', Bonus: 'fluent-emoji:party-popper',
  Usaha: 'fluent-emoji:briefcase', Investasi: 'fluent-emoji:chart-increasing',
};

// Terinspirasi Ivy Wallet: FAB quick-add, quick actions grid, kategori chip, riwayat per tanggal
export default function Finance() {
  const accounts = useLiveQuery(() => db.accounts.toArray(), []) || [];
  const txs = useLiveQuery(() => db.txs.orderBy('date').reverse().toArray(), []) || [];
  const budgets = useLiveQuery(() => db.budgets.toArray(), []) || [];
  const [sheet, setSheet] = useState<'' | 'in' | 'out' | 'tf' | 'acc' | 'budget'>('');
  const [f, setF] = useState({ amount: '', category: 'Makan', accountId: 0, toId: 0, note: '', date: today() });
  const [acc, setAcc] = useState({ name: '', balance0: '' });
  const [bd, setBd] = useState({ category: 'Makan', limit: '' });
  const [ed, setEd] = useState<{ id: number; amount: string; category: string; note: string; date: string } | null>(null);
  useEffect(() => { if (accounts.length && !f.accountId) setF(x => ({ ...x, accountId: accounts[0].id!, toId: accounts[0].id! })); }, [accounts.length]);

  // Beranda: kartu Pemasukan/Pengeluaran minta buka sheet catat otomatis
  useEffect(() => {
    const h = (e: Event) => { const k = (e as CustomEvent).detail; if (k === 'in' || k === 'out') setSheet(k); };
    window.addEventListener('duitku:newsheet', h);
    return () => window.removeEventListener('duitku:newsheet', h);
  }, []);

  const bal = (id: number) => (accounts.find(a => a.id === id)?.balance0 || 0) +
    txs.filter(t => t.accountId === id).reduce((s, t) => s + (t.type === 'in' ? t.amount : -t.amount), 0);
  const m = today().slice(0, 7);
  const spent: Record<string, number> = {};
  txs.filter(t => t.date.startsWith(m) && t.type === 'out' && t.category !== 'Transfer')
    .forEach(t => (spent[t.category] = (spent[t.category] || 0) + t.amount));
  const pie = Object.entries(spent).map(([name, value]) => ({ name, value }));
  const total = accounts.reduce((s, a) => s + bal(a.id!), 0);
  const outToday = txs.filter(t => t.date === today() && t.type === 'out' && t.category !== 'Transfer').reduce((s, t) => s + t.amount, 0);
  const inToday = txs.filter(t => t.date === today() && t.type === 'in' && t.category !== 'Transfer').reduce((s, t) => s + t.amount, 0);
  const mOut = txs.filter(t => t.date.startsWith(m) && t.type === 'out' && t.category !== 'Transfer').reduce((s, t) => s + t.amount, 0);
  const mIn = txs.filter(t => t.date.startsWith(m) && t.type === 'in' && t.category !== 'Transfer').reduce((s, t) => s + t.amount, 0);
  const overBudget = budgets.filter(b => (spent[b.category] || 0) > b.limit).length;

  // ── Net Worth: aset = kas + portofolio (nilai kini dari harga terakhir di KV) ──
  const tradesNW = useLiveQuery(() => db.trades.toArray(), []) || [];
  const marketCache = useLiveQuery(() => db.kv.toArray(), []) || [];
  const priceBySymbol = new Map(marketCache.filter(x => x.key.startsWith('px:')).map(x => [x.key.slice(3), Number(x.value)]));
  const pfVal = tradesNW.reduce((sum, trade) => {
    const price = priceBySymbol.get(trade.symbol) || 0;
    return sum + (Number.isFinite(price) && price > 0 ? trade.qty * price : 0);
  }, 0);
  const netWorth = total + pfVal;

  const add = async (type: string) => {
    const amount = num(f.amount);
    if (!amount) return;
    if (type === 'tf') {
      if (!f.toId || !accounts.some(a => a.id === f.toId)) return; // rekening tujuan wajib valid
      if (f.accountId === f.toId) return;
      const transferId = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `tf-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await db.txs.bulkAdd([
        { date: f.date, type: 'out', amount, category: 'Transfer', accountId: f.accountId, note: f.note || 'Transfer keluar', transferId },
        { date: f.date, type: 'in', amount, category: 'Transfer', accountId: f.toId, note: f.note || 'Transfer masuk', transferId }
      ]);
    } else await db.txs.add({ date: f.date, type: type as 'in' | 'out', amount, category: f.category, accountId: f.accountId, note: f.note });
    setF({ ...f, amount: '', note: '' });
    setSheet('');
  };
  const deleteTransfer = async (transferId: string) => {
    if (!confirm('Hapus kedua sisi transfer ini?')) return;
    await db.transaction('rw', db.txs, async () => {
      await db.txs.where('transferId').equals(transferId).delete();
    });
  };
  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""').replace(/[\r\n]+/g, ' ')}"`;
  const csv = () => saveFile('transaksi.csv', 'tanggal,jenis,jumlah,kategori,akun,catatan\n' +
    txs.map(t => [esc(t.date), esc(t.type), esc(t.amount), esc(t.category), esc(accounts.find(a => a.id === t.accountId)?.name), esc(t.note)].join(',')).join('\n'));

  // ── filter & pencarian riwayat ──
  const [fq, setFq] = useState('');
  const [fCat, setFCat] = useState('');
  const [fMonth, setFMonth] = useState('');
  const filtered = useMemo(() => txs
    .filter(t => !fMonth || t.date.startsWith(fMonth))
    .filter(t => !fCat || t.category === fCat)
    .filter(t => !fq || (t.category + ' ' + (t.note || '') + ' ' + t.amount).toLowerCase().includes(fq.toLowerCase())), [txs, fq, fCat, fMonth]);
  // kelompokkan riwayat per tanggal (sudah terfilter)
  const byDay: Record<string, typeof txs> = {};
  filtered.slice(0, 60).forEach(t => ((byDay[t.date] = byDay[t.date] || []).push(t)));
  const monthsAvail = [...new Set(txs.map(t => t.date.slice(0, 7)))].sort().reverse();

  const Sheet = () => !sheet ? null : (
    <>
      <div className="sheetBk" onClick={() => setSheet('')} />
      <div className="sheet">
        <div className="sheetBar" />
        {['in', 'out', 'tf', 'acc', 'budget'].includes(sheet) && (
          <>
            <div className="row" style={{ border: 0 }}>
              <h2 style={{ margin: 0 }}>{sheet === 'in' ? 'Pemasukan' : sheet === 'out' ? 'Pengeluaran' : sheet === 'tf' ? 'Transfer' : sheet === 'acc' ? 'Rekening baru' : 'Anggaran baru'}</h2>
              <button className="icobtn" onClick={() => setSheet('')} aria-label="Tutup"><Ic.x size={18} /></button>
            </div>
            {sheet === 'acc' ? (
              <>
                <input placeholder="Nama rekening" value={acc.name} onChange={e => setAcc({ ...acc, name: e.target.value })} />
                <input placeholder="Saldo awal" inputMode="numeric" value={acc.balance0} onChange={e => setAcc({ ...acc, balance0: e.target.value })} />
                <button className="btn" onClick={async () => { if (acc.name) { await db.accounts.add({ name: acc.name, balance0: num(acc.balance0) }); setAcc({ name: '', balance0: '' }); setSheet(''); } }}>Simpan rekening</button>
              </>
            ) : sheet === 'budget' ? (
              <>
                <select value={bd.category} onChange={e => setBd({ ...bd, category: e.target.value })}>{OUT.map(c => <option key={c}>{c}</option>)}</select>
                <input placeholder="Batas (Rp)" inputMode="numeric" value={bd.limit} onChange={e => setBd({ ...bd, limit: e.target.value })} />
                <button className="btn" onClick={async () => { if (num(bd.limit)) { const ex = budgets.find(b => b.category === bd.category); if (ex) await db.budgets.update(ex.id!, { limit: num(bd.limit) }); else await db.budgets.add({ category: bd.category, limit: num(bd.limit) }); setBd({ ...bd, limit: '' }); setSheet(''); } }}>Simpan anggaran</button>
              </>
            ) : (
              <>
                <input placeholder="Jumlah (Rp)" inputMode="numeric" autoFocus value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} />
                <input type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} />
                {sheet !== 'tf' && (
                  <div className="chipWrap">
                    {(sheet === 'in' ? IN : OUT).map(c => (
                      <button key={c} className={'chip' + (f.category === c ? ' on' : '')} onClick={() => setF({ ...f, category: c })}>
                        {CAT_ICON[c] && <Icon icon={CAT_ICON[c]} width={14} />} {c}
                      </button>
                    ))}
                  </div>
                )}
                <div className="g2">
                  <select value={f.accountId} onChange={e => setF({ ...f, accountId: +e.target.value })}>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
                  {sheet === 'tf' && <select value={f.toId} onChange={e => setF({ ...f, toId: +e.target.value })}>{accounts.map(a => <option key={a.id} value={a.id}>ke {a.name}</option>)}</select>}
                </div>
                <input placeholder="Catatan" value={f.note} onChange={e => setF({ ...f, note: e.target.value })} />
                <button className="btn" onClick={() => add(sheet)}>Simpan transaksi</button>
              </>
            )}
          </>
        )}
      </div>
    </>
  );

  const [Icon, setIcon] = useState<any>(null);
  useEffect(() => { import('@iconify/react').then(m => setIcon(() => m.Icon)); }, []);

  const IconWrap = ({ N }: { N: any }) => <N size={20} strokeWidth={2.2} />;
  const QA = ({ t, label, color, icon }: { t: 'in' | 'out' | 'tf' | 'acc'; label: string; color: string; icon: any }) => (
    <button className="qaBtn" onClick={() => { setSheet(t); setF(x => ({ ...x, category: t === 'in' ? IN[0] : OUT[0] })); }}>
      <span className="qaIco" style={{ background: color + '22', color }}><IconWrap N={icon} /></span>
      <span>{label}</span>
    </button>
  );

  return (
    <>
      {/* Kartu saldo ala Ivy: total + in/out bulan ini */}
      <section className="ivBalance">
        <div className="ivLabel">Total Saldo</div>
        <div className="ivTotal">{idr(total)}</div>
        <div className="ivRow">
          <span className="pos"><Ic.down size={13} strokeWidth={2.6} /> Masuk bulan ini {idr(mIn)}</span>
          <span className="neg"><Ic.up size={13} strokeWidth={2.6} /> Keluar bulan ini {idr(mOut)}</span>
        </div>
        {overBudget > 0 && <div className="ivWarn">⚠ {overBudget} anggaran terlampaui</div>}
      </section>

      {/* Net Worth Tracker: kas + portofolio */}
      <section className="ivBalance" style={{ paddingTop: 14 }}>
        <div className="ivLabel">Net Worth (Kas + Portofolio)</div>
        <div className="ivTotal">{idr(netWorth)}</div>
        <div className="ivRow">
          <span className="mute">Kas {idr(total)}</span>
          <span className="mute">Portofolio {idr(pfVal)}</span>
        </div>
        <div className="tag" style={{ textAlign: 'center' }}>Kekayaan bersih = saldo semua rekening + nilai investasi kini</div>
      </section>

      {/* Quick actions ala Ivy Wallet */}
      <div className="qaGrid">
        <QA t="out" label="Keluar" color="#f43f5e" icon={Ic.minus} />
        <QA t="in" label="Masuk" color="#22c55e" icon={Ic.plus} />
        <QA t="tf" label="Transfer" color="#3b82f6" icon={Ic.arrow} />
        <QA t="acc" label="Rekening" color="#a855f7" icon={Ic.wallet} />
      </div>

      <section>
        <h2>Rekening</h2>
        {accounts.map(a => (
          <div className="row" key={a.id}>
            <span><span className="qaIco" style={{ background: 'rgba(59,130,246,.15)', color: '#3b82f6', width: 26, height: 26, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginRight: 8 }}><Ic.wallet size={14} /></span>{a.name}</span>
            <b>{idr(bal(a.id!))}</b>
          </div>
        ))}
      </section>

      <section>
        <h2>Anggaran bulanan</h2>
        {budgets.length === 0 && <div className="mute">Belum ada anggaran. Ketuk tombol anggaran di quick actions.</div>}
        {budgets.map(b => {
          const s = spent[b.category] || 0, p = Math.min(100, (s / b.limit) * 100);
          return (
            <div key={b.id} style={{ marginBottom: 10 }}>
              <div className="row" style={{ border: 0, padding: '4px 0' }}>
                <span>{b.category}</span><span className={s > b.limit ? 'neg' : 'mute'}>{idr(s)} / {idr(b.limit)}</span>
                <button className="link" onClick={() => db.budgets.delete(b.id!)}>Hapus</button>
              </div>
              <div className="bar"><i className={s > b.limit ? 'over' : ''} style={{ width: p + '%' }} /></div>
            </div>
          );
        })}
      </section>

      {pie.length > 0 && (
        <section>
          <h2>Pengeluaran bulan ini</h2>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <PieChart width={220} height={200}>
              <Pie data={pie} dataKey="value" nameKey="name" outerRadius={85} innerRadius={45}>{pie.map((_, i) => <Cell key={i} fill={COL[i % COL.length]} />)}</Pie>
              <Tooltip formatter={(v: number) => idr(v)} />
            </PieChart>
          </div>
          {pie.map((p, i) => <div className="row" key={p.name}><span style={{ color: COL[i % COL.length] }}>● {p.name}</span><b>{idr(p.value)}</b></div>)}
        </section>
      )}

      <section>
        <h2>Riwayat transaksi</h2>
        {(txs.length > 0) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
            <input placeholder="Cari (kategori, catatan, nominal…)" value={fq} onChange={e => setFq(e.target.value)} />
            <div className="g2">
              <select value={fCat} onChange={e => setFCat(e.target.value)}>
                <option value="">Semua kategori</option>
                {[...IN, ...OUT].map(c => <option key={c}>{c}</option>)}
              </select>
              <select value={fMonth} onChange={e => setFMonth(e.target.value)}>
                <option value="">Semua bulan</option>
                {monthsAvail.map(mm => <option key={mm}>{mm}</option>)}
              </select>
            </div>
            {(fq || fCat || fMonth) && <button className="link" onClick={() => { setFq(''); setFCat(''); setFMonth(''); }}>✕ Bersihkan filter</button>}
          </div>
        )}
        {txs.length === 0 && <div className="mute">Belum ada transaksi.</div>}
        {Object.entries(byDay).map(([date, list]) => (
          <div key={date} className="dayGroup">
            <div className="dayHead"><span>{date === today() ? 'Hari ini' : date}</span><span className="mute">
              {idr(list.filter(t => t.type === 'in').reduce((s, t) => s + t.amount, 0) - list.filter(t => t.type === 'out').reduce((s, t) => s + t.amount, 0))}</span></div>
            {list.length === 0 && <div className="mute" style={{ padding: '8px 0' }}>Gak ada yang cocok dengan filter.</div>}
            {list.map(t => (
              <div className="row" key={t.id}>
                <span className="qaIco" style={{ background: t.type === 'in' ? 'rgba(34,197,94,.15)' : 'rgba(244,63,94,.12)', color: t.type === 'in' ? '#22c55e' : '#f43f5e' }}>
                  {Icon && CAT_ICON[t.category] ? <Icon icon={CAT_ICON[t.category]} width={15} /> : t.type === 'in' ? '↓' : '↑'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}><div>{t.category}{t.note ? ` · ${t.note}` : ''}</div><div className="tag">{accounts.find(a => a.id === t.accountId)?.name}</div></div>
                <div style={{ textAlign: 'right' }}>
                  <b className={t.type === 'in' ? 'pos' : 'neg'}>{t.type === 'in' ? '+' : '-'}{idr(t.amount)}</b><br />
                  {t.category === 'Transfer' ? (
                    t.transferId ? <button className="link" onClick={() => deleteTransfer(t.transferId!)}>Hapus transfer</button>
                      : <span className="tag">Transfer lama: edit/hapus dinonaktifkan demi keamanan saldo</span>
                  ) : <>
                    <button className="link" onClick={() => setEd({ id: t.id!, amount: String(t.amount), category: t.category, note: t.note || '', date: t.date })}>Edit</button>
                    <button className="link" onClick={() => db.txs.delete(t.id!)}>Hapus</button>
                  </>}
                </div>
              </div>
            ))}
          </div>
        ))}
        <button className="btn alt" onClick={csv}>Ekspor CSV</button>
      </section>

      {/* Sheet edit transaksi */}
      {ed && (
        <>
          <div className="sheetBk" onClick={() => setEd(null)} />
          <div className="sheet">
            <div className="sheetBar" />
            <div className="row" style={{ border: 0 }}>
              <h2 style={{ margin: 0 }}>Edit transaksi</h2>
              <button className="icobtn" onClick={() => setEd(null)} aria-label="Tutup"><Ic.x size={18} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <input inputMode="numeric" placeholder="Nominal (Rp)" value={ed.amount} onChange={e => setEd({ ...ed, amount: e.target.value })} />
              <select value={ed.category} onChange={e => setEd({ ...ed, category: e.target.value })}>{(ed.category === 'Transfer' ? ['Transfer'] : (txs.find(t => t.id === ed.id)?.type === 'in' ? IN : OUT)).map(c => <option key={c}>{c}</option>)}</select>
              <input type="date" value={ed.date} onChange={e => setEd({ ...ed, date: e.target.value })} />
              <input placeholder="Catatan" value={ed.note} onChange={e => setEd({ ...ed, note: e.target.value })} />
              <button className="btn" onClick={async () => {
                if (!num(ed.amount)) return;
                await db.txs.update(ed.id, { amount: num(ed.amount), category: ed.category, note: ed.note, date: ed.date });
                setEd(null);
              }}>Simpan perubahan</button>
            </div>
          </div>
        </>
      )}

      {/* FAB tambah cepat */}
      <button className="fab" onClick={() => { setSheet('out'); setF(x => ({ ...x, category: OUT[0] })); }} aria-label="Catat transaksi"><Ic.plus size={24} strokeWidth={2.5} /></button>
      <Sheet />
    </>
  );
}
