import { db, DcaPlan, Trade } from './db';
import { addDays, today } from './util';
import { isIDR, series, usdIdrSeries, label as labelOf } from './market';

// Kunci per plan mencegah pemanggilan bersamaan dalam satu tab.
// Pemeriksaan idempotensi di transaksi IndexedDB juga melindungi dari tab/perangkat
// yang menjalankan sinkronisasi pada rentang tanggal yang sama.
const runningPlans = new Map<number, Promise<number>>();

async function runPlanUnlocked(plan: DcaPlan): Promise<number> {
  const t = today();
  const from = plan.lastRun ? addDays(plan.lastRun, 1) : plan.startDate;
  if (from > t) return 0;

  const total = Object.values(plan.alloc).reduce((s, v) => s + v, 0);
  if (total < 99 || total > 101) throw new Error(`${plan.name}: total alokasi ${total.toFixed(1)}% tidak valid`);
  const norm = total / 100;

  const assets = Object.keys(plan.alloc);
  const usdAssets = assets.filter(a => !isIDR(a));
  const fx = usdAssets.length ? await usdIdrSeries(from) : null;
  const ser: Record<string, Record<string, number>> = {};
  const failed: string[] = [];
  for (let i = 0; i < assets.length; i++) {
    try { ser[assets[i]] = await series(assets[i], from); }
    catch { failed.push(assets[i]); } // 1 aset gagal jangan batalin seluruh plan
    if (i < assets.length - 1) await new Promise(r => setTimeout(r, 300));
  }
  if (failed.length === assets.length) throw new Error(`${plan.name}: semua sumber harga gagal (${failed.map(labelOf).join(', ')})`);

  // alokasi dinormalisasi ulang hanya dari aset yang harganya tersedia
  const okAlloc = Object.fromEntries(Object.entries(plan.alloc).filter(([a]) => ser[a]));
  const okTotal = Object.values(okAlloc).reduce((s, v) => s + v, 0);
  if (!okTotal) return 0;
  const okNorm = okTotal / 100;
  const rows: Trade[] = [];
  for (let d = from; d <= t; d = addDays(d, 1)) {
    for (const [a, pct] of Object.entries(okAlloc)) {
      const px = ser[a][d];
      if (!px || !Number.isFinite(px) || px <= 0) continue;
      const exchangeRate = isIDR(a) ? 1 : fx?.[d];
      if (!Number.isFinite(exchangeRate) || exchangeRate! <= 0) {
        throw new Error(`Kurs USD/IDR historis tidak tersedia untuk ${d}; pembelian DCA dibatalkan agar nilai tidak direkayasa.`);
      }
      const price = px * exchangeRate!;
      const amount = (plan.daily * pct) / (100 * okNorm);
      const qty = price > 0 ? amount / price : 0;
      if (Number.isFinite(price) && Number.isFinite(qty) && qty > 0) {
        rows.push({ planId: plan.id!, date: d, symbol: a, price, amount, qty });
      }
    }
  }
  if (!rows.length) return 0;

  let inserted = 0;
  await db.transaction('rw', db.trades, db.plans, async () => {
    const existing = await db.trades.where('planId').equals(plan.id!).toArray();
    const keys = new Set(existing.map(r => `${r.date}|${r.symbol}`));
    const fresh = rows.filter(r => {
      const key = `${r.date}|${r.symbol}`;
      if (keys.has(key)) return false;
      keys.add(key);
      return true;
    });
    if (fresh.length) await db.trades.bulkAdd(fresh);
    inserted = fresh.length;

    // Jangan menggeser lastRun ke belakang. Baris yang sudah ada tetap dihitung
    // sebagai telah diproses, sehingga retry tidak menggandakan pembelian.
    const latestProcessed = rows.reduce((m, r) => r.date > m ? r.date : m, plan.lastRun || plan.startDate);
    // Jika salah satu sumber aset gagal, jangan majukan cursor global.
    // Pembelian aset yang berhasil tetap aman karena idempotensi date|symbol;
    // retry berikutnya bisa mengejar aset yang tadi gagal tanpa menggandakan trade.
    if (failed.length === 0) {
      // Baca cursor terbaru di dalam transaksi. Dua tab bisa mulai dari snapshot
      // berbeda; membandingkan hanya dengan plan.lastRun lama bisa memundurkan cursor.
      const currentPlan = await db.plans.get(plan.id!);
      if (currentPlan && latestProcessed > (currentPlan.lastRun || '')) {
        await db.plans.update(plan.id!, { lastRun: latestProcessed });
      }
    }
  });
  return inserted;
}

export async function runPlan(plan: DcaPlan): Promise<number> {
  if (plan.id == null) throw new Error('ID rencana DCA tidak valid.');
  const active = runningPlans.get(plan.id);
  if (active) return active;

  const task = runPlanUnlocked(plan);
  runningPlans.set(plan.id, task);
  try {
    return await task;
  } finally {
    if (runningPlans.get(plan.id) === task) runningPlans.delete(plan.id);
  }
}

export async function runAll(): Promise<string> {
  if (!navigator.onLine) return 'Offline: simulasi dilanjutkan saat online.';
  let n = 0;
  const errs: string[] = [];
  const plans = await db.plans.filter(p => p.active).toArray();
  for (const p of plans) {
    try {
      n += await runPlan(p);
    } catch (e: any) {
      errs.push(`${p.name}: ${e?.message || e}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }
  if (errs.length && !n) return 'Gagal sinkron: ' + errs.join(' · ');
  if (errs.length) return `${n} pembelian ditambahkan. Catatan: ${errs.join(' · ')}`;
  return n ? `${n} pembelian simulasi ditambahkan.` : 'Sudah terbaru.';
}
