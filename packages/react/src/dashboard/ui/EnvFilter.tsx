"use client";
import { GlobeHemisphereWest } from "@phosphor-icons/react";
import { useEnvironments } from "../../hooks.js";
import { useEnvironmentRoute } from "../navigation.js";
import { Select } from "./Select.js";

/**
 * Environment lives in the route rather than in component state: it is a filter
 * on what a page shows, so a link to a filtered page should stay filtered when
 * shared.
 */
export function useEnvironment(): {
  env: string | undefined;
  value: string;
  setEnv: (v: string) => void;
  environments: string[];
} {
  const { env, setEnv } = useEnvironmentRoute();
  const environments = useEnvironments();
  return { env, value: env ?? "", setEnv, environments: environments.data ?? [] };
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
