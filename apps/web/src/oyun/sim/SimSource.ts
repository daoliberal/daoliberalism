export type {
  Availability, Capabilities, ChangeResult, Diagnostic, GoalId, Registry, RegistryCard, RegistryControl, RegistryGroup, RegistryScenario,
  RegistryTemplate, RunConfig, RunHandle, RunState, RunStatus, SettingAvail,
  SimEvent, SimSource, SourceInfo, Speed, UIValue, ValuesPatch, WeekPacket, World, WorldEvent,
} from "./types";

/** Sunucunun "kayıt yok" (404) yanıtı: `SimUnsupported` iletisi. LiveSource üretir, ürün çekmecesi "yok" durumu için okur. */
export const SIM_NOT_FOUND = "not_found";

/** Kaynağın desteklemediği ya da kapanmış olduğu çağrı. İleti sabit tek sözcük kimliktir. */
export class SimUnsupported extends Error {
  /** Sunucu 422 gövdesinin `fields` öğeleri (yalnız karar reddinde dolu): `reason` modelin nedeni, nedensiz alanda `invalid`. */
  readonly alanlar: readonly { id: string; reason: string }[];

  constructor(id: string = "unsupported", alanlar: readonly { id: string; reason: string }[] = []) {
    super(id);
    this.name = "SimUnsupported";
    this.alanlar = alanlar;
  }
}
