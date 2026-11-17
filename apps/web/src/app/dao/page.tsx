import { Suspense } from "react";
import { Loading } from "@/components/shell/StateViews";
import { DaoDetailPage } from "@/screens/DaoDetailPage";

export default function DaoPage() {
  return (
    <Suspense fallback={<Loading />}>
      <DaoDetailPage />
    </Suspense>
  );
}
