import { describe, expect, it } from "vitest";
import { SimUnsupported } from "@/oyun/sim/SimSource";
import type { RunHandle, RunState, SimEvent, SimSource, ValuesPatch, WeekPacket } from "@/oyun/sim/types";

/** Her `SimSource` gerçeklemesinin geçmesi gereken ortak davranış sözleşmesi (final-review M3). */
export type ContractHarness = {
  source: SimSource;
  start: () => Promise<RunHandle>;
  cleanup: () => void;
  /** Sahte saat varsa ilerletir; gerçek saatli kaynaklarda verilmez. */
  advance?: (ms: number) => void;
};
export type ContractFlags = {
  /** Yenilemeden sonra (`open`) hafta korunur mu (canlı: evet; kayıt oynatıcı: hafta 0). */
  refreshKeepsWeek: boolean;
};

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

async function settle<T>(p: Promise<T>, advance?: (ms: number) => void): Promise<T> {
  const box: { done: boolean; v?: T; e?: unknown; failed?: boolean } = { done: false };
  p.then((v) => { box.v = v; box.done = true; }, (e: unknown) => { box.e = e; box.failed = true; box.done = true; });
  for (let i = 0; i < 1000 && !box.done; i++) {
    advance?.(1000);
    await new Promise((r) => setTimeout(r, 5));
  }
  if (!box.done) throw new Error("settle: zaman aşımı");
  if (box.failed) throw box.e;
  return box.v as T;
}

function track(source: SimSource, runId: string) {
  const events: SimEvent[] = [];
  const off = source.subscribe(runId, (e) => events.push(e));
  const weeks = (): number[] => events.flatMap((e) => (e.type === "week" ? [e.packet.week] : []));
  const states = (): RunState[] => events.flatMap((e) => (e.type === "state" ? [e.state] : []));
  const versionIds = (): string[] =>
    events.flatMap((e) => (e.type === "world_event" && e.event.textKey === "event.version" ? [e.event.id] : []));
  return { events, off, weeks, states, versionIds };
}

async function step(source: SimSource, runId: string, n: number): Promise<RunState> {
  let s = (await source.control(runId, { action: "pause" }));
  for (let i = 0; i < n; i++) s = await source.control(runId, { action: "step" });
  return s;
}

/** Bilgideki ilk çok seçenekli ayardan, mevcut değerden farklı geçerli bir yama kurar. */
async function otherPatch(source: SimSource, state: RunState): Promise<ValuesPatch> {
  const info = await source.info();
  for (const s of info.settings) {
    const cur = state.values[s.id];
    const other = s.options.find((o) => o.available && o.value !== cur);
    if (other) return { [s.id]: other.value };
  }
  throw new Error("sözleşme: değiştirilebilir ayar yok");
}

export function contractSuite(name: string, make: () => Promise<ContractHarness>, flags: ContractFlags): void {
  async function using(fn: (h: ContractHarness) => Promise<void>): Promise<void> {
    const h = await make();
    try {
      await fn(h);
    } finally {
      h.cleanup();
    }
  }

  describe(`SimSource sözleşmesi: ${name}`, () => {
    it("start: ready, hafta 0, sürüm 1", async () => {
      await using(async (h) => {
        const run = await h.start();
        expect(run.state).toMatchObject({ week: 0, version: 1, computing: false, runId: run.runId });
        expect(["ready", "paused"]).toContain(run.state.status);       // kayıt kaynağı `ready`, canlı sunucu hafta 0'da duraklatılmış (`paused`) bildirir
      });
    });

    it("subscribe: önce state, sonra 1..state.week artan ve yinelemesiz, sonra canlı", async () => {
      await using(async (h) => {
        const run = await h.start();
        await step(h.source, run.runId, 3);
        const t = track(h.source, run.runId);
        await flush();
        const first = t.events[0];
        expect(first?.type).toBe("state");
        const n = first?.type === "state" ? first.state.week : -1;
        expect(n).toBe(3);
        expect(t.weeks().slice(0, n)).toEqual([1, 2, 3]);
        await step(h.source, run.runId, 1);
        await flush();
        expect(t.weeks()).toEqual([1, 2, 3, 4]);
        t.off();
        t.off();
      });
    });

    it("bilinmeyen kimlik: tek error olayı; open null; control/weeks SimUnsupported", async () => {
      await using(async (h) => {
        await h.start();
        const t = track(h.source, "__yok__");
        await flush();
        expect(t.events.map((e) => e.type)).toEqual(["error"]);
        t.off();
        expect(await h.source.open("__yok__")).toBeNull();
        await expect(h.source.control("__yok__", { action: "step" })).rejects.toBeInstanceOf(SimUnsupported);
        await expect(h.source.weeks("__yok__", 1, 2)).rejects.toBeInstanceOf(SimUnsupported);
      });
    });

    it("weeks: yalnız yayımlanmış haftalar, artan", async () => {
      await using(async (h) => {
        const run = await h.start();
        await step(h.source, run.runId, 3);
        const got: WeekPacket[] = await h.source.weeks(run.runId, 1, 200);
        expect(got.map((p) => p.week)).toEqual([1, 2, 3]);
      });
    });

    it("control: computing iken durumu değiştirmeden döner", async () => {
      await using(async (h) => {
        const run = await h.start();
        const t = track(h.source, run.runId);
        const st = await step(h.source, run.runId, 2);
        const patch = await otherPatch(h.source, st);
        const pending = h.source.applyChange(run.runId, { from: "next_week", patch });
        let latest: RunState | undefined;
        for (let i = 0; i < 200 && !latest?.computing; i++) {
          await flush();
          latest = t.states().at(-1);
        }
        expect(latest?.computing).toBe(true);
        const before = t.weeks().length;
        for (const cmd of [{ action: "play" as const }, { action: "step" as const }, { action: "pause" as const }]) {
          const r = await h.source.control(run.runId, cmd);
          expect(r).toMatchObject({ computing: true, week: latest!.week, status: latest!.status });
        }
        expect(t.weeks().length).toBe(before);
        const res = await settle(pending, h.advance);
        expect(res.accepted).toBe(true);
      });
    });

    it("ended bir kez; sonra komutlar ended durumunu korur, hafta taşmaz", async () => {
      await using(async (h) => {
        const run = await h.start();
        const t = track(h.source, run.runId);
        const dur = run.state.durationWeeks;
        let s = await h.source.control(run.runId, { action: "pause" });
        for (let i = 0; i < dur + 5 && s.status !== "ended"; i++) s = await h.source.control(run.runId, { action: "step" });
        expect(s).toMatchObject({ status: "ended", week: dur, endedReason: "duration" });
        for (const cmd of [{ action: "play" as const }, { action: "pause" as const }, { action: "step" as const }, { action: "step" as const, speed: 4 as const }]) {
          const r = await h.source.control(run.runId, cmd);
          expect(r).toMatchObject({ status: "ended", week: dur });
        }
        await flush();
        expect(t.events.filter((e) => e.type === "ended")).toHaveLength(1);
        expect(Math.max(...t.weeks())).toBe(dur);
        const ch = await h.source.applyChange(run.runId, { from: "next_week", patch: await otherPatch(h.source, s) });
        expect(ch).toMatchObject({ accepted: false });
        if (!ch.accepted) expect(ch.fields.map((f) => f.reason)).toContain("ended");
      });
    });

    it("applyChange kabulü: seamWeek >= 0, sürüm artar, son durum aynı sürümde", async () => {
      await using(async (h) => {
        const run = await h.start();
        const t = track(h.source, run.runId);
        const st = await step(h.source, run.runId, 2);
        const patch = await otherPatch(h.source, st);
        const res = await settle(h.source.applyChange(run.runId, { from: "next_week", patch }), h.advance);
        expect(res.accepted).toBe(true);
        if (!res.accepted) return;
        expect(res.seamWeek).toBeGreaterThanOrEqual(0);
        expect(res.version).toBeGreaterThan(st.version);
        await flush();
        expect(t.states().at(-1)).toMatchObject({ computing: false });
        const after = await step(h.source, res.runId, 1);
        expect(after.week).toBe(3);
        await flush();
        expect(t.states().at(-1)).toMatchObject({ version: res.version, computing: false });         // durumun sürümü yayımlanan haftanın sürümüdür: dikişten sonraki hafta yayımlanınca yeni sürüm
      });
    });

    it("hafta 0 değişikliği: sürüm 1'de kalır, sürüm olayı yayımlanmaz", async () => {
      await using(async (h) => {
        const run = await h.start();
        const t = track(h.source, run.runId);
        await flush();
        const patch = await otherPatch(h.source, run.state);
        const res = await settle(h.source.applyChange(run.runId, { from: "next_week", patch }), h.advance);
        expect(res.accepted).toBe(true);
        if (!res.accepted) return;
        expect(res.seamWeek).toBe(0);
        expect(res.version).toBe(1);
        await flush();
        expect(t.versionIds()).toEqual([]);
        expect(t.states().at(-1)).toMatchObject({ version: 1, week: 0 });
        expect(t.states().at(-1)?.values).toMatchObject(patch);
      });
    });

    it("oynat, sonra hafta 0'da değişiklik: yanıt, paket sürümleri, olay ve değerler aynı dikişi söyler", async () => {
      await using(async (h) => {
        const run = await h.start();
        const t = track(h.source, run.runId);
        await flush();
        const patch = await otherPatch(h.source, run.state);
        await h.source.control(run.runId, { action: "play", speed: 1 });
        const res = await settle(h.source.applyChange(run.runId, { from: "next_week", patch }), h.advance);
        expect(res.accepted).toBe(true);
        if (!res.accepted) return;
        await h.source.control(run.runId, { action: "pause" });
        await flush();
        const last = t.states().at(-1);
        expect(last?.values).toMatchObject(patch);
        expect(last?.version).toBe(res.version);
        if (res.seamWeek === 0) {                           // gerçek dikiş 0: başlangıç kuralı, sürüm 1, olay yok
          expect(res.version).toBe(1);
          expect(t.versionIds()).toEqual([]);
        } else {                                            // sonraki dikiş: sürüm artar, tek olay
          expect(res.version).toBeGreaterThan(1);
          expect(t.versionIds()).toHaveLength(1);
        }
        const after = await step(h.source, run.runId, 1);
        expect(after.version).toBe(res.version);
        const pk = t.events.flatMap((e) => (e.type === "week" ? [e.packet] : []));
        expect(pk.length).toBeGreaterThan(0);
        expect(pk.at(-1)?.version).toBe(res.version);
        const patch2 = await otherPatch(h.source, after);   // sonraki değişiklik numaralaması tutarlı
        const res2 = await settle(h.source.applyChange(run.runId, { from: "next_week", patch: patch2 }), h.advance);
        expect(res2.accepted).toBe(true);
        if (!res2.accepted) return;
        expect(res2.version).toBe(res.version + 1);
        expect(res2.seamWeek).toBeGreaterThan(0);
        await step(h.source, run.runId, 1);
        await flush();
        expect(t.states().at(-1)?.values).toMatchObject(patch2);                     // değerler de yayımlanan haftayla gelir
      });
    });

    it("iki abone aynı geçmişi alır", async () => {
      await using(async (h) => {
        const run = await h.start();
        await step(h.source, run.runId, 3);
        const a = track(h.source, run.runId);
        const b = track(h.source, run.runId);
        await flush();
        expect(b.weeks()).toEqual(a.weeks());
        expect(b.states().at(-1)).toEqual(a.states().at(-1));
      });
    });

    it("ikinci abone, ilk abone geçmişi aldıktan sonra açılırsa geçmiş subscribe dönmeden eşzamanlı teslim edilir", async () => {
      await using(async (h) => {
        const run = await h.start();
        const a = track(h.source, run.runId);
        const st = await step(h.source, run.runId, 2);
        const patch = await otherPatch(h.source, st);
        const res = await settle(h.source.applyChange(run.runId, { from: "next_week", patch }), h.advance);
        expect(res.accepted).toBe(true);
        const id = res.accepted ? res.runId : run.runId;
        await step(h.source, id, 1);
        await flush();
        const b = track(h.source, id); // beklemeden denetlenir
        expect(b.events[0]?.type).toBe("state");
        expect(b.weeks()).toEqual([1, 2, 3]);
        expect(a.versionIds().length).toBeGreaterThan(0);
        expect(b.versionIds()).toEqual(a.versionIds());
      });
    });

    it("yenileme: open aynı koşuyu bulur; hafta korunumu bayrağa uyar", async () => {
      await using(async (h) => {
        const run = await h.start();
        await step(h.source, run.runId, 3);
        const again = await make();
        try {
          const opened = await again.source.open(run.runId);
          expect(opened).not.toBeNull();
          expect(opened!.state.week).toBe(flags.refreshKeepsWeek ? 3 : 0);
        } finally {
          again.cleanup();
        }
      });
    });

    it("dispose sonrası: asenkron çağrılar SimUnsupported; subscribe fırlatır ya da sessiz kalır", async () => {
      const h = await make();
      const run = await h.start();
      h.source.dispose();
      h.source.dispose();
      await expect(h.source.info()).rejects.toBeInstanceOf(SimUnsupported);
      await expect(h.source.availability({})).rejects.toBeInstanceOf(SimUnsupported);
      await expect(h.start()).rejects.toBeInstanceOf(SimUnsupported);
      await expect(h.source.open(run.runId)).rejects.toBeInstanceOf(SimUnsupported);
      await expect(h.source.control(run.runId, { action: "step" })).rejects.toBeInstanceOf(SimUnsupported);
      await expect(h.source.applyChange(run.runId, { from: "next_week", patch: {} })).rejects.toBeInstanceOf(SimUnsupported);
      await expect(h.source.weeks(run.runId, 1, 2)).rejects.toBeInstanceOf(SimUnsupported);
      const got: SimEvent[] = [];
      try {
        const off = h.source.subscribe(run.runId, (e) => got.push(e));
        off();
      } catch (e) {
        expect(e).toBeInstanceOf(SimUnsupported);
      }
      await flush();
      expect(got).toEqual([]);
      h.cleanup();
    });
  });
}
