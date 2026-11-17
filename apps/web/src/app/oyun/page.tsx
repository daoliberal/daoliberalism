import type { Metadata } from "next";
import { OnizlemeSeridi } from "@/oyun/OnizlemeSeridi";
import { OyunApp } from "@/oyun/OyunApp";
import { t } from "@/oyun/copy/t";

export const metadata: Metadata = { title: t("app.title") };

export default function OyunPage() {
  return (
    <>
      <OnizlemeSeridi />
      <OyunApp />
    </>
  );
}
