import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

/**
 * 读取 .env 文件到环境变量。
 * - 已经存在的环境变量优先（systemd EnvironmentFile、命令行 export 不会被 .env 覆盖）
 * - 空值视为「没填」：.env.example 里留空的项（如 PORT=）复制过来不会变成空字符串
 * 返回实际写入的变量名（不含值，便于打日志而不泄露密钥）。
 */
export function loadEnvFile(file: string, env: NodeJS.ProcessEnv = process.env): string[] {
  if (!existsSync(file)) return [];
  const vars = parseEnv(readFileSync(file, "utf8"));
  const loaded: string[] = [];
  for (const [k, v] of Object.entries(vars)) {
    if (v === "" || env[k] !== undefined) continue;
    env[k] = v;
    loaded.push(k);
  }
  return loaded;
}
