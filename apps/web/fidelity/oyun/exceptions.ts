/**
 * Prototype lines the game page is excused from showing. Every entry carries a reason.
 *  - omit: the whole prototype line (digits masked) is not expected. A string must equal the line after digit masking, a RegExp is tested against the raw line.
 *  - strip: `line` is cut out of the prototype line and what remains is still expected.
 * Extra lines the page adds (for example "kayıttan oynatılıyor") are never checked, so they need no entry.
 */
export type OyunException = {
  readonly screen: string;
  readonly kind: "omit" | "strip";
  readonly line: string | RegExp;
  readonly reason: string;
};

import { BUILDER_EXCEPTIONS } from "./exceptions/builder";
import { BUILDER01_EXCEPTIONS } from "./exceptions/builder01";
import { BUILDER2_EXCEPTIONS } from "./exceptions/builder2";
import { BUILDER34_EXCEPTIONS } from "./exceptions/builder34";
import { EDITOR_EXCEPTIONS } from "./exceptions/editor";
import { GUIDE_EXCEPTIONS } from "./exceptions/guide";
import { INSANLAR_EXCEPTIONS } from "./exceptions/insanlar";
import { LIVE_EXCEPTIONS } from "./exceptions/live";
import { LIVE_CHAIN_EXCEPTIONS } from "./exceptions/liveChain";
import { LIVE_SHARED_EXCEPTIONS } from "./exceptions/liveShared";
import { LIVE_CITY_EXCEPTIONS, LIVE_WORLD_EXCEPTIONS } from "./exceptions/liveWorldCity";
import { PIYASA_EXCEPTIONS } from "./exceptions/piyasa";
import { READER_EXCEPTIONS } from "./exceptions/reader";
import { RESULT_EXCEPTIONS } from "./exceptions/result";
import { RUNS_EXCEPTIONS } from "./exceptions/runs";
import { SARTOZEL_EXCEPTIONS } from "./exceptions/sartOzel";
import { START_EXCEPTIONS } from "./exceptions/start";

export const OYUN_SCREENS = ["start", "builder", "live", "live-world", "live-city", "live-chain", "result", "runs", "reader"] as const;

export const OYUN_EXCEPTIONS: readonly OyunException[] = [...START_EXCEPTIONS, ...LIVE_EXCEPTIONS, ...BUILDER_EXCEPTIONS, ...BUILDER01_EXCEPTIONS, ...BUILDER2_EXCEPTIONS, ...BUILDER34_EXCEPTIONS, ...SARTOZEL_EXCEPTIONS, ...EDITOR_EXCEPTIONS, ...INSANLAR_EXCEPTIONS, ...PIYASA_EXCEPTIONS, ...READER_EXCEPTIONS, ...LIVE_SHARED_EXCEPTIONS, ...LIVE_WORLD_EXCEPTIONS, ...LIVE_CITY_EXCEPTIONS, ...LIVE_CHAIN_EXCEPTIONS, ...RESULT_EXCEPTIONS, ...RUNS_EXCEPTIONS, ...GUIDE_EXCEPTIONS];
