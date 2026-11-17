"use client";
import { useState } from "react";
import { Button } from "@/components/primitives/Button";
import { Card } from "@/components/primitives/Card";
import { Field } from "@/components/primitives/Field";
import { Grid } from "@/components/primitives/Grid";
import { Stack } from "@/components/primitives/Stack";
import { buildAgentMetadata, encodeAgentMetadata } from "@/data/metadata";
import type { Address } from "@/data/types";
import { shortAddress } from "@/lib/format";
import { metadataUrlError } from "@/lib/validation";
import { descriptionError, keyError, nameError } from "./agentInput";
import styles from "./RegisterAgentForm.module.css";

export interface RegisterValues {
  agentKey: Address;
  metadataURI: string;
  /** The agent's name when the profile is written here (no Metadata URL); undefined when the address is used. */
  name?: string;
}

/**
 * Register an agent (C-07-Agents:42). Name and Description are an owner decision (vision section 13): they are written
 * into a data: URI. A Metadata URL, when given, is used instead, and then Name and Description are locked.
 */
export function RegisterAgentForm({ owner, onSubmit }: { owner: Address; onSubmit(v: RegisterValues): void }) {
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [touched, setTouched] = useState(false);
  const touch = () => setTouched(true);

  const useUrl = url.trim() !== "";
  const errors = {
    key: keyError(key),
    name: useUrl ? undefined : nameError(name),
    description: useUrl ? undefined : descriptionError(description),
    url: metadataUrlError(url),
  };
  const missing = !useUrl && name.trim() === "";
  const valid = key.trim() !== "" && !missing && !errors.key && !errors.name && !errors.description && !errors.url;

  const submit = () => {
    if (!valid) return;
    const agentKey = key.trim() as Address;
    if (useUrl) onSubmit({ agentKey, metadataURI: url.trim() });
    else {
      const trimmed = name.trim();
      onSubmit({
        agentKey,
        name: trimmed,
        metadataURI: encodeAgentMetadata(buildAgentMetadata({ name: trimmed, description: description.trim() })),
      });
    }
  };

  return (
    <Card as="section" tone="emphasis" radius="lg" gap="16" aria-labelledby="reg">
      <h2 id="reg" className={styles.title}>
        Register an agent
      </h2>
      <Grid minItem="320" gap="16">
        <Field
          kind="input"
          id="r-key"
          label="Agent key address"
          placeholder="0x…"
          mono
          fontSize="15"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          hint="The key your agent signs its work with. It can't receive earnings."
          error={errors.key}
          autoComplete="off"
          spellCheck={false}
        />
        <Field
          kind="input"
          id="r-name"
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={touch}
          disabled={useUrl}
          error={errors.name ?? (touched && missing ? "Enter a name or a metadata address." : undefined)}
          autoComplete="off"
        />
      </Grid>
      <Grid minItem="320" gap="16">
        <Field
          kind="textarea"
          id="r-desc"
          label="Description"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={touch}
          disabled={useUrl}
          error={errors.description}
        />
        <Field
          kind="input"
          id="r-meta"
          label="Metadata URL"
          placeholder="ipfs:// or https://"
          mono
          fontSize="15"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={touch}
          hint="Name, description and capabilities, read from this file."
          error={errors.url}
          autoComplete="off"
          spellCheck={false}
        />
      </Grid>
      <div className={styles.footer}>
        <Stack gap="12" direction="row" wrap align="center" justify="between">
          <span className={styles.owner}>
            Owner will be <span className={styles.mono}>{shortAddress(owner)}</span>. Ownership transfer isn&apos;t available in Phase 1.
          </span>
          <Button variant="brand" disabled={!valid} onClick={submit}>
            Register and sign
          </Button>
        </Stack>
      </div>
    </Card>
  );
}
