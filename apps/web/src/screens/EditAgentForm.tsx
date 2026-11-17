"use client";
import { useState } from "react";
import { Button } from "@/components/primitives/Button";
import { Field } from "@/components/primitives/Field";
import { Grid } from "@/components/primitives/Grid";
import { Stack } from "@/components/primitives/Stack";
import { isFallbackAgentName } from "@/data/fallbacks";
import { encodeAgentMetadata } from "@/data/metadata";
import type { Address, Agent } from "@/data/types";
import { metadataUrlError } from "@/lib/validation";
import { descriptionError, keyError, nameError } from "./agentInput";
import styles from "./EditAgentForm.module.css";

/** Exactly one change per signature (mirrors ActionRequest.updateAgent). */
export type AgentPatch = { agentKey: Address; metadataURI?: undefined } | { metadataURI: string; agentKey?: undefined };
type Group = "key" | "profile" | "url";

/**
 * Inline edit form (C-07-Agents:62). Owner decision: one change per signature, either the agent key, or the name and
 * description (written as a new data: URI), or the Metadata URL. As soon as one of them differs from what is stored, the
 * other two are locked; restoring the value unlocks them again.
 */
export function EditAgentForm({ agent, onSave }: { agent: Agent; onSave(patch: AgentPatch): void }) {
  const stored = {
    key: agent.agentKey as string,
    // an unreadable profile falls back to "Agent #id": that is not a name the owner chose, so the field starts empty
    name: isFallbackAgentName(agent.profile.name, agent.id) ? "" : agent.profile.name,
    description: agent.profile.description ?? "",
    // A data: URI is the app's own storage, not an address the owner typed.
    url: agent.metadataURI.startsWith("data:") ? "" : agent.metadataURI,
  };
  const [key, setKey] = useState(stored.key);
  const [name, setName] = useState(stored.name);
  const [description, setDescription] = useState(stored.description);
  const [url, setUrl] = useState(stored.url);

  const changed: Record<Group, boolean> = {
    key: key.trim() !== stored.key,
    profile: name.trim() !== stored.name.trim() || description.trim() !== stored.description.trim(),
    url: url.trim() !== stored.url,
  };
  const active = (Object.keys(changed) as Group[]).find((g) => changed[g]);
  const locked = (g: Group) => active !== undefined && active !== g;

  const errors = {
    key: changed.key ? (key.trim() === "" ? "Enter a valid 0x address." : keyError(key)) : undefined,
    name: changed.profile ? (name.trim() === "" ? "Enter a name." : nameError(name)) : undefined,
    description: changed.profile ? descriptionError(description) : undefined,
    url: changed.url ? (url.trim() === "" ? "Enter the metadata address." : metadataUrlError(url)) : undefined,
  };
  // Name and description are merged into the stored profile, so services, image, trust and flags survive the edit.
  const profileUri = (): string | undefined => {
    try {
      return encodeAgentMetadata({ ...agent.profile, name: name.trim(), description: description.trim() });
    } catch {
      return undefined;
    }
  };
  const tooLarge = active === "profile" && !errors.name && !errors.description && profileUri() === undefined;
  const canSave = active !== undefined && !errors.key && !errors.name && !errors.description && !errors.url && !tooLarge;
  // A URL profile is not ours to edit in place: the edit stores the merged profile as a data: URI instead.
  const replacesUrl = active === "profile" && !agent.metadataURI.startsWith("data:");

  const save = () => {
    if (!canSave) return;
    if (active === "key") onSave({ agentKey: key.trim() as Address });
    else if (active === "url") onSave({ metadataURI: url.trim() });
    else {
      const metadataURI = profileUri();
      if (metadataURI !== undefined) onSave({ metadataURI });
    }
  };

  const id = agent.id.toString();
  return (
    <div className={styles.panel}>
      <Grid minItem="300" gap="12">
        <Field
          kind="input"
          id={`e-key-${id}`}
          label="Agent key address"
          mono
          fontSize="14"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          disabled={locked("key")}
          error={errors.key}
          autoComplete="off"
          spellCheck={false}
        />
        <Field
          kind="input"
          id={`e-name-${id}`}
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={locked("profile")}
          error={errors.name}
          autoComplete="off"
        />
      </Grid>
      <Grid minItem="300" gap="12">
        <Field
          kind="textarea"
          id={`e-desc-${id}`}
          label="Description"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={locked("profile")}
          error={errors.description}
        />
        <Field
          kind="input"
          id={`e-meta-${id}`}
          label="Metadata URL"
          mono
          fontSize="14"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={locked("url")}
          error={errors.url}
          autoComplete="off"
          spellCheck={false}
        />
      </Grid>
      <Stack gap="10" direction="row" wrap align="center" justify="between">
        <span className={styles.note}>
          A new key applies in every DAO this agent belongs to.
          <span className={styles.rule}> Change one thing at a time: the key, the name and description, or the metadata address.</span>
          {replacesUrl && <span className={styles.rule}>Saving stores the profile on-chain in place of your metadata address.</span>}
          {tooLarge && <span className={styles.rule}>This profile is too large to update here.</span>}
        </span>
        <Button variant="brand" size="sm" disabled={!canSave} onClick={save}>
          Save and sign
        </Button>
      </Stack>
    </div>
  );
}
