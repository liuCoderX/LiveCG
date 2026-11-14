import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { localDate } from "./auth/audit.ts";

/**
 * CS2 GSI 原始数据录制（联调用）。
 *
 * 真机比赛里遇到阵营识别、回合号、击杀配对的问题时，靠描述很难复现；
 * 把游戏推来的原始帧录下来，开发端用 `pnpm replay:cs2` 原样回放就能复现。
 *
 * 每帧一行：{ "t": 收到时间(ms), "room": 房间, "payload": 原始数据（已去掉 auth.token） }
 * 文件：<数据目录>/captures/cs2-<房间>-<YYYY-MM-DD>.jsonl
 * 体积参考：一场比赛每秒约十几帧，一小时几十到几百 MB，只在联调时开启。
 */
export class Cs2Capture {
  private dir: string;

  constructor(dataDir: string) {
    this.dir = join(dataDir, "captures");
    mkdirSync(this.dir, { recursive: true });
  }

  fileFor(room: string, ts = Date.now()): string {
    return join(this.dir, `cs2-${room}-${localDate(ts)}.jsonl`);
  }

  write(room: string, payload: Record<string, unknown>, ts = Date.now()): void {
    // 去掉 token：录制文件要发给别人排查问题，不能带凭据
    const { auth: _auth, ...rest } = payload;
    try {
      appendFileSync(this.fileFor(room, ts), `${JSON.stringify({ t: ts, room, payload: rest })}\n`);
    } catch (err) {
      console.error("[capture] 写入失败", err);
    }
  }
}

export interface CaptureFrame {
  t: number;
  room: string;
  payload: Record<string, unknown>;
}

/** 读取录制文件；跳过损坏的行（录制中途断电时最后一行可能不完整） */
export function readCapture(file: string): CaptureFrame[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const f = JSON.parse(line) as CaptureFrame;
        return typeof f.t === "number" && f.payload ? [f] : [];
      } catch {
        return [];
      }
    });
}
