// Agent tools: AI bisa MEMBACA & MENGEDIT data app (pola Vercel AI SDK function calling).
// Loop: kirim tools -> model balas tool_calls -> app eksekusi -> kirim hasil -> jawaban final.
import type { Msg, Cfg } from './ai';

export const AGENT_TOOLS = [
  { type: 'function', function: { name: 'get_summary', description: 'Ambil ringkasan data pengguna: saldo per rekening, pemasukan/pengeluaran bulan & hari ini, per kategori, tugas hari ini, ringkas DCA.', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'list_transactions', description: 'Daftar transaksi. Opsional: date (YYYY-MM-DD), month (YYYY-MM), category, type (in/out), limit (default 20).', parameters: { type: 'object', properties: { date: { type: 'string' }, month: { type: 'string' }, category: { type: 'string' }, type: { type: 'string' }, limit: { type: 'number' } }, required: [] } } },
  { type: 'function', function: { name: 'add_transaction', description: 'Catat transaksi baru. date YYYY-MM-DD (default hari ini), type in/out, amount rupiah, category (Makan/Transport/Belanja/Tagihan/Hiburan/Kesehatan/Pendidikan/Gaji/Bonus/Usaha/Investasi/Lainnya), accountId opsional, note.', parameters: { type: 'object', properties: { date: { type: 'string' }, type: { type: 'string', enum: ['in', 'out'] }, amount: { type: 'number' }, category: { type: 'string' }, accountId: { type: 'number' }, note: { type: 'string' } }, required: ['type', 'amount'] } } },
  { type: 'function', function: { name: 'delete_transaction', description: 'Hapus transaksi by id.', parameters: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] } } },
  { type: 'function', function: { name: 'list_tasks', description: 'Daftar tugas. Opsional: date (YYYY-MM-DD, default hari ini), all (true = semua).', parameters: { type: 'object', properties: { date: { type: 'string' }, all: { type: 'boolean' } }, required: [] } } },
  { type: 'function', function: { name: 'add_task', description: 'Buat tugas/jadwal. title wajib; date YYYY-MM-DD, time HH:MM, priority 1 tinggi/2 sedang/3 rendah, repeat none/daily/weekly/monthly.', parameters: { type: 'object', properties: { title: { type: 'string' }, date: { type: 'string' }, time: { type: 'string' }, priority: { type: 'number', enum: [1, 2, 3] }, repeat: { type: 'string', enum: ['none', 'daily', 'weekly', 'monthly'] } }, required: ['title'] } } },
  { type: 'function', function: { name: 'complete_task', description: 'Tandai tugas selesai by id atau by title (mengandung kata).', parameters: { type: 'object', properties: { id: { type: 'number' }, title: { type: 'string' } }, required: [] } } },
  { type: 'function', function: { name: 'delete_task', description: 'Hapus tugas by id.', parameters: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] } } },
  { type: 'function', function: { name: 'list_accounts', description: 'Daftar rekening + saldo saat ini.', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'list_budgets', description: 'Daftar anggaran bulanan + pemakaian bulan ini.', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'set_budget', description: 'Set/update anggaran bulanan per kategori (limit rupiah).', parameters: { type: 'object', properties: { category: { type: 'string' }, limit: { type: 'number' } }, required: ['category', 'limit'] } } },
  { type: 'function', function: { name: 'list_portfolio', description: 'Portofolio DCA: per rencana, modal, pembelian, status.', parameters: { type: 'object', properties: {}, required: [] } } },
];

type FnCtx = { today: string; month: string };
type Fn = (args: any, ctx: FnCtx) => Promise<string>;
const validDate = (v: unknown): v is string => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y,m,d] = v.split('-').map(Number), x = new Date(Date.UTC(y,m-1,d));
  return x.getUTCFullYear()===y && x.getUTCMonth()===m-1 && x.getUTCDate()===d;
};
const validTime = (v: unknown): v is string => typeof v === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v);
const taskOccursOn = (t: any, date: string) => {
  if (date < t.date) return false;
  if (t.repeat === 'none') return t.date === date;
  if (t.repeat === 'daily') return true;
  const [sy,sm,sd]=t.date.split('-').map(Number), [y,m,d]=date.split('-').map(Number);
  const start=new Date(sy,sm-1,sd);
  if (t.repeat === 'weekly') return start.getDay() === new Date(y,m-1,d).getDay();
  const last=new Date(y,m,0).getDate();
  return sd===d || (sd>=29 && d===last && sd>d);
};

export const TOOL_FNS: Record<string, Fn> = {
  get_summary: async (_a, ctx) => {
    const { db } = await import('./db');
    const accounts = await db.accounts.toArray();
    const txs = await db.txs.toArray();
    const bal = (id: number) => (accounts.find(a => a.id === id)?.balance0 || 0) + txs.filter(t => t.accountId === id).reduce((s, t) => s + (t.type === 'in' ? t.amount : -t.amount), 0);
    const mT = txs.filter(t => t.date.startsWith(ctx.month) && t.category !== 'Transfer');
    const dT = txs.filter(t => t.date === ctx.today && t.category !== 'Transfer');
    const by: Record<string, number> = {};
    mT.filter(t => t.type === 'out').forEach(t => (by[t.category] = (by[t.category] || 0) + t.amount));
    const tasks = await db.tasks.toArray();
    const trades = await db.trades.toArray();
    return JSON.stringify({
      accounts: accounts.map(a => ({ id: a.id, name: a.name, saldo: bal(a.id!) })),
      bulan_ini: { pemasukan: mT.filter(t => t.type === 'in').reduce((s, t) => s + t.amount, 0), pengeluaran: mT.filter(t => t.type === 'out').reduce((s, t) => s + t.amount, 0), per_kategori: by },
      hari_ini: { pemasukan: dT.filter(t => t.type === 'in').reduce((s, t) => s + t.amount, 0), pengeluaran: dT.filter(t => t.type === 'out').reduce((s, t) => s + t.amount, 0) },
      tugas_hari_ini: tasks.filter(t => taskOccursOn(t, ctx.today)).map(t => ({ id: t.id, title: t.title, time: t.time, done: t.repeat === 'none' ? !!t.done : (t.doneOn || []).includes(ctx.today) })),
      dca: { total_modal: trades.reduce((s, t) => s + t.amount, 0), jumlah_rencana: (await db.plans.toArray()).length },
    });
  },
  list_transactions: async (a, ctx) => {
    const { db } = await import('./db');
    let list = await db.txs.orderBy('date').reverse().toArray();
    if (a.date) list = list.filter((t: any) => t.date === a.date);
    else if (a.month) list = list.filter((t: any) => t.date.startsWith(a.month));
    else list = list.filter((t: any) => t.date.startsWith(ctx.month));
    if (a.category) list = list.filter((t: any) => t.category.toLowerCase().includes(String(a.category).toLowerCase()));
    if (a.type) list = list.filter((t: any) => t.type === a.type);
    const limit = Number.isFinite(a.limit) ? Math.min(100, Math.max(1, Math.floor(a.limit))) : 20;
    return JSON.stringify(list.slice(0, limit));
  },
  add_transaction: async (a, ctx) => {
    const { db } = await import('./db');
    if (!Number.isFinite(a.amount) || a.amount <= 0) return 'Error: amount harus angka finite > 0';
    if (!['in', 'out'].includes(a.type)) return 'Error: type harus in atau out';
    const date = a.date || ctx.today;
    if (!validDate(date)) return 'Error: date harus tanggal valid YYYY-MM-DD';
    const accounts = await db.accounts.toArray();
    const accId = a.accountId ?? accounts[0]?.id;
    if (!accId || !accounts.some(x => x.id === accId)) return 'Error: accountId tidak ditemukan atau belum ada rekening';
    const type = a.type;
    const category = String(a.category || 'Lainnya').trim();
    const outCats = ['Makan','Transport','Belanja','Tagihan','Hiburan','Kesehatan','Pendidikan','Lainnya'];
    const inCats = ['Gaji','Bonus','Usaha','Investasi','Lainnya'];
    if (!(type === 'in' ? inCats : outCats).includes(category)) return 'Error: kategori tidak sesuai dengan jenis transaksi';
    const note = String(a.note || 'Dicatat via AI').slice(0, 500);
    await db.txs.add({ date, type, amount: a.amount, category, accountId: accId, note });
    return `OK: transaksi ${type === 'in' ? 'pemasukan' : 'pengeluaran'} Rp${a.amount} (${category}) tersimpan.`;
  },
  delete_transaction: async (a) => {
    if (!Number.isInteger(a.id) || a.id <= 0) return 'Error: ID transaksi tidak valid';
    const { db } = await import('./db');
    const exists = await db.txs.get(a.id);
    if (!exists) return 'Error: transaksi #' + a.id + ' tidak ditemukan';
    if (exists.transferId || exists.category === 'Transfer') {
      if (!exists.transferId) return 'Error: transfer lama tanpa ID pasangan dilindungi agar saldo tidak rusak';
      const pair = await db.txs.where('transferId').equals(exists.transferId).toArray();
      const validPair = pair.length === 2 && pair.every(t => t.category === 'Transfer' && t.transferId === exists.transferId) &&
        pair.filter(t => t.type === 'out').length === 1 && pair.filter(t => t.type === 'in').length === 1 &&
        pair[0].accountId !== pair[1].accountId && pair[0].amount === pair[1].amount;
      if (!validPair) return 'Error: pasangan transfer tidak utuh atau tidak konsisten. Tidak ada data yang dihapus.';
      if (!(globalThis as any).__duitkuConfirm?.('Hapus kedua sisi transfer #' + a.id + '?')) return 'DIBATALKAN: user tidak konfirmasi. Jangan ulangi tanpa persetujuan.';
      await db.transaction('rw', db.txs, async () => { await db.txs.where('transferId').equals(exists.transferId!).delete(); });
      return 'OK: kedua sisi transfer #' + a.id + ' dihapus.';
    }
    if (!(globalThis as any).__duitkuConfirm?.('Hapus transaksi #' + a.id + '?')) return 'DIBATALKAN: user tidak konfirmasi. Jangan ulangi tanpa persetujuan.';
    await db.txs.delete(a.id);
    return 'OK: transaksi #' + a.id + ' dihapus.';
  },
  list_tasks: async (a, ctx) => {
    const { db } = await import('./db');
    const date = a.date || ctx.today;
    if (!validDate(date)) return 'Error: date harus tanggal valid YYYY-MM-DD';
    const allTasks = await db.tasks.toArray();
    const list = a.all ? allTasks : allTasks.filter((t: any) => {
      if (date < t.date) return false;
      if (t.repeat === 'none') return t.date === date;
      if (t.repeat === 'daily') return true;
      const start = new Date(t.date + 'T00:00:00');
      const target = new Date(date + 'T00:00:00');
      if (t.repeat === 'weekly') return start.getDay() === target.getDay();
      const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
      return start.getDate() === target.getDate() || (start.getDate() >= 29 && target.getDate() === last && start.getDate() > target.getDate());
    });
    return JSON.stringify(list);
  },
  add_task: async (a, ctx) => {
    const title = typeof a.title === 'string' ? a.title.trim() : '';
    const date = a.date ?? ctx.today, time = a.time ?? '', priority = a.priority ?? 2, repeat = a.repeat ?? 'none';
    if (!title || title.length > 200) return 'Error: judul tugas wajib diisi (maksimal 200 karakter)';
    if (!validDate(date)) return 'Error: date harus tanggal valid YYYY-MM-DD';
    if (time !== '' && !validTime(time)) return 'Error: time harus format HH:MM valid';
    if (![1,2,3].includes(priority)) return 'Error: priority harus 1, 2, atau 3';
    if (!['none','daily','weekly','monthly'].includes(repeat)) return 'Error: repeat tidak valid';
    const { db } = await import('./db');
    const { schedule } = await import('./notif');
    const t: any = { title, date, time, priority: priority as 1|2|3, repeat: repeat as any, done: false, doneOn: [] };
    t.id = await db.tasks.add(t as any);
    await schedule(t as any);
    return 'OK: tugas "' + t.title + '" dibuat untuk ' + t.date + (t.time ? ' pukul ' + t.time : '') + '.';
  },
  complete_task: async (a, ctx) => {
    const { db } = await import('./db');
    const list = await db.tasks.toArray();
    if (a.id !== undefined && (!Number.isInteger(a.id) || a.id <= 0)) return 'Error: ID tugas tidak valid';
    if (a.id === undefined && !String(a.title || '').trim()) return 'Error: berikan ID atau judul tugas';
    const matches = a.id !== undefined ? list.filter((x: any) => x.id === a.id) : list.filter((x: any) => x.title.toLowerCase().includes(String(a.title).trim().toLowerCase()));
    if (!matches.length) return 'Error: tugas tidak ditemukan';
    if (matches.length > 1) return 'Error: judul cocok dengan beberapa tugas. Berikan ID tugas yang tepat.';
    const t = matches[0];
    if (t.repeat === 'none') await db.tasks.update(t.id!, { done: true });
    else await db.tasks.update(t.id!, { doneOn: (t.doneOn || []).includes(ctx.today) ? t.doneOn : [...(t.doneOn || []), ctx.today] });
    return `OK: tugas "${t.title}" ditandai selesai.`;
  },
  delete_task: async (a) => {
    if (!Number.isInteger(a.id) || a.id <= 0) return 'Error: ID tugas tidak valid';
    if (!(globalThis as any).__duitkuConfirm?.(`Hapus tugas #${a.id}?`)) return 'DIBATALKAN: user tidak konfirmasi. Jangan ulangi tanpa persetujuan.';
    const { db } = await import('./db');
    if (!(await db.tasks.get(a.id))) return `Error: tugas #${a.id} tidak ditemukan`;
    const { cancel } = await import('./notif');
    await db.tasks.delete(a.id); await cancel(a.id);
    return `OK: tugas #${a.id} dihapus.`;
  },
  list_accounts: async () => {
    const { db } = await import('./db');
    const accounts = await db.accounts.toArray();
    const txs = await db.txs.toArray();
    return JSON.stringify(accounts.map(a => ({ id: a.id, name: a.name, saldo: a.balance0 + txs.filter(t => t.accountId === a.id).reduce((s, t) => s + (t.type === 'in' ? t.amount : -t.amount), 0) })));
  },
  list_budgets: async (_a, ctx) => {
    const { db } = await import('./db');
    const budgets = await db.budgets.toArray();
    const txs = (await db.txs.toArray()).filter((t: any) => t.date.startsWith(ctx.month) && t.type === 'out');
    return JSON.stringify(budgets.map(b => ({ ...b, terpakai: txs.filter((t: any) => t.category === b.category).reduce((s: number, t: any) => s + t.amount, 0) })));
  },
  set_budget: async (a) => {
    const { db } = await import('./db');
    const allowed = ['Makan','Transport','Belanja','Tagihan','Hiburan','Kesehatan','Pendidikan','Lainnya'];
    if (!allowed.includes(a.category) || !Number.isFinite(a.limit) || a.limit <= 0) return 'Error: kategori atau batas anggaran tidak valid';
    const ex = (await db.budgets.toArray()).find(b => b.category === a.category);
    if (ex) await db.budgets.update(ex.id!, { limit: a.limit });
    else await db.budgets.add({ category: a.category, limit: a.limit });
    return `OK: anggaran ${a.category} = Rp${a.limit}/bulan.`;
  },
  list_portfolio: async () => {
    const { db } = await import('./db');
    const plans = await db.plans.toArray();
    const trades = await db.trades.toArray();
    return JSON.stringify(plans.map(p => {
      const tr = trades.filter((t: any) => t.planId === p.id);
      return { id: p.id, nama: p.name, harian: p.daily, aktif: p.active, modal: tr.reduce((s: number, t: any) => s + t.amount, 0), pembelian: tr.length };
    }));
  },
};

// Tools yang baca/tulis data user — hanya tersedia jika cfg.withData = true.
// Nama harus cocok persis dengan AGENT_TOOLS di atas.
const DATA_TOOLS = [
  'get_summary', 'list_transactions', 'add_transaction', 'delete_transaction',
  'list_tasks', 'add_task', 'complete_task', 'delete_task',
  'list_accounts', 'list_budgets', 'set_budget', 'list_portfolio',
];

export function allowedTools(cfg: Cfg) {
  if (!cfg.withData) {
    return AGENT_TOOLS.filter((t: any) => !DATA_TOOLS.includes(t.function.name));
  }
  return AGENT_TOOLS;
}

// Guard eksekusi (defense-in-depth): blokir meski model tetap meminta tool
function toolAllowed(name: string, cfg: Cfg) {
  return cfg.withData || !DATA_TOOLS.includes(name);
}

const DENY_MSG = 'Error: AI tidak punya izin akses data. Aktifkan toggle "Beri AI akses data" di Setelan.';

// Satu putaran agent: kirim percakapan + tools; kalau model minta tool call, eksekusi & ulangi (maks 6 putaran).
export async function agentTurn(history: Msg[], cfg: Cfg, push: (m: Msg) => void): Promise<void> {
  if (!cfg.key) throw new Error('Isi API key di Setelan dulu.');
  const now = new Date();
  const ctx: FnCtx = {
    today: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
    month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
  };
  const sys = 'Kamu asisten keuangan & produktivitas dalam app FINTRA (bahasa Indonesia, sapa pengguna "Bos", gaya santai). ' +
    `Hari ini ${ctx.today}. Lo PUNYA akses tools untuk membaca & mengubah data app (transaksi, tugas, rekening, anggaran, portofolio). ` +
    'PAKAI tools untuk menjawab pertanyaan tentang data — jangan mengarang angka. Kalau user minta mencatat/mengubah/menghapus, eksekusi lewat tools lalu konfirmasi singkat. ' +
    'Jawab akhir singkat & jelas. Simulasi investasi bukan nasihat keuangan.';

  const convo: any[] = [{ role: 'system', content: sys }, ...history.map(h => ({ role: h.role, content: h.content }))];
  const geminiContents: any[] = history.map(h => ({ role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: h.content }] }));

  for (let round = 0; round < 6; round++) {
    if (cfg.provider === 'gemini') {
      const r = await fetch(\`https://generativelanguage.googleapis.com/v1beta/models/\${cfg.model}:generateContent\`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: sys }] }, contents: geminiContents,
          tools: [{ functionDeclarations: allowedTools(cfg).map(t => t.function) }],
        })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message || 'Permintaan gagal');
      const modelContent = j.candidates?.[0]?.content, parts = modelContent?.parts || [];
      const calls = parts.filter((p: any) => p.functionCall).map((p: any) => p.functionCall);
      const txt = parts.filter((p: any) => p.text).map((p: any) => p.text).join('');
      if (calls.length) {
        geminiContents.push(modelContent);
        const responses: any[] = [];
        for (const fc of calls) {
          let out = 'tool tidak dikenal';
          try {
            if (!toolAllowed(fc.name, cfg)) out = DENY_MSG;
            else out = await (TOOL_FNS[fc.name] || (async () => 'tool tidak dikenal'))(fc.args || {}, ctx);
          } catch (e: any) { out = 'Error: ' + (e?.message || e); }
          push({ role: 'assistant', content: '🔧 ' + fc.name + ' → selesai' });
          responses.push({ functionResponse: { name: fc.name, response: { result: out } } });
        }
        geminiContents.push({ role: 'user', parts: responses });
        continue;
      }
      push({ role: 'assistant', content: txt || '(tidak ada jawaban)' });
      return;
    }    // OpenRouter (OpenAI-compatible tool calls)
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({ model: cfg.model, messages: convo, tools: allowedTools(cfg) })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error?.message || 'Permintaan gagal');
    const assistantMsg = j.choices?.[0]?.message;
    if (assistantMsg?.tool_calls?.length) {
      convo.push(assistantMsg);
      for (const tc of assistantMsg.tool_calls) {
        let out = 'tool tidak dikenal';
        try {
          const name = tc.function.name;
          if (!toolAllowed(name, cfg)) out = DENY_MSG;
          else {
            const fn = TOOL_FNS[name];
            if (fn) out = await fn(JSON.parse(tc.function.arguments || '{}'), ctx);
          }
        } catch (e: any) { out = 'Error: ' + (e?.message || e); }
        push({ role: 'assistant', content: `🔧 ${tc.function.name} → selesai` });
        convo.push({ role: 'tool', tool_call_id: tc.id, content: out });
      }
      continue;
    }
    push({ role: 'assistant', content: assistantMsg?.content || '(tidak ada jawaban)' });
    return;
  }
  push({ role: 'assistant', content: 'Terlalu banyak langkah — coba pecah pertanyaannya, Bos.' });
}
