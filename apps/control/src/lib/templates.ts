import { useEffect, useState } from "react";
import type { TemplateMeta } from "@livecg/shared";

export type TemplateMap = Map<string, TemplateMeta>;

/**
 * 模板元数据：运行时从 /graphics/templates/<name>.js 加载（与输出页同一份模块），
 * 不打包进控制台——新增模板只需放文件，无需重新构建控制台。
 */
export function useTemplates(): TemplateMap {
  const [map, setMap] = useState<TemplateMap>(new Map());
  useEffect(() => {
    let alive = true;
    (async () => {
      const names: string[] = await fetch("/api/templates").then((r) => r.json());
      const entries = await Promise.all(
        names.map(async (name) => {
          try {
            const mod = await import(/* @vite-ignore */ `/graphics/templates/${name}.js`);
            return [name, (mod.default.meta ?? { label: name, layer: name, z: 0 }) as TemplateMeta] as const;
          } catch (err) {
            console.error(`template ${name} failed to load`, err);
            return null;
          }
        }),
      );
      if (alive) setMap(new Map(entries.filter((e): e is readonly [string, TemplateMeta] => !!e)));
    })();
    return () => {
      alive = false;
    };
  }, []);
  return map;
}
