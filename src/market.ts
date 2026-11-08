import { getKv, setKv } from './db';
import { addDays, parse, today, ymd } from './util';
import { loadCfg } from './ai';

// id aset: "bn:SIMBOL" = Binance (USDT), "yf:SIMBOL" = Yahoo Finance
export const ASSETS = [
  { id: 'bn:BTCUSDT', label: 'Bitcoin' },
  { id: 'bn:ETHUSDT', label: 'Ethereum' },
  { id: 'bn:BNBUSDT', label: 'BNB' },
  { id: 'bn:SOLUSDT', label: 'Solana' },
  { id: 'bn:PAXGUSDT', label: 'Emas (PAXG)' },
  { id: 'yf:GC=F', label: 'Emas (futures)' },
  { id: 'yf:BBCA.JK', label: 'BBCA' },
  { id: 'yf:BBRI.JK', label: 'BBRI' },
  { id: 'yf:TLKM.JK', label: 'TLKM' },
  { id: 'yf:AAPL', label: 'Apple (AAPL)' }
];
export const label = (id: string) => ASSETS.find(a => a.id === id)?.label ?? id.slice(3);
export const isIDR = (id: string) => id.endsWith('.JK');

// Header Binance API key (opsional, menaikkan rate limit) — hanya di native/Capacitor.
// Di browser mengirim header arbitrary ke Binance memicu preflight CORS yang tidak diizinkan,
// jadi key hanya dipakai di APK (CapacitorHttp lewat jalur native, bebas CORS).
// Proxy Yahoo (CORS) — Cloudflare Worker dengan retry otomatis antar host
const YPROXY = 'https://yproxy.thin-engine-a04.workers.dev/';

function bH(): Record<string, string> | undefined {
  const key = loadCfg().binanceKey;
  if (!key) return undefined;
  const isNative = typeof (window as any).Capacitor !== 'undefined' && !(window as any).Capacitor.isWebPlatform?.();
  return isNative ? { 'X-MBX-APIKEY': key } : undefined;
}

export async function usdIdr(): Promise<number> {
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/USD');
    if (!r.ok) throw new Error('Kurs USD/IDR HTTP ' + r.status);
    const j = await r.json();
    const v = Number(j?.rates?.IDR);
    if (!Number.isFinite(v) || v <= 0) throw new Error('Kurs USD/IDR tidak valid');
    await setKv('usdidr', v);
    return v;
  } catch {
    const cached = Number(await getKv('usdidr', 0));
    if (Number.isFinite(cached) && cached > 0) return cached;
    throw new Error('Kurs USD/IDR tidak tersedia dan cache belum valid');
  }
}

// ── Kurs USD/IDR HISTORIS (frankfurter.app — data ECB, gratis, tanpa key) ──
// Dipakai DCA agar pembelian historis memakai kurs sesuai tanggalnya, bukan kurs hari ini.
// Return { 'YYYY-MM-DD': kurs } utk rentang from..today; weekend/libur → kurs hari kerja terakhir.
export async function usdIdrSeries(from: string): Promise<Record<string, number>> {
  const cacheKey = 'fxusd:v2:' + from;
  const cached = await getKv(cacheKey, null) as Record<string, number> | null;
  const end = today();
  const cacheCoversRange = cached && typeof cached === 'object' &&
    Number.isFinite(cached[from]) && cached[from] > 0 &&
    Number.isFinite(cached[end]) && cached[end] > 0;
  if (cacheCoversRange) return cached!;

  // Ambil beberapa hari sebelum tanggal awal agar akhir pekan/libur di awal
  // rentang bisa memakai kurs hari kerja sebelumnya, bukan kurs masa depan.
  const requestFrom = addDays(from, -7);
  const u = `https://api.frankfurter.dev/v1/${requestFrom}..${end}?from=USD&to=IDR`;
  const r = await fetch(u);
  if (!r.ok) throw new Error('Kurs historis USD/IDR gagal (HTTP ' + r.status + ')');
  const j = await r.json();
  const out: Record<string, number> = {};
  for (const [date, rates] of Object.entries(j?.rates || {})) {
    const value = Number((rates as any)?.IDR);
    if (Number.isFinite(value) && value > 0) out[date] = value;
  }
  const dates = Object.keys(out).sort();
  if (!dates.length) throw new Error('Kurs historis USD/IDR kosong atau tidak didukung sumber data');
  let last = 0;
  for (const date of dates) if (date <= from) last = out[date];
  if (!last) throw new Error('Kurs historis USD/IDR tidak mencakup tanggal awal ' + from);
  const result: Record<string, number> = {};
  for (let d = from; d <= end; d = addDays(d, 1)) {
    if (out[d]) last = out[d];
    result[d] = last;
  }
  if (!result[end]) throw new Error('Kurs historis USD/IDR tidak mencakup hari ini');
  await setKv(cacheKey, result);
  return result;
}

// Harga penutupan harian dalam mata uang asli aset: { 'YYYY-MM-DD': harga }
export async function series(id: string, from: string): Promise<Record<string, number>> {
  const src = id.slice(0, 2), sym = id.slice(3);
  const out: Record<string, number> = {};
  if (src === 'bn') {
    let start = parse(from).getTime();
    for (let i = 0; i < 10; i++) {
      const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1d&startTime=${start}&limit=1000`, { headers: bH() });
      const k = await r.json();
      if (!Array.isArray(k)) throw new Error('Binance: ' + (k?.msg || 'gagal'));
      if (!k.length) break;
      for (const c of k) out[ymd(new Date(c[0]))] = parseFloat(c[4]);
      start = k[k.length - 1][0] + 86400000;
      if (k.length < 1000) break;
    }
  } else {
    const p1 = Math.floor(parse(from).getTime() / 1000) - 86400;
    const p2 = Math.floor(Date.now() / 1000) + 86400;
    // Yahoo tidak mengirim CORS → web lewat proxy worker (retry otomatis), native langsung
    const isNative = typeof (window as any).Capacitor?.isNativePlatform === 'function' && (window as any).Capacitor.isNativePlatform();
    const url = isNative
      ? `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=${p1}&period2=${p2}&interval=1d&events=div%2Csplit`
      : `${YPROXY}?s=${encodeURIComponent(sym)}&p1=${p1}&p2=${p2}`;
    let res: any = null;
    for (let att = 0; att < 3 && !res; att++) {
      try {
        const r = await fetch(url, isNative ? { headers: { 'User-Agent': 'Mozilla/5.0' } } as any : {});
        res = (await r.json())?.chart?.result?.[0];
      } catch { await new Promise(r => setTimeout(r, 800 + att * 600)); }
    }
    if (!res) throw new Error('Yahoo: data tidak ditemukan untuk ' + sym);
    const ts: number[] = res.timestamp || [];
    const cl: number[] = res.indicators?.adjclose?.[0]?.adjclose || res.indicators?.quote?.[0]?.close || [];
    ts.forEach((t, i) => { if (cl[i] != null) out[ymd(new Date(t * 1000))] = cl[i]; });
  }
  return out;
}

// Harga terakhir dalam rupiah. Offline -> pakai harga cache terakhir.
export async function latest(id: string): Promise<number> {
  try {
    const rate = await usdIdr();
    let p: number;
    if (id.startsWith('bn:')) {
      const r = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${id.slice(3)}`, { headers: bH() });
      p = parseFloat((await r.json()).price);
    } else {
      const s = await series(id, addDays(today(), -7));
      const ks = Object.keys(s).sort();
      p = s[ks[ks.length - 1]];
      if (!p) throw new Error('harga kosong');
    }
    const v = isIDR(id) ? p : p * rate;
    if (v) await setKv('px:' + id, v);
    return v || getKv('px:' + id, 0);
  } catch { return getKv('px:' + id, 0); }
}
