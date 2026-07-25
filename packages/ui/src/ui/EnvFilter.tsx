import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { GlobeHemisphereWest } from "@phosphor-icons/react";
import { api } from "../api.js";
import { Select } from "./Select.js";

/**
 * Environment lives in the URL rather than in app state: it is a filter on what
 * a page shows, so a link to a filtered page should stay filtered when shared.
 */
export function useEnvironment(): {
  env: string | undefined;
  value: string;
  setEnv: (v: string) => void;
  environments: string[];
} {
  const [params, setParams] = useSearchParams();
  const value = params.get("env") ?? "";

  const environments = useQuery({
    queryKey: ["environments"],
    queryFn: api.environments,
    staleTime: 60_000,
  });

  const setEnv = useCallback(
    (next: string) => {
      const p = new URLSearchParams(params);
      if (next) p.set("env", next);
      else p.delete("env");
      setParams(p, { replace: true });
    },
    [params, setParams]
  );

  return { env: value || undefined, value, setEnv, environments: environments.data ?? [] };
}

export function EnvFilter({
  value,
  onChange,
  environments,
}: {
  value: string;
  onChange: (v: string) => void;
  environments: string[];
}) {
  if (environments.length === 0) return null;
  return (
    <Select
      label="Environment"
      icon={<GlobeHemisphereWest size={13} className="flex-none text-faint" />}
      value={value}
      onChange={onChange}
      items={[
        { value: "", label: "All environments" },
        ...environments.map((e) => ({ value: e, label: e })),
      ]}
    />
  );
}
